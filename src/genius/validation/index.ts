import type { CrmRecord, Role } from '#/types'
import { applyOpsCollect, blueprintToOps, type AnyOp, type ApplyResult } from '../compiler/apply'
import { storeId } from '../compiler/ids'
import { Blueprint, Patch, SCHEMA_VERSION } from '../blueprint/schema'
import { revisionOf, type ConfigModel } from '../config/model'
import { ACTION_REGISTRY, PLATFORM_KEYS, SUPPORTED_TRIGGERS } from '../registry'
import { businessRules, cycleRules, touchedOf } from './rules'
import { issue, report, type Issue, type Stage, type ValidationReport } from './issues'
import { runSandbox, type SandboxResult } from './sandbox'
import { requestSecurity, resultSecurity } from './security'
import type { z } from 'zod'

export * from './issues'

export interface ValidateContext {
  /** the live configuration this request will be applied to */
  config: ConfigModel
  tenantId: string
  workspaceId: string
  projectId: string
  actor: { userId: string; role: Role | undefined }
  /** ids that belong to other tenants/workspaces (tests / server-side knowledge); the workspace tag check covers the rest */
  foreignIds?: Set<string>
  now: string
  records?: (moduleId: string) => CrmRecord[]
  defaultCurrency?: string
  skipSandbox?: boolean
  /** a patch designed against an older revision may still be applied when nothing it touches has changed */
  allowStaleRevision?: boolean
}

export interface ValidationOutcome {
  report: ValidationReport
  issues: Issue[]
  ops: AnyOp[]
  apply?: ApplyResult
  sandbox?: SandboxResult
  blueprint?: Blueprint
  patch?: Patch
  stale?: { expected: string; actual: string }
}

// ---- stage 1: schema -----------------------------------------------------------------------------------------------

function repairHint(i: z.core.$ZodIssue): string {
  switch (i.code) {
    case 'invalid_type':
      return `Expected ${String((i as { expected?: string }).expected)}.`
    case 'unrecognized_keys':
      return `Remove the unknown key(s): ${((i as { keys?: string[] }).keys ?? []).join(', ')}.`
    case 'too_big':
      return 'Reduce the size/length to the allowed maximum.'
    case 'too_small':
      return 'Provide at least the required minimum.'
    case 'invalid_value':
      return `Use one of: ${((i as { values?: unknown[] }).values ?? []).map(String).join(', ')}.`
    case 'invalid_format':
      return 'Match the required format (ids are lowercase snake_case; dates are YYYY-MM-DD).'
    default:
      return 'Fix the value so it matches the schema.'
  }
}

export function schemaIssues(error: z.ZodError): Issue[] {
  const out: Issue[] = []
  for (const i of error.issues.slice(0, 30)) {
    const path = i.path.map(String).join('.') || '(root)'
    if (i.code === 'unrecognized_keys') {
      const keys = (i as { keys?: string[] }).keys ?? []
      const platform = keys.filter((k) => PLATFORM_KEYS.has(k))
      if (platform.length) {
        out.push(issue('security', 'SEC_PLATFORM_KEY', path, `Platform-level setting(s) cannot be changed here: ${platform.join(', ')}`, 'Remove them: account, billing, auth and integration settings are never part of a blueprint.'))
        continue
      }
    }
    out.push({ stage: 'schema', code: `SCHEMA_${i.code.toUpperCase()}`, path, message: i.message, severity: 'error', repair: repairHint(i) })
  }
  if (error.issues.length > 30) out.push(issue('schema', 'SCHEMA_TRUNCATED', '(root)', `${error.issues.length - 30} more schema errors not shown`, 'Fix the listed errors first.'))
  return out
}

// ---- unimplementable requests --------------------------------------------------------------------------------------

type WorkflowLike = { id: string; name: string; trigger?: { type?: string; event?: string }; actions?: { type: string; channel?: string }[] }

function whyUnimplementable(w: WorkflowLike): string | null {
  if (w.trigger?.type === 'external_event' || (w.trigger?.type && !(w.trigger.type in SUPPORTED_TRIGGERS))) return `a trigger from outside the app (${w.trigger?.event ?? w.trigger?.type})`
  if (w.trigger?.type && !SUPPORTED_TRIGGERS[w.trigger.type as keyof typeof SUPPORTED_TRIGGERS]?.supported) return `the "${w.trigger.type}" trigger`
  for (const a of w.actions ?? []) {
    if (a.type === 'send_message') return `sending ${a.channel ?? 'a'} message to people outside the app (no email/SMS/WhatsApp channel is connected)`
    if (!(a.type in ACTION_REGISTRY)) return `the "${a.type}" action`
  }
  return null
}

/** Components the app cannot execute are left out and reported: never silently dropped, never faked. */
export function pruneUnimplementable(ops: AnyOp[]): { ops: AnyOp[]; issues: Issue[] } {
  const issues: Issue[] = []
  const dropped = new Set<string>()
  const kept: AnyOp[] = []
  const note = (id: string, name: string, why: string) => {
    dropped.add(id)
    issues.push({ stage: 'references', code: 'NOT_IMPLEMENTABLE', path: `workflows.${id}`, severity: 'warning', notImplementable: true, message: `"${name}" was not built: it needs ${why}`, repair: 'Use an in-app notification or a follow-up task instead, or connect the channel first.' })
  }
  for (const op of ops) {
    if (op.op === 'add_workflow') {
      const why = whyUnimplementable(op.workflow)
      if (why) {
        note(op.workflow.id, op.workflow.name, why)
        continue
      }
    } else if (op.op === 'update_workflow') {
      if (dropped.has(op.id)) continue
      const why = whyUnimplementable({ id: op.id, name: op.id, trigger: op.changes.trigger, actions: op.changes.actions })
      if (why) {
        note(op.id, op.id, why)
        continue
      }
    } else if ((op.op === 'enable_workflow' || op.op === 'disable_workflow' || op.op === 'remove_workflow') && dropped.has(op.id)) continue
    kept.push(op)
  }
  return { ops: kept, issues }
}

// ---- driver --------------------------------------------------------------------------------------------------------

function declaredSources(ops: AnyOp[], next: ConfigModel, ctx: ValidateContext) {
  const map = new Map<string, { moduleId: string; fieldId: string }[]>()
  for (const op of ops) {
    if (op.op !== 'add_formula') continue
    const real = next.modules.find((m) => m.id === op.formula.moduleId)?.id ?? storeId('module', ctx.workspaceId, op.formula.moduleId)
    map.set(`${real}.${op.formula.id}`, op.formula.sources)
  }
  return map
}

function validateOps(ops: AnyOp[], ctx: ValidateContext, pre: Issue[], stagesRun: Stage[], extra: Partial<ValidationOutcome>, projectId?: string): ValidationOutcome {
  const issues = [...pre]
  const pruned = pruneUnimplementable(ops)
  issues.push(...pruned.issues)
  const kept = pruned.ops
  const base = { ops: kept, ...extra }
  const actor = { userId: ctx.actor.userId, role: ctx.actor.role }

  // stage 2: references (every broken reference at once, not just the first)
  stagesRun.push('references')
  const applyCtx = { workspaceId: ctx.workspaceId, projectId: ctx.projectId, actorUserId: ctx.actor.userId, now: ctx.now, records: ctx.records, defaultCurrency: ctx.defaultCurrency }
  const { result, failures } = applyOpsCollect(ctx.config, kept, applyCtx)
  for (const f of failures)
    issues.push(issue('references', f.code, f.path ?? `ops[${f.index}]`, f.message, f.code.startsWith('REF_') ? 'Reference only components that exist or that are defined earlier in this request, using their ids.' : 'Fix the operation so it can be applied.'))

  // request-level security does not depend on compilation, so it is always reported
  stagesRun.push('security')
  const secIn = { ops: kept, actor, projectId, expectedProjectId: ctx.projectId, workspaceId: ctx.workspaceId, foreignIds: ctx.foreignIds, changes: result.changes, next: result.config, prev: ctx.config }
  issues.push(...requestSecurity(secIn))

  if (failures.length) return { ...base, issues, report: report(issues, stagesRun) }

  const rin = { next: result.config, prev: ctx.config, changes: result.changes, declared: declaredSources(kept, result.config, ctx) }
  stagesRun.splice(stagesRun.indexOf('security'), 1)

  stagesRun.push('business')
  issues.push(...businessRules(rin))
  stagesRun.push('cycles')
  issues.push(...cycleRules(rin))
  stagesRun.push('security')
  issues.push(...resultSecurity(secIn))

  let sandbox: SandboxResult | undefined
  const hasErrors = () => issues.some((i) => i.severity === 'error' && !i.notImplementable)
  if (!hasErrors() && !ctx.skipSandbox) {
    stagesRun.push('sandbox')
    const t = touchedOf(result.changes)
    sandbox = runSandbox(result.config, t.modules, t.workflows, { now: new Date(ctx.now) })
    issues.push(...sandbox.issues)
  }
  const rep = report(issues, [...new Set(stagesRun)], sandbox ? { ran: true, syntheticRecords: sandbox.syntheticRecords, limitations: sandbox.limitations } : { ran: false, syntheticRecords: 0, limitations: [] })
  return { ...base, issues, report: rep, apply: rep.ok ? result : undefined, sandbox }
}

/** Validate a whole blueprint (new build). Pure: nothing is written. */
export function validateBlueprint(raw: unknown, ctx: ValidateContext): ValidationOutcome {
  const parsed = Blueprint.safeParse(raw)
  if (!parsed.success) {
    const issues = schemaIssues(parsed.error)
    return { report: report(issues, ['schema']), issues, ops: [] }
  }
  const bp = parsed.data
  const pre: Issue[] = []
  if (bp.meta.schemaVersion !== SCHEMA_VERSION) pre.push(issue('schema', 'SCHEMA_VERSION', 'meta.schemaVersion', `Unsupported schema version ${bp.meta.schemaVersion}`, `Use schemaVersion ${SCHEMA_VERSION}.`))
  if (pre.length) return { report: report(pre, ['schema']), issues: pre, ops: [], blueprint: bp }
  return validateOps(blueprintToOps(bp), ctx, pre, ['schema'], { blueprint: bp }, bp.meta.projectId)
}

/** Validate a patch (modification). The patch must be built on the live revision unless `allowStaleRevision` is set. */
export function validatePatch(raw: unknown, ctx: ValidateContext): ValidationOutcome {
  const parsed = Patch.safeParse(raw)
  if (!parsed.success) {
    const issues = schemaIssues(parsed.error)
    return { report: report(issues, ['schema']), issues, ops: [] }
  }
  const patch = parsed.data
  const actual = revisionOf(ctx.config)
  const pre: Issue[] = []
  let stale: ValidationOutcome['stale']
  if (patch.expected_revision !== actual) {
    stale = { expected: patch.expected_revision, actual }
    if (!ctx.allowStaleRevision) {
      pre.push(issue('references', 'STALE_REVISION', 'expected_revision', 'The configuration changed after this patch was designed (someone edited it, or another change was accepted)', 'Rebase: re-read the current configuration and regenerate the patch against it.'))
      return { report: report(pre, ['references']), issues: pre, ops: patch.ops as AnyOp[], patch, stale }
    }
    pre.push(issue('references', 'STALE_REVISION_REBASED', 'expected_revision', 'The configuration changed since this patch was designed; nothing it touches was modified, so it was applied on the current version', 'No action needed.', 'warning'))
  }
  const out = validateOps(patch.ops as AnyOp[], ctx, pre, ['schema'], { patch, stale })
  return out
}
