import { addDays, format } from 'date-fns'
import type { CrmRecord, Workflow } from '#/types'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useRunStore, useWorkflowStore } from '#/stores/collections'
import { useUserStore } from '#/stores/userStore'
import { useGeniusStore } from '../state/geniusStore'
import { safeDate, makeCtx, recordTitle } from '#/utils/records'
import { classifyWorkflow } from './classify'
import { conditionsPass, dryRun, type DryRunNode, type PlanEnv } from './core'

export interface WorkflowPreview {
  workflowId: string
  workflowName: string
  /** records the trigger would pick up right now (date/schedule triggers) or every record (event triggers: "if it fired for each") */
  considered: number
  /** of those, records whose conditions pass */
  matching: number
  sample: { recordId: string; title: string; node: DryRunNode }[]
  totals: { updates: number; creates: number; tasks: number; notifications: number; failures: number }
  consequential: boolean
  reasons: string[]
  /** always 0: a preview never sends anything */
  messagesSent: 0
  /** always true: no record, run log or setting was written */
  sideEffectFree: true
  notes: string[]
}

/**
 * Dry run: which records match, which actions WOULD run, and what WOULD change. Reads the stores, writes nothing,
 * sends nothing (this app has no outbound channel at all). The same planner the live engine uses produces the result.
 */
export function previewWorkflow(workflowId: string, opts: { now?: Date; limit?: number; actor?: string } = {}): WorkflowPreview | null {
  const wf = useWorkflowStore.getState().items.find((w) => w.id === workflowId)
  if (!wf) return null
  const modules = useModuleStore.getState().modules
  const records = useRecordStore.getState().records
  const users = useUserStore.getState().users
  const now = opts.now ?? new Date()
  const m = modules.find((x) => x.id === wf.moduleId)
  const env: PlanEnv = { modules, records, users, now }
  const ctx = makeCtx(modules, records, users)
  const limit = opts.limit ?? 200
  const all = records.filter((r) => r.moduleId === wf.moduleId && !r.deletedAt && !r.archived)
  const notes: string[] = []

  let candidates: CrmRecord[] = all
  if (wf.trigger.type === 'date_reached' && wf.trigger.fieldId) {
    const today = format(now, 'yyyy-MM-dd')
    const cutoff = format(addDays(now, -7), 'yyyy-MM-dd')
    const fired = new Set(useRunStore.getState().runs.map((r) => r.key))
    candidates = all.filter((r) => {
      const d = safeDate(r.data[wf.trigger.fieldId!])
      if (!d) return false
      const target = format(addDays(d, wf.trigger.offsetDays ?? 0), 'yyyy-MM-dd')
      return target <= today && target >= cutoff && !fired.has(`${wf.id}:${r.id}:${target}`)
    })
    notes.push('Records whose date (plus the offset) is reached within the last 7 days and that have not been processed yet.')
  } else if (wf.trigger.type === 'scheduled') notes.push(`Would run for every record of the module every ${wf.trigger.everyMinutes ?? '?'} minutes while the app is open.`)
  else if (wf.trigger.type === 'manual') notes.push('Runs only when someone presses Run on a record.')
  else notes.push('Shows what would happen if the trigger fired for each existing record. Nothing fires until a record is actually created or changed.')

  const matching = candidates.filter((r) => conditionsPass(wf, m, r, ctx))
  const totals = { updates: 0, creates: 0, tasks: 0, notifications: 0, failures: 0 }
  const sample: WorkflowPreview['sample'] = []
  for (const r of matching.slice(0, limit)) {
    const res = dryRun(env, [wf], { type: 'updated', record: r, eventId: 'preview' }, { only: wf.id, assumeEnabled: new Set([wf.id]), force: true })
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += res.totals[k === 'failures' ? 'failures' : k]
    if (sample.length < 5 && res.nodes[0]) sample.push({ recordId: r.id, title: m ? recordTitle(m, r, ctx) : r.id, node: res.nodes[0] })
  }
  if (matching.length > limit) notes.push(`Totals cover the first ${limit} of ${matching.length} matching records.`)
  const cls = classifyWorkflow(wf, modules)
  return { workflowId: wf.id, workflowName: wf.name, considered: candidates.length, matching: matching.length, sample, totals, consequential: cls.consequential, reasons: cls.reasons, messagesSent: 0, sideEffectFree: true, notes }
}

/** Record that a person looked at a dry run (audit trail for the approval that follows). */
export function logPreview(wf: Workflow, p: WorkflowPreview, actor: string) {
  useGeniusStore.getState().audit1({ actor, workspaceId: wf.workspaceId, action: 'dry_run', target: wf.id, detail: `Dry run of "${wf.name}": ${p.matching} record(s) match, ${p.totals.tasks} task(s), ${p.totals.updates} update(s), ${p.totals.creates} create(s); nothing was applied` })
}
