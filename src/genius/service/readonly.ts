import type { ID, Module } from '#/types'
import { explainFormula } from '../formula/analysis'
import { schemaOf } from '../config/dependencies'
import type { ConfigModel } from '../config/model'
import { canModule, fieldAccess, type Actor } from '../permissions/policy'
import { previewWorkflow } from '../workflow/preview'
import { useGeniusStore } from '../state/geniusStore'
import type { GeniusVersion } from '../state/types'
import { visibleConfig } from '../ai/context-manager'

/**
 * Deterministic handlers for the read-only intents (explain_calculation, simulate_workflow) and for restore_version.
 * No model is involved: the answer is derived from the stored configuration, so it cannot drift from what the app
 * really computes. None of these functions writes anything; restore only PROPOSES a target, the UI asks for
 * confirmation before undoVersion/restoreToVersion run.
 */
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'how', 'what', 'does', 'do', 'why', 'explain', 'calculated', 'calculation', 'computed', 'formula', 'show', 'me', 'of', 'for', 'to', 'in', 'my', 'this', 'that', 'it', 'work', 'works', 'workflow', 'automation', 'simulate', 'dry', 'run', 'preview', 'test', 'would', 'will', 'happen', 'if', 'ran', 'today', 'rule', 'reminder', 'about', 'on', 'and', 'value', 'number', 'figure', 'showing', 'so', 'be', 'get', 'got'])
const stem = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem)

export interface ReadonlyAnswer {
  found: boolean
  text: string
  /** ids the answer is based on */
  references: string[]
  /** several equally good matches: the UI can offer them */
  candidates?: string[]
}

const NOT_FOUND = (what: string, names: string[]): ReadonlyAnswer => ({ found: false, text: `I could not tell which ${what} you mean. ${names.length ? `Available: ${names.slice(0, 12).join(', ')}.` : 'There are none yet.'}`, references: [], candidates: names.slice(0, 12) })

export function explainCalculation(cfg: ConfigModel, actor: Actor, request: string): ReadonlyAnswer {
  const vis = visibleConfig(cfg, actor)
  const q = new Set(words(request))
  type Hit = { m: Module; id: string; label: string; score: number }
  const hits: Hit[] = []
  for (const m of vis.modules) {
    const mw = words(m.name)
    for (const f of m.fields) {
      if ((f.type !== 'formula' && !f.formula) || fieldAccess(actor.role, f) === 'hidden') continue
      const fw = [...new Set([...words(f.label), ...words(f.id)])]
      const matched = fw.filter((w) => q.has(w)).length
      if (!matched || matched < Math.min(fw.length, 2)) continue
      hits.push({ m, id: f.id, label: f.label, score: matched * 2 + (mw.some((w) => q.has(w)) ? 1 : 0) })
    }
  }
  hits.sort((a, b) => b.score - a.score)
  if (hits.length) {
    const best = hits[0]
    const tied = hits.filter((h) => h.score === best.score)
    if (tied.length > 1) return NOT_FOUND('calculation', tied.map((h) => `${h.m.name} › ${h.label}`))
    return describeFormula(cfg, actor, best.m, best.id)
  }
  // dashboard components state their own definition
  for (const d of vis.dashboards) {
    for (const w of d.widgets) {
      const tw = words(w.title)
      if (tw.length && tw.every((x) => q.has(x))) {
        const mod = vis.modules.find((m) => m.id === w.moduleId)
        if (!mod) continue
        const field = mod.fields.find((f) => f.id === w.fieldId)
        const filters = w.filters.map((f) => `${mod.fields.find((x) => x.id === f.fieldId)?.label ?? f.fieldId} ${f.op} ${String(f.value ?? '')}`.trim())
        return {
          found: true,
          text: `"${w.title}" on the "${d.name}" dashboard: ${w.definition ?? 'no description was recorded'}\n\nTechnically: ${w.agg === 'count' ? 'counts' : `${w.agg} of "${field?.label ?? w.fieldId}" over`} the records of ${mod.name}${filters.length ? ` where ${filters.join(' and ')}` : ''}${w.groupBy ? `, grouped by "${mod.fields.find((f) => f.id === w.groupBy)?.label ?? w.groupBy}"` : ''}. It is computed live from your records and only counts records you are allowed to see.`,
          references: [d.id, mod.id],
        }
      }
    }
  }
  return NOT_FOUND('calculation', vis.modules.flatMap((m) => m.fields.filter((f) => f.type === 'formula' && !['display_title'].includes(f.id) && fieldAccess(actor.role, f) !== 'hidden').map((f) => `${m.name} › ${f.label}`)))
}

function describeFormula(cfg: ConfigModel, actor: Actor, m: Module, fieldId: string): ReadonlyAnswer {
  const f = m.fields.find((x) => x.id === fieldId)!
  const spec = f.formulaSpec
  if (!spec) return { found: true, text: `"${f.label}" (${m.name}) uses the older formula \`${f.formula}\`. It was not built by Genius, so it has no recorded tests or rounding rules.`, references: [m.id] }
  const schema = schemaOf(cfg)
  const e = explainFormula(spec, m.id, schema)
  const sources = e.sources.filter((s) => {
    const sm = cfg.modules.find((x) => x.id === s.moduleId)
    const sf = sm?.fields.find((x) => x.id === s.fieldId)
    return sm && sf && canModule(actor.role, sm, 'view') && fieldAccess(actor.role, sf) !== 'hidden'
  })
  const hiddenCount = e.sources.length - sources.length
  const lines = [
    `"${f.label}" in ${m.name}: ${e.description ?? 'a calculated field'}`,
    '',
    hiddenCount ? 'Formula: (hidden: it reads data you are not allowed to see)' : `Formula: ${e.formula}`,
    `Reads: ${sources.map((s) => `${s.moduleName ?? s.moduleId} › ${s.label ?? s.fieldId}`).join('; ') || 'nothing'}${hiddenCount ? `; and ${hiddenCount} more you cannot see` : ''}`,
    `Result: ${e.resultType}${e.currency ? ` in ${e.currency}` : ''}, ${e.precision} decimal place${e.precision === 1 ? '' : 's'}, rounded ${e.rounding.replace('_', ' ')}.`,
    `When a value is empty: ${e.nullBehavior === 'zero' ? 'treated as zero' : e.nullBehavior === 'null' ? 'the result is left empty' : 'the calculation reports an error'}. Dividing by zero: ${e.divByZero === 'null' ? 'the result is left empty' : e.divByZero === 'zero' ? 'the result is zero' : 'reports an error'}.`,
  ]
  const tests = spec.tests ?? []
  if (tests.length) lines.push('', `It is checked by ${tests.length} stored test case${tests.length === 1 ? '' : 's'}: ${tests.slice(0, 4).map((t) => `${t.name} → ${String(t.expected)}`).join('; ')}${tests.length > 4 ? '; …' : ''}.`)
  return { found: true, text: lines.join('\n'), references: [m.id, `${m.id}.${f.id}`, ...e.sources.map((s) => s.moduleId)].filter((x, i, a) => a.indexOf(x) === i) }
}

export function simulateWorkflow(cfg: ConfigModel, actor: Actor, request: string, now = new Date()): ReadonlyAnswer {
  const vis = visibleConfig(cfg, actor)
  const q = new Set(words(request))
  const scored = vis.workflows
    .map((w) => ({ w, score: words(`${w.name} ${w.description ?? ''}`).filter((x) => q.has(x)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!scored.length) return NOT_FOUND('workflow', vis.workflows.map((w) => w.name))
  const top = scored.filter((x) => x.score === scored[0].score)
  if (top.length > 1 && vis.workflows.length > 1) return NOT_FOUND('workflow', top.map((x) => x.w.name))
  const wf = top[0].w
  const p = previewWorkflow(wf.id, { now, limit: 200 })
  if (!p) return NOT_FOUND('workflow', [])
  const t = p.totals
  const would = [t.tasks && `create ${t.tasks} task${t.tasks === 1 ? '' : 's'}`, t.updates && `update ${t.updates} field${t.updates === 1 ? '' : 's'}`, t.creates && `create ${t.creates} record${t.creates === 1 ? '' : 's'}`, t.notifications && `show ${t.notifications} in-app notification${t.notifications === 1 ? '' : 's'}`].filter(Boolean)
  const lines = [
    `Dry run of "${wf.name}" (${wf.enabled ? 'currently ON' : 'currently OFF'}):`,
    p.matching === 0 ? 'No record matches right now, so it would do nothing today.' : `${p.matching} record${p.matching === 1 ? '' : 's'} match${p.matching === 1 ? 'es' : ''} (of ${p.considered} considered). It would ${would.join(', ') || 'do nothing'}.`,
    ...p.sample.slice(0, 3).map((s) => `• ${s.title}: ${s.node.steps.map((st) => st.summary).join('; ') || 'skipped'}`),
    ...p.notes,
    `Nothing was changed and nothing was sent. This app has no e-mail, SMS or WhatsApp channel, so no workflow can send a message.`,
    p.consequential ? `This workflow needs your approval before it can be switched on: ${p.reasons.join('; ')}.` : '',
  ].filter(Boolean)
  return { found: true, text: lines.join('\n'), references: [wf.id, wf.moduleId] }
}

export interface RestoreTarget {
  mode: 'undo' | 'restore_to'
  version: GeniusVersion
  /** versions that would be undone, newest first */
  affected: GeniusVersion[]
}

export function restoreTarget(workspaceId: ID, request: string): { target?: RestoreTarget; text: string } {
  const g = useGeniusStore.getState()
  const live = g.versions.filter((v) => v.workspaceId === workspaceId && !v.undone && v.kind !== 'restore').sort((a, b) => b.number - a.number)
  if (!live.length) return { text: 'There is nothing to undo: no Genius change has been applied to this workspace (or all of them were already undone).' }
  const num = /\b(?:version|v)\s*#?\s*(\d+)\b/i.exec(request)?.[1]
  if (num) {
    const n = Number(num)
    const v = g.versions.find((x) => x.workspaceId === workspaceId && x.number === n)
    if (!v) return { text: `There is no version ${n}. Versions: ${live.map((x) => `v${x.number}`).join(', ')}.` }
    const affected = live.filter((x) => x.number > n)
    return { target: { mode: 'restore_to', version: v, affected }, text: `Restore to how things were after v${n} ("${v.summary}")? This undoes ${affected.length} newer change${affected.length === 1 ? '' : 's'}: ${affected.map((a) => `v${a.number} ${a.summary}`).join('; ') || 'none'}. Records are never deleted; tables with records are archived instead.` }
  }
  const latest = live[0]
  return { target: { mode: 'undo', version: latest, affected: [latest] }, text: `Undo the last change, v${latest.number} ("${latest.summary}")? Only the components that change touched go back; your later manual edits to other things stay.` }
}
