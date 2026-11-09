import { addDays, format } from 'date-fns'
import type { CrmRecord, Field, Module, User, Workflow, WorkflowAction } from '#/types'
import { parseImportValue } from '#/utils/csv'
import { isEmpty, isSingleRel } from '#/utils/fieldTypes'
import { displayValue, makeCtx, matchesFilter, recordTitle, valueOf, type Ctx } from '#/utils/records'
import { hash53 } from '../config/model'

/**
 * The workflow core: PURE planning code shared by the live engine and by dry-run/preview.
 * Nothing in this file reads or writes a store, sends a message, or touches the network. The live engine takes the
 * `Effect`s returned here and performs them; the preview just lists them. One code path, so a preview is truthful.
 */

export const MAX_CASCADE_DEPTH = 3
export const MAX_ATTEMPTS = 3

/** Hash of everything that defines what a workflow does (not its enabled/approval/bookkeeping fields). */
export function workflowHash(w: Pick<Workflow, 'moduleId' | 'trigger' | 'conditions' | 'actions'>): string {
  return hash53(JSON.stringify({ m: w.moduleId, t: w.trigger, c: w.conditions, a: w.actions }))
}

/** May this workflow run? AI-built and consequential workflows need an approval bound to their exact current definition. */
export function mayRun(w: Workflow): boolean {
  if (!w.enabled) return false
  if (w.origin === 'ai' || w.consequential) return !!w.approval && w.approval.hash === workflowHash(w)
  return true
}

export interface PlanEnv {
  modules: Module[]
  records: CrmRecord[]
  users: User[]
  now: Date
}

export const ctxOf = (env: PlanEnv): Ctx => makeCtx(env.modules, env.records, env.users)

// ---- templates --------------------------------------------------------------------------------------

export function renderTemplate(tpl: string, m: Module | undefined, rec: CrmRecord, ctx: Ctx, now: Date, value?: unknown): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, key: string) => {
    if (key === 'today') return format(now, 'yyyy-MM-dd')
    if (key === 'now') return now.toISOString()
    if (key === 'id') return rec.id
    if (!m) return ''
    if (key === 'title') return recordTitle(m, rec, ctx)
    if (key === 'module') return m.name
    if (key === 'value') return value === undefined ? '' : String(value)
    const f = m.fields.find((x) => x.id === key || x.name === key)
    if (f) return displayValue(f, valueOf(m, rec, f, ctx), ctx)
    return ''
  })
}

function coerce(env: PlanEnv, m: Module, field: Field | undefined, raw: unknown, rec: CrmRecord, value?: unknown): unknown {
  if (typeof raw !== 'string') return raw
  const ctx = ctxOf(env)
  const text = renderTemplate(raw, m, rec, ctx, env.now, value)
  if (!field) return text
  if (field.type === 'relationship' && raw.trim() === '{{id}}') return isSingleRel(field) ? rec.id : [rec.id]
  if ((field.type === 'dropdown' || field.type === 'radio') && field.options?.some((o) => o.id === raw)) return raw
  const parsed = parseImportValue(field, text, ctx, env.records)
  if (parsed.error) throw new Error(parsed.error)
  return parsed.value ?? ''
}

// ---- triggers & idempotency ----------------------------------------------------------------------------

export interface EventLike {
  type: 'created' | 'updated' | 'deleted'
  record: CrmRecord
  previous?: CrmRecord
  /** unique per emitted event; the same event delivered twice carries the same id */
  eventId?: string
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])

export function matchTrigger(wf: Workflow, e: EventLike): { ok: boolean; value?: unknown } {
  const t = wf.trigger
  switch (t.type) {
    case 'record_created':
      return { ok: e.type === 'created' }
    case 'record_updated':
      return { ok: e.type === 'updated' }
    case 'record_deleted':
      return { ok: e.type === 'deleted' }
    case 'field_changed':
    case 'status_changed': {
      if (e.type !== 'updated' || !t.fieldId || !e.previous) return { ok: false }
      const nv = e.record.data[t.fieldId]
      if (same(e.previous.data[t.fieldId] ?? '', nv ?? '')) return { ok: false }
      if (!isEmpty(t.value) && String(nv) !== String(t.value)) return { ok: false }
      return { ok: true, value: nv }
    }
    case 'relation_created': {
      if (!t.fieldId) return { ok: false }
      const now = ids(e.record.data[t.fieldId])
      if (e.type === 'created') return { ok: now.length > 0, value: now[0] }
      if (e.type !== 'updated') return { ok: false }
      const before = new Set(ids(e.previous?.data[t.fieldId]))
      const added = now.filter((x) => !before.has(x))
      return { ok: added.length > 0, value: added[0] }
    }
    case 'relation_updated': {
      if (e.type !== 'updated' || !t.fieldId || !e.previous) return { ok: false }
      return { ok: !same(e.previous.data[t.fieldId], e.record.data[t.fieldId]), value: e.record.data[t.fieldId] }
    }
    default:
      return { ok: false }
  }
}

/** Same workflow + same record + same event => same key, so a duplicate delivery or a retry never runs twice. */
export function idempotencyKey(wf: Workflow, e: EventLike): string {
  const f = wf.trigger.fieldId
  const after = f ? hash53(JSON.stringify(e.record.data[f] ?? null)) : ''
  return `${wf.id}:${e.record.id}:${e.type}:${e.eventId ?? e.record.updatedAt}:${after}`
}

export function conditionsPass(wf: Workflow, m: Module | undefined, rec: CrmRecord, ctx: Ctx): boolean {
  if (!m) return false
  return wf.conditions.every((c) => matchesFilter(m, rec, { id: c.id, fieldId: c.fieldId, op: c.op, value: c.value }, ctx))
}

// ---- planning actions ------------------------------------------------------------------------------------

export type Effect =
  | { kind: 'update'; moduleId: string; recordId: string; patch: Record<string, unknown> }
  | { kind: 'create'; moduleId: string; data: Record<string, unknown> }
  | { kind: 'task'; data: Record<string, unknown> }
  | { kind: 'notify'; message: string }

export interface PlannedStep {
  actionId: string
  type: WorkflowAction['type']
  ok: boolean
  summary: string
  error?: string
  effect?: Effect
}

export function planAction(env: PlanEnv, a: WorkflowAction, rec: CrmRecord, trigValue?: unknown): PlannedStep {
  const base = { actionId: a.id, type: a.type }
  const m = env.modules.find((x) => x.id === rec.moduleId)
  const fail = (error: string): PlannedStep => ({ ...base, ok: false, summary: error, error })
  if (!m) return fail('The record\'s module no longer exists')
  try {
    switch (a.type) {
      case 'update_record':
      case 'change_status': {
        const f = m.fields.find((x) => x.id === a.fieldId)
        if (!f) return fail('Field no longer exists')
        const value = coerce(env, m, f, a.value, rec, trigValue)
        return { ...base, ok: true, summary: `${a.type === 'change_status' ? 'Change' : 'Set'} ${f.label} to ${displayValue(f, value, ctxOf(env)) || '(empty)'}`, effect: { kind: 'update', moduleId: m.id, recordId: rec.id, patch: { [f.id]: value } } }
      }
      case 'assign_user': {
        const f = m.fields.find((x) => x.id === a.fieldId)
        if (!f || !a.userId) return fail('Pick a user field and a user')
        const u = env.users.find((x) => x.id === a.userId)
        return { ...base, ok: true, summary: `Assign ${f.label} to ${u?.name ?? a.userId}`, effect: { kind: 'update', moduleId: m.id, recordId: rec.id, patch: { [f.id]: a.userId } } }
      }
      case 'add_tag': {
        const f = m.fields.find((x) => x.id === a.fieldId)
        if (!f) return fail('Tag field no longer exists')
        const tag = renderTemplate(String(a.value ?? ''), m, rec, ctxOf(env), env.now, trigValue).trim()
        if (!tag) return fail('Tag is empty')
        const cur = Array.isArray(rec.data[f.id]) ? (rec.data[f.id] as string[]) : []
        let toAdd = tag
        if (f.type === 'multiSelect' || f.type === 'checkboxes') {
          const o = f.options?.find((x) => x.label.toLowerCase() === tag.toLowerCase() || x.id === tag)
          if (!o) return fail(`"${tag}" is not an option`)
          toAdd = o.id
        }
        if (cur.includes(toAdd)) return { ...base, ok: true, summary: `Tag "${tag}" already present` }
        return { ...base, ok: true, summary: `Add tag "${tag}" to ${f.label}`, effect: { kind: 'update', moduleId: m.id, recordId: rec.id, patch: { [f.id]: [...cur, toAdd] } } }
      }
      case 'create_record': {
        const target = env.modules.find((x) => x.id === a.moduleId)
        if (!target) return fail('Target module no longer exists')
        const data: Record<string, unknown> = {}
        for (const [fid, tpl] of Object.entries(a.values ?? {})) {
          const f = target.fields.find((x) => x.id === fid)
          if (!f || isEmpty(tpl)) continue
          const v = coerce(env, m, f, tpl, rec, trigValue)
          if (v !== undefined && v !== '') data[fid] = v
        }
        return { ...base, ok: true, summary: `Create a ${target.name} record (${Object.keys(data).length} field${Object.keys(data).length === 1 ? '' : 's'} filled)`, effect: { kind: 'create', moduleId: target.id, data } }
      }
      case 'create_task':
      case 'create_followup': {
        const days = a.days ?? (a.type === 'create_followup' ? 2 : 0)
        const title = renderTemplate(a.title || (a.type === 'create_followup' ? 'Follow up: {{title}}' : 'Task for {{title}}'), m, rec, ctxOf(env), env.now, trigValue)
        const assignee = a.userId === 'owner' || !a.userId ? (rec.createdBy ?? '') : a.userId
        const data = { title, status: 'to_do', priority: 'medium', due: format(addDays(env.now, days), 'yyyy-MM-dd'), assignee, related: `${m.name}: ${recordTitle(m, rec, ctxOf(env))}`, notes: 'Created by workflow' }
        return { ...base, ok: true, summary: `Create task "${title}" due ${data.due}`, effect: { kind: 'task', data } }
      }
      case 'notify': {
        const message = renderTemplate(a.message || 'Workflow notification for {{title}}', m, rec, ctxOf(env), env.now, trigValue)
        return { ...base, ok: true, summary: `Show in-app notification: ${message}`, effect: { kind: 'notify', message } }
      }
      default:
        return fail(`Action "${String((a as { type: string }).type)}" is not available`)
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Unknown error')
  }
}

// ---- dry run ---------------------------------------------------------------------------------------------------

export type SkipReason = 'trigger_not_matched' | 'conditions_not_met' | 'duplicate_event' | 'loop_prevented' | 'depth_limit' | 'disabled' | 'no_module'

export interface DryRunNode {
  workflowId: string
  workflowName: string
  recordId: string
  idempotencyKey: string
  /** which module the record belongs to (for display) */
  moduleId: string
  skipped?: SkipReason
  steps: PlannedStep[]
  status: 'would_run' | 'skipped' | 'would_fail'
  children: DryRunNode[]
}

export interface DryRunResult {
  nodes: DryRunNode[]
  totals: { workflowsRun: number; updates: number; creates: number; tasks: number; notifications: number; failures: number; skipped: number }
  loopPrevented: boolean
  /** always 0: previews never send anything, and this app has no outbound messaging */
  messagesSent: 0
  /** always true: nothing in the stores was touched */
  sideEffectFree: true
}

export interface DryRunOptions {
  /** run only this workflow (preview of one workflow) */
  only?: string
  /** ids of workflows to treat as enabled even though they are not (previewing a draft) */
  assumeEnabled?: Set<string>
  /** skip the trigger match and evaluate conditions/actions directly (sandbox: "what would this do to this record") */
  force?: boolean
  maxDepth?: number
  /** event keys already processed (duplicate-event simulation) */
  seenKeys?: Set<string>
}

export function dryRun(env: PlanEnv, workflows: Workflow[], event: EventLike, opts: DryRunOptions = {}): DryRunResult {
  const maxDepth = opts.maxDepth ?? MAX_CASCADE_DEPTH
  const seen = opts.seenKeys ?? new Set<string>()
  const records = new Map(env.records.map((r) => [r.id, structuredClone(r)]))
  let virtualId = 0
  let loopPrevented = false
  const live = () => ({ ...env, records: [...records.values()] })

  const eligible = (w: Workflow) => w.enabled || !!opts.assumeEnabled?.has(w.id)

  const fire = (wf: Workflow, e: EventLike, depth: number, chain: string[]): DryRunNode => {
    const key = idempotencyKey(wf, e)
    const node: DryRunNode = { workflowId: wf.id, workflowName: wf.name, recordId: e.record.id, idempotencyKey: key, moduleId: wf.moduleId, steps: [], status: 'skipped', children: [] }
    const skip = (r: SkipReason) => ((node.skipped = r), node)
    if (depth >= maxDepth) return skip('depth_limit')
    if (chain.includes(wf.id)) {
      loopPrevented = true
      return skip('loop_prevented')
    }
    if (seen.has(key)) return skip('duplicate_event')
    seen.add(key)
    const m = env.modules.find((x) => x.id === wf.moduleId)
    if (!m) return skip('no_module')
    const cur = records.get(e.record.id) ?? e.record
    if (!conditionsPass(wf, m, cur, ctxOf(live()))) return skip('conditions_not_met')
    node.status = 'would_run'
    const m2 = matchTrigger(wf, e)
    const events: EventLike[] = []
    let vrec = structuredClone(cur)
    for (const a of wf.actions) {
      const step = planAction(live(), a, vrec, m2.value)
      node.steps.push(step)
      if (!step.ok) {
        node.status = 'would_fail'
        break
      }
      const ef = step.effect
      if (ef?.kind === 'update') {
        const prev = structuredClone(vrec)
        vrec = { ...vrec, data: { ...vrec.data, ...ef.patch }, updatedAt: env.now.toISOString() }
        records.set(vrec.id, vrec)
        if (Object.keys(ef.patch).some((k) => !same(prev.data[k], vrec.data[k]))) events.push({ type: 'updated', record: structuredClone(vrec), previous: prev, eventId: `${key}#${node.steps.length}` })
      } else if (ef?.kind === 'create') {
        const nr: CrmRecord = { id: `dry_${++virtualId}`, workspaceId: vrec.workspaceId, moduleId: ef.moduleId, data: ef.data, createdAt: env.now.toISOString(), updatedAt: env.now.toISOString(), createdBy: vrec.createdBy }
        records.set(nr.id, nr)
        events.push({ type: 'created', record: structuredClone(nr), eventId: `${key}#${node.steps.length}` })
      }
    }
    for (const ev of events) {
      for (const w2 of workflows) {
        if (w2.moduleId !== ev.record.moduleId || !eligible(w2) || !matchTrigger(w2, ev).ok) continue
        node.children.push(fire(w2, ev, depth + 1, [...chain, wf.id]))
      }
    }
    return node
  }

  const nodes: DryRunNode[] = []
  for (const wf of workflows) {
    if (opts.only && wf.id !== opts.only) continue
    if (wf.moduleId !== event.record.moduleId) continue
    if (!opts.only && !eligible(wf)) continue
    if (!opts.force && !matchTrigger(wf, event).ok) continue
    nodes.push(fire(wf, event, 0, []))
  }
  const totals = { workflowsRun: 0, updates: 0, creates: 0, tasks: 0, notifications: 0, failures: 0, skipped: 0 }
  const walk = (n: DryRunNode) => {
    if (n.status === 'skipped') totals.skipped++
    else {
      totals.workflowsRun++
      if (n.status === 'would_fail') totals.failures++
    }
    for (const s of n.steps) {
      if (!s.ok || !s.effect) continue
      if (s.effect.kind === 'update') totals.updates++
      else if (s.effect.kind === 'create') totals.creates++
      else if (s.effect.kind === 'task') totals.tasks++
      else totals.notifications++
    }
    n.children.forEach(walk)
  }
  nodes.forEach(walk)
  return { nodes, totals, loopPrevented, messagesSent: 0, sideEffectFree: true }
}

export function describeSkip(r: SkipReason): string {
  switch (r) {
    case 'trigger_not_matched':
      return 'trigger did not match'
    case 'conditions_not_met':
      return 'conditions not met'
    case 'duplicate_event':
      return 'duplicate event: already processed'
    case 'loop_prevented':
      return 'stopped: this workflow is already running in the same chain (loop prevention)'
    case 'depth_limit':
      return 'stopped: too many chained workflows'
    case 'disabled':
      return 'workflow is off'
    case 'no_module':
      return 'module no longer exists'
  }
}
