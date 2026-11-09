import type { Change, ChangeKind } from '../compiler/apply'
import type { ConfigModel } from '../config/model'
import type { Proposal } from '../state/types'
import type { Issue } from '../validation/issues'

export interface BuildSummary {
  created: Change[]
  modified: Change[]
  removed: Change[]
  /** existing components this change does not touch (records are never touched by a configuration change) */
  preserved: { kind: 'modules' | 'forms' | 'views' | 'workflows' | 'dashboards'; count: number }[]
  notImplementable: Issue[]
  assumptions: string[]
  needsApproval: Proposal['needsApproval']
  /** true when something in the proposal cannot be done inside this app and would need an outside tool */
  externalAutomation: boolean
}

const KIND_LABEL: Record<ChangeKind, string> = { module: 'module', field: 'field', relationship: 'relationship', form: 'form', view: 'view', pipeline: 'pipeline', workflow: 'workflow', formula: 'formula', dashboard: 'dashboard', role: 'role', permission: 'permission rule' }
export const kindLabel = (k: ChangeKind) => KIND_LABEL[k]

/** Plain-language summary of a proposal against the live configuration. Pure. */
export function summarizeProposal(p: Proposal, cfg: ConfigModel): BuildSummary {
  const created = p.changes.filter((c) => c.op === 'add')
  const modified = p.changes.filter((c) => c.op === 'update' || c.op === 'enable' || c.op === 'disable')
  const removed = p.changes.filter((c) => c.op === 'remove' || c.op === 'archive')
  const touchedModules = new Set(p.changes.flatMap((c) => (c.kind === 'module' ? [c.id] : c.moduleId ? [c.moduleId] : [])))
  const touched = (kind: ChangeKind) => new Set(p.changes.filter((c) => c.kind === kind).map((c) => c.id))
  const tf = touched('form')
  const tv = touched('view')
  const tw = touched('workflow')
  const td = touched('dashboard')
  const userModules = cfg.modules.filter((m) => !m.system && !m.archived)
  const preserved: BuildSummary['preserved'] = [
    { kind: 'modules', count: userModules.filter((m) => !touchedModules.has(m.id)).length },
    { kind: 'forms', count: cfg.forms.filter((f) => !tf.has(f.id)).length },
    { kind: 'views', count: cfg.views.filter((v) => !tv.has(v.id)).length },
    { kind: 'workflows', count: cfg.workflows.filter((w) => !tw.has(w.id)).length },
    { kind: 'dashboards', count: cfg.dashboards.filter((d) => !td.has(d.id)).length },
  ]
  const externalAutomation = p.notImplementable.length > 0
  return { created, modified, removed, preserved, notImplementable: p.notImplementable, assumptions: p.assumptions, needsApproval: p.needsApproval, externalAutomation }
}
