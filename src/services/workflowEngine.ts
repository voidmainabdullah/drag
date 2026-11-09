import { addDays, format } from 'date-fns'
import type { CrmRecord, Workflow, WorkflowStep } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { onRecordEvent, type RecordEvent } from '#/utils/events'
import { displayValue, recordTitle, safeDate } from '#/utils/records'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useWorkflowStore, useRunStore } from '#/stores/collections'
import { useUserStore } from '#/stores/userStore'
import { logActivity } from '#/stores/activityStore'
import { toast } from '#/utils/toast'
import { conditionsPass, ctxOf, idempotencyKey, MAX_ATTEMPTS, MAX_CASCADE_DEPTH, matchTrigger, mayRun, planAction, type Effect, type PlanEnv } from '#/genius/workflow/core'
import { ensureTasksModule } from './moduleService'
import { handleFlowEvent } from './dataFlowEngine'

/**
 * Live workflow engine. All decisions (does the trigger match, do the conditions pass, what would each action do) come
 * from `genius/workflow/core`, the same pure code the dry-run uses; this file only PERFORMS the planned effects.
 *
 * Guarantees: chain-based loop prevention, idempotency keys (a duplicate event or repeated tick never runs twice),
 * a per-action step log, bounded retries that skip steps which already succeeded, and an append-only run log.
 * Scope: it runs in the open browser tab. Nothing is sent outside the app.
 */

const env = (): PlanEnv => ({ modules: useModuleStore.getState().modules, records: useRecordStore.getState().records, users: useUserStore.getState().users, now: new Date() })

function logRun(wf: Workflow, status: 'success' | 'skipped' | 'error', message: string, rec?: CrmRecord, extra: { key?: string; steps?: WorkflowStep[]; attempt?: number } = {}) {
  useRunStore.getState().add({
    id: uid('run'),
    workspaceId: wf.workspaceId,
    workflowId: wf.id,
    workflowName: wf.name,
    recordId: rec?.id,
    moduleId: rec?.moduleId ?? wf.moduleId,
    status,
    message,
    at: nowIso(),
    key: extra.key,
    steps: extra.steps,
    attempt: extra.attempt,
    frozen: wf.origin === 'ai' || !!wf.consequential ? true : undefined,
  })
}

/** Perform one planned effect. Throws if the write is refused (e.g. a pipeline rule). */
function perform(e: Effect, rec: CrmRecord, depth: number, chain: string[]): string {
  const rs = useRecordStore.getState()
  switch (e.kind) {
    case 'update': {
      const res = rs.update(e.recordId, e.patch, { depth: depth + 1, chain })
      if (!res) throw new Error('The record no longer exists')
      if (res.errors) throw new Error(Object.values(res.errors)[0] ?? 'The change was refused')
      return 'updated'
    }
    case 'create': {
      const res = rs.create(e.moduleId, e.data, { depth: depth + 1, chain, validate: false })
      if (!res.record) throw new Error('Could not create record')
      return 'created'
    }
    case 'task': {
      const tm = ensureTasksModule(rec.workspaceId)
      rs.create(tm.id, e.data, { depth: depth + 1, chain, validate: false })
      return 'task'
    }
    case 'notify': {
      toast.info('Workflow', e.message)
      logActivity({ workspaceId: rec.workspaceId, action: 'workflow_notification', entity: 'workflow', moduleId: rec.moduleId, recordId: rec.id, description: e.message })
      return 'notified'
    }
  }
}

export interface ExecOpts {
  key?: string
  trigValue?: unknown
  /** manual run: skip the activation gate */
  force?: boolean
  chain?: string[]
  attempt?: number
  /** outcomes of an earlier attempt: steps that succeeded are not repeated */
  priorSteps?: WorkflowStep[]
}

/** Has a run with this key already finished (success, or skipped for a reason that will not change)? */
const alreadyDone = (key: string | undefined) => !!key && useRunStore.getState().runs.some((r) => r.key === key && (r.status === 'success' || (r.status === 'skipped' && r.message.startsWith('Conditions not met'))))

export function executeWorkflow(wf: Workflow, recordInput: CrmRecord, depth = 0, opts: ExecOpts = {}): boolean {
  const rec = useRecordStore.getState().records.find((r) => r.id === recordInput.id) ?? recordInput
  const chain = opts.chain ?? []
  const attempt = opts.attempt ?? 1
  if (depth >= MAX_CASCADE_DEPTH) {
    logRun(wf, 'error', 'Stopped: workflows triggered each other too many times (loop protection)', rec, { key: opts.key })
    return false
  }
  if (chain.includes(wf.id)) {
    logRun(wf, 'skipped', 'Stopped: this workflow was already running in this chain (loop prevention)', rec, { key: opts.key })
    return false
  }
  if (alreadyDone(opts.key)) {
    logRun(wf, 'skipped', 'Duplicate event ignored: this exact event was already processed')
    return false
  }
  if (!opts.force && !mayRun({ ...wf, enabled: true })) {
    logRun(wf, 'skipped', 'Not run: this workflow needs your approval before it can run', rec, { key: opts.key })
    return false
  }
  const e = env()
  const m = e.modules.find((x) => x.id === wf.moduleId)
  if (!conditionsPass(wf, m, rec, ctxOf(e))) {
    logRun(wf, 'skipped', 'Conditions not met', rec, { key: opts.key })
    return false
  }
  const steps: WorkflowStep[] = []
  let failed = false
  for (const a of wf.actions) {
    const prior = opts.priorSteps?.find((s) => s.actionId === a.id && s.status === 'ok')
    if (prior) {
      steps.push({ ...prior, message: `${prior.message} (already done in an earlier attempt)` })
      continue
    }
    if (failed) {
      steps.push({ actionId: a.id, type: a.type, status: 'skipped', message: 'Not run: an earlier step failed' })
      continue
    }
    const cur = useRecordStore.getState().records.find((r) => r.id === rec.id) ?? rec
    const plan = planAction(env(), a, cur, opts.trigValue)
    if (!plan.ok) {
      failed = true
      steps.push({ actionId: a.id, type: a.type, status: 'error', message: plan.error ?? 'Failed' })
      continue
    }
    try {
      if (plan.effect) perform(plan.effect, cur, depth, [...chain, wf.id])
      steps.push({ actionId: a.id, type: a.type, status: 'ok', message: plan.summary })
    } catch (err) {
      failed = true
      steps.push({ actionId: a.id, type: a.type, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
    }
  }
  const title = m ? recordTitle(m, rec) : rec.id
  if (failed) {
    const bad = steps.find((s) => s.status === 'error')
    logRun(wf, 'error', `${steps.filter((s) => s.status === 'ok').length} step(s) done, then failed: ${bad?.message}`, rec, { key: opts.key, steps, attempt })
    return false
  }
  logRun(wf, 'success', `${steps.map((s) => s.message).join('; ') || 'No actions'} — on "${title}"`, rec, { key: opts.key, steps, attempt })
  logActivity({ workspaceId: wf.workspaceId, action: 'workflow_ran', entity: 'workflow', moduleId: rec.moduleId, recordId: rec.id, description: `Workflow "${wf.name}" ran (${steps.length} action${steps.length === 1 ? '' : 's'})` })
  return true
}

/** Retry the latest failed run of a key. Completed steps are not repeated; attempts are bounded. */
export function retryRun(runId: string): { ok: boolean; reason?: string } {
  const runs = useRunStore.getState().runs
  const run = runs.find((r) => r.id === runId)
  if (!run || run.status !== 'error' || !run.key || !run.recordId) return { ok: false, reason: 'Only a failed run with a recorded event can be retried' }
  const latest = runs.filter((r) => r.key === run.key).sort((a, b) => b.at.localeCompare(a.at))[0]
  if (latest.status === 'success') return { ok: false, reason: 'This event already succeeded' }
  const attempt = (latest.attempt ?? 1) + 1
  if (attempt > MAX_ATTEMPTS) return { ok: false, reason: `Stopped after ${MAX_ATTEMPTS} attempts: investigate and fix the cause first` }
  const wf = useWorkflowStore.getState().items.find((w) => w.id === run.workflowId)
  const rec = useRecordStore.getState().records.find((r) => r.id === run.recordId)
  if (!wf || !rec) return { ok: false, reason: 'The workflow or record no longer exists' }
  return { ok: executeWorkflow(wf, rec, 0, { key: run.key, attempt, priorSteps: latest.steps }) }
}

/** Process one record event. Exported so a duplicate delivery can be tested (and replayed) deterministically. */
export function handleRecordEvent(e: RecordEvent) {
  const wfs = useWorkflowStore.getState().items.filter((w) => w.enabled && w.moduleId === e.record.moduleId && w.workspaceId === e.record.workspaceId)
  for (const wf of wfs) {
    const r = matchTrigger(wf, e)
    if (!r.ok) continue
    let value = r.value
    const f = useModuleStore.getState().modules.find((x) => x.id === wf.moduleId)?.fields.find((x) => x.id === wf.trigger.fieldId)
    if (f && value !== undefined) value = displayValue(f, value, ctxOf(env()))
    executeWorkflow(wf, e.record, e.depth, { key: idempotencyKey(wf, e), trigValue: value, chain: e.chain })
  }
  // module-to-module data flows share the same event bus and depth limit
  handleFlowEvent(e)
}

export function runDateTriggers(now = new Date()) {
  const wfs = useWorkflowStore.getState().items.filter((w) => w.enabled && w.trigger.type === 'date_reached' && w.trigger.fieldId)
  if (!wfs.length) return
  const today = format(now, 'yyyy-MM-dd')
  const cutoff = format(addDays(now, -7), 'yyyy-MM-dd')
  for (const wf of wfs) {
    const m = useModuleStore.getState().modules.find((x) => x.id === wf.moduleId)
    const f = m?.fields.find((x) => x.id === wf.trigger.fieldId)
    if (!m || !f) continue
    const offset = wf.trigger.offsetDays ?? 0
    const recs = useRecordStore.getState().records.filter((r) => r.moduleId === m.id && !r.deletedAt && !r.archived)
    for (const r of recs) {
      const d = safeDate(r.data[f.id])
      if (!d) continue
      const target = format(addDays(d, offset), 'yyyy-MM-dd')
      if (target > today || target < cutoff) continue
      const key = `${wf.id}:${r.id}:${target}`
      if (alreadyDone(key) || useRunStore.getState().runs.some((x) => x.key === key)) continue
      executeWorkflow(wf, r, 0, { key })
    }
  }
}

/**
 * `scheduled` triggers: run for every record of the module every N minutes. The tick time is persisted BEFORE running,
 * so a restart or a second tab never repeats a tick, and every run carries a per-slot idempotency key.
 */
export function runScheduled(now = new Date()) {
  const wfs = useWorkflowStore.getState().items.filter((w) => w.enabled && w.trigger.type === 'scheduled' && (w.trigger.everyMinutes ?? 0) >= 5)
  for (const wf of wfs) {
    const every = wf.trigger.everyMinutes! * 60_000
    const last = wf.lastScheduledAt ? Date.parse(wf.lastScheduledAt) : 0
    if (now.getTime() - last < every) continue
    const slot = Math.floor(now.getTime() / every)
    useWorkflowStore.getState().update(wf.id, { lastScheduledAt: now.toISOString() })
    const recs = useRecordStore.getState().records.filter((r) => r.moduleId === wf.moduleId && !r.deletedAt && !r.archived)
    for (const r of recs) executeWorkflow(wf, r, 0, { key: `${wf.id}:${r.id}:sched:${slot}` })
  }
}

export function runWorkflowNow(wf: Workflow, recordIds?: string[]): { ran: number; total: number } {
  const all = useRecordStore.getState().records.filter((r) => r.moduleId === wf.moduleId && !r.deletedAt && !r.archived)
  const targets = recordIds ? all.filter((r) => recordIds.includes(r.id)) : all
  let ran = 0
  // a manual run still needs the approval gate for AI-built / consequential workflows
  const gated = (wf.origin === 'ai' || wf.consequential) && !mayRun({ ...wf, enabled: true })
  if (gated) {
    logRun(wf, 'skipped', 'Not run: this workflow needs your approval before it can run')
    return { ran: 0, total: targets.length }
  }
  for (const r of targets) if (executeWorkflow(wf, r, 0, { force: true })) ran++
  if (!targets.length) logRun(wf, 'skipped', 'No records to run on')
  return { ran, total: targets.length }
}

let started = false
export function startWorkflowEngine() {
  if (started || typeof window === 'undefined') return
  started = true
  onRecordEvent(handleRecordEvent)
  const tick = () => {
    runDateTriggers()
    runScheduled()
  }
  setTimeout(tick, 1500)
  window.setInterval(tick, 60_000)
}
