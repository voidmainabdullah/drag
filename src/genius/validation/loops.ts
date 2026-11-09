import type { Workflow } from '#/types'
import { issue, type Issue } from './issues'

interface Write {
  moduleId: string
  kind: 'create' | 'update'
  fieldId?: string
  value?: unknown
}

function writesOf(w: Workflow): Write[] {
  const out: Write[] = []
  for (const a of w.actions) {
    switch (a.type) {
      case 'update_record':
      case 'change_status':
        out.push({ moduleId: w.moduleId, kind: 'update', fieldId: a.fieldId, value: a.value })
        break
      case 'assign_user':
        out.push({ moduleId: w.moduleId, kind: 'update', fieldId: a.fieldId, value: a.userId })
        break
      case 'add_tag':
        out.push({ moduleId: w.moduleId, kind: 'update', fieldId: a.fieldId, value: a.value })
        break
      case 'create_record':
        if (a.moduleId) out.push({ moduleId: a.moduleId, kind: 'create' })
        break
      default:
    }
  }
  return out
}

/** Does a write of `wr` fire workflow `w`'s trigger? */
function fires(wr: Write, w: Workflow): boolean {
  if (wr.moduleId !== w.moduleId) return false
  const t = w.trigger
  switch (t.type) {
    case 'record_created':
      return wr.kind === 'create'
    case 'record_updated':
      return wr.kind === 'update'
    case 'field_changed':
    case 'status_changed':
    case 'relation_created':
    case 'relation_updated':
      if (wr.kind !== 'update' || wr.fieldId !== t.fieldId) return false
      return t.value === undefined || t.value === null || t.value === '' || String(t.value) === String(wr.value)
    default:
      return false
  }
}

const guardedBy = (w: Workflow, wr: Write) => wr.kind === 'update' && !!wr.fieldId && w.conditions.some((c) => c.fieldId === wr.fieldId)

/**
 * Static trigger-loop detection: workflow A's actions can fire workflow B, whose actions can fire A again.
 * (Runtime has its own depth/chain guard; this refuses to ship the loop in the first place.)
 */
export function detectWorkflowLoops(workflows: Workflow[], onlyTouched?: Set<string>): Issue[] {
  // disabled workflows count too: switching one on must not create a loop
  const active = workflows
  const edges = new Map<string, { to: string; guarded: boolean; selfCreate: boolean }[]>()
  for (const w1 of active) {
    const list: { to: string; guarded: boolean; selfCreate: boolean }[] = []
    for (const wr of writesOf(w1)) {
      for (const w2 of active) {
        if (!fires(wr, w2)) continue
        if (w1.id === w2.id && wr.kind === 'update') continue // constant writes to the same record settle after one pass
        list.push({ to: w2.id, guarded: guardedBy(w2, wr) || (wr.kind === 'create' && w2.conditions.length > 0), selfCreate: w1.id === w2.id && wr.kind === 'create' })
      }
    }
    edges.set(w1.id, list)
  }
  const byId = new Map(active.map((w) => [w.id, w]))
  const issues: Issue[] = []
  const state = new Map<string, 0 | 1 | 2>()
  const seen = new Set<string>()
  const visit = (id: string, path: { id: string; guarded: boolean }[]) => {
    const s = state.get(id)
    if (s === 2) return
    if (s === 1) {
      const start = path.findIndex((p) => p.id === id)
      const cycle = path.slice(start)
      const key = cycle.map((c) => c.id).sort().join('>')
      if (seen.has(key)) return
      seen.add(key)
      const names = cycle.map((c) => byId.get(c.id)?.name ?? c.id)
      const guarded = cycle.every((c) => c.guarded)
      const touchesNew = !onlyTouched || cycle.some((c) => onlyTouched.has(c.id))
      if (touchesNew)
        issues.push(
          issue(
            'cycles',
            guarded ? 'WORKFLOW_LOOP_GUARDED' : 'WORKFLOW_LOOP',
            `workflows.${cycle[0].id}`,
            `Workflows can trigger each other in a loop: ${[...names, names[0]].join(' → ')}`,
            guarded ? 'Conditions limit the loop; check they really stop it, or add a "not already done" condition.' : 'Change one workflow so its action does not re-trigger the other (different field, or add a condition that is false after the first run).',
            guarded ? 'warning' : 'error',
          ),
        )
      return
    }
    state.set(id, 1)
    for (const e of edges.get(id) ?? []) visit(e.to, [...path, { id, guarded: e.guarded }])
    state.set(id, 2)
  }
  for (const w of active) visit(w.id, [])
  // a workflow that creates records in its own trigger module recurses without end
  for (const w of active) {
    if ((edges.get(w.id) ?? []).some((e) => e.to === w.id && e.selfCreate) && (!onlyTouched || onlyTouched.has(w.id))) {
      const guarded = w.conditions.length > 0
      issues.push(
        issue('cycles', guarded ? 'WORKFLOW_LOOP_GUARDED' : 'WORKFLOW_LOOP', `workflows.${w.id}`, `"${w.name}" creates records in the module that triggers it, so every new record would start it again`, 'Create the record in a different module, or add a condition that is false for the records it creates.', guarded ? 'warning' : 'error'),
      )
    }
  }
  return issues
}
