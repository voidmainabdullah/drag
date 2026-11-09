import type { CrmRecord, Field, Module } from '#/types'
import { isSingleRel } from '#/utils/fieldTypes'
import { makeCtx, valueOf } from '#/utils/records'
import { validateRecordData } from '#/utils/validation'
import type { ConfigModel } from '../config/model'
import { dryRun, type DryRunResult } from '../workflow/core'
import { issue, type Issue } from './issues'

/**
 * Stage 6: the sandbox. The compiled configuration is exercised with SYNTHETIC records (never real customer data):
 * the records must be creatable under the new rules, formulas must evaluate on typical / minimal / zero data,
 * and workflows are dry-run: planned effects only, nothing written, nothing sent.
 */

export interface SandboxResult {
  issues: Issue[]
  syntheticRecords: number
  workflowRuns: DryRunResult[]
  limitations: string[]
}

const s = 'sandbox' as const
export type Variant = 'typical' | 'minimal' | 'zero'

const clamp = (n: number, f: Field) => Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n))

function sampleValue(f: Field, variant: Variant, tag: string): unknown {
  const opt = f.options?.[0]?.id
  switch (f.type) {
    case 'shortText':
      return f.unique ? `Sample ${f.label} ${tag}` : `Sample ${f.label}`
    case 'longText':
      return `Sample ${f.label}`
    case 'email':
      return `sample.${tag}@example.com`
    case 'phone':
      return `+4420${String(79460000 + (parseInt(tag.replace(/\D/g, '') || '1', 10) % 9999)).padStart(8, '0')}`
    case 'website':
      return 'https://example.com'
    case 'number':
      return clamp(variant === 'zero' ? 0 : f.precision ? 12.5 : 10, f)
    case 'currency':
      return clamp(variant === 'zero' ? 0 : 100, f)
    case 'percentage':
      return clamp(variant === 'zero' ? 0 : 50, f)
    case 'rating':
      return clamp(3, f)
    case 'date':
      return f.dateMin && f.dateMin > '2026-01-15' ? f.dateMin : '2026-01-15'
    case 'datetime':
      return '2026-01-15T09:00:00.000Z'
    case 'time':
      return '09:00'
    case 'yesNo':
      return true
    case 'dropdown':
    case 'radio':
      return opt
    case 'multiSelect':
    case 'checkboxes':
      return opt ? [opt] : []
    case 'tags':
      return ['sample']
    case 'color':
      return '#336699'
    default:
      return undefined
  }
}

interface Gen {
  records: CrmRecord[]
  byModule: Map<string, CrmRecord[]>
}

function synthesize(cfg: ConfigModel, m: Module, variant: Variant, gen: Gen, depth = 0, now = '2026-01-15T09:00:00.000Z'): CrmRecord {
  const key = `${m.id}:${variant}`
  const existing = gen.byModule.get(key)?.[0]
  if (existing) return existing
  const data: Record<string, unknown> = {}
  const tag = `${variant.slice(0, 1)}${gen.records.length + 1}`
  const rec: CrmRecord = { id: `syn_${m.id}_${variant}`, workspaceId: m.workspaceId, moduleId: m.id, data, createdAt: now, updatedAt: now, createdBy: 'syn_user' }
  // register first so self/cyclic relationships do not recurse forever
  gen.byModule.set(key, [rec])
  for (const f of m.fields) {
    if (f.type === 'formula' || f.type === 'autoId') continue
    if (f.type === 'relationship') {
      if (variant === 'minimal' && !f.relation?.required) continue
      const target = cfg.modules.find((x) => x.id === f.relation?.moduleId)
      if (!target || depth > 3) continue
      const parent = target.id === m.id ? rec : synthesize(cfg, target, 'typical', gen, depth + 1, now)
      if (parent === rec) continue
      data[f.id] = isSingleRel(f) ? parent.id : [parent.id]
      continue
    }
    if (variant === 'minimal' && !f.required) continue
    const v = sampleValue(f, variant, tag)
    if (v !== undefined) data[f.id] = v
  }
  gen.records.push(rec)
  return rec
}

export function runSandbox(cfg: ConfigModel, touchedModules: Set<string>, touchedWorkflows: Set<string>, opts: { now?: Date } = {}): SandboxResult {
  const issues: Issue[] = []
  const now = opts.now ?? new Date('2026-01-15T09:00:00.000Z')
  const gen: Gen = { records: [], byModule: new Map() }
  const modules = cfg.modules.filter((m) => touchedModules.has(m.id) && !m.archived)
  const variants: Variant[] = ['typical', 'minimal', 'zero']
  const bad = new Set<string>()

  for (const m of modules) {
    for (const v of variants) {
      const rec = synthesize(cfg, m, v, gen, 0, now.toISOString())
      const errs = validateRecordData(m, rec.data, { existing: gen.records.filter((r) => r.moduleId !== m.id) })
      for (const [fid, msg] of Object.entries(errs)) {
        const f = m.fields.find((x) => x.id === fid)
        // a field the sandbox cannot synthesize (files, signatures, users) is not the blueprint's fault
        if (f && ['file', 'image', 'document', 'signature', 'user', 'password', 'address'].includes(f.type)) continue
        const k = `${m.id}.${fid}`
        if (bad.has(k)) continue
        bad.add(k)
        issues.push(
          issue(s, 'SANDBOX_RECORD_INVALID', `modules.${m.id}.fields.${fid}`, `A ${v === 'minimal' ? 'record with only the required fields' : 'sample record'} of "${m.name}" is rejected: ${f?.label ?? fid}: ${msg}`, 'Relax the rule or give the field a default so valid records can be created.'),
        )
      }
    }
  }

  const ctx = makeCtx(cfg.modules, gen.records, [])
  const seenErr = new Set<string>()
  for (const m of modules) {
    for (const f of m.fields.filter((x) => x.type === 'formula' && x.formulaSpec)) {
      for (const v of variants) {
        const rec = gen.byModule.get(`${m.id}:${v}`)?.[0]
        if (!rec) continue
        const val = valueOf(m, rec, f, ctx)
        if (typeof val === 'string' && val.startsWith('#ERR')) {
          const k = `${m.id}.${f.id}.${val}`
          if (seenErr.has(k)) continue
          seenErr.add(k)
          // blank inputs may legitimately produce an error when the author chose nullBehavior=error: that is a warning on minimal data
          issues.push(issue(s, 'SANDBOX_FORMULA_ERROR', `formulas.${m.id}.${f.id}`, `${f.label} fails on ${v === 'typical' ? 'a typical' : v === 'minimal' ? 'a minimal (mostly empty)' : 'a zero-valued'} record: ${val.slice(5).trim()}`, 'Handle empty and zero inputs: set nullBehavior / divByZero or guard the expression with IF.', v === 'typical' ? 'error' : 'warning'))
        }
      }
    }
  }

  const workflowRuns: DryRunResult[] = []
  const users = [{ id: 'syn_user', name: 'Sample user', email: 'sample@example.com', roleId: 'role_owner', color: '#888', createdAt: now.toISOString() }]
  for (const wf of cfg.workflows) {
    if (!touchedWorkflows.has(wf.id)) continue
    const m = cfg.modules.find((x) => x.id === wf.moduleId)
    if (!m) continue
    const rec = gen.byModule.get(`${m.id}:typical`)?.[0] ?? (m.archived ? undefined : synthesize(cfg, m, 'typical', gen, 0, now.toISOString()))
    if (!rec) continue
    const previous = wf.trigger.fieldId ? { ...rec, data: { ...rec.data, [wf.trigger.fieldId]: undefined } } : undefined
    const run = dryRun({ modules: cfg.modules, records: gen.records, users, now }, cfg.workflows, { type: wf.trigger.type === 'record_created' ? 'created' : 'updated', record: rec, previous, eventId: 'sandbox' }, { only: wf.id, assumeEnabled: new Set([wf.id]), force: true })
    workflowRuns.push(run)
    const walk = (n: DryRunResult['nodes'][number]) => {
      for (const st of n.steps) if (!st.ok) issues.push(issue(s, 'SANDBOX_WORKFLOW_ACTION_FAILED', `workflows.${wf.id}`, `${wf.name}: action would fail on a sample record: ${st.error}`, 'Fix the action parameters (field, option id or value).'))
      n.children.forEach(walk)
    }
    run.nodes.forEach(walk)
    if (run.loopPrevented) issues.push(issue(s, 'SANDBOX_WORKFLOW_LOOP', `workflows.${wf.id}`, `${wf.name}: running it triggers a chain that comes back to itself`, 'Change an action or trigger so the chain ends.'))
  }

  return {
    issues,
    syntheticRecords: gen.records.length,
    workflowRuns,
    limitations: [
      'Sample records are synthetic; file, signature and user fields are not exercised.',
      'Workflows are planned, not executed: no record is written and no message is sent. Scheduled and date-based triggers are not simulated over time.',
      'Formula checks use typical, minimal and zero-valued records, not your real data.',
    ],
  }
}
