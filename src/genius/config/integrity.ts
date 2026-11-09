import type { ConfigModel } from './model'
import { formulaNodes } from './dependencies'

const META = new Set(['__createdAt', '__updatedAt'])

/** Dangling references in a configuration: used to refuse an undo/restore that would leave the CRM inconsistent. */
export function integrityProblems(cfg: ConfigModel): string[] {
  const out: string[] = []
  const mods = new Map(cfg.modules.map((m) => [m.id, m]))
  const hasField = (mid: string | undefined, fid: string | undefined) => !fid || META.has(fid) || !mid || !!mods.get(mid)?.fields.some((f) => f.id === fid)
  for (const m of cfg.modules) {
    for (const f of m.fields) {
      if (f.relation && !mods.has(f.relation.moduleId)) out.push(`${m.name}: relationship "${f.label}" points to a module that no longer exists`)
    }
  }
  for (const n of formulaNodes(cfg)) for (const d of n.deps) if (!mods.has(d.moduleId) || !hasField(d.moduleId, d.fieldId)) out.push(`Formula ${n.moduleId}.${n.fieldId} reads ${d.moduleId}.${d.fieldId}, which does not exist`)
  for (const f of cfg.forms) {
    if (!mods.has(f.moduleId)) out.push(`Form "${f.name}" belongs to a missing module`)
    else for (const s of f.sections) for (const i of s.items) if (!hasField(f.moduleId, i.fieldId)) out.push(`Form "${f.name}" uses missing field ${i.fieldId}`)
  }
  for (const v of cfg.views) {
    if (!mods.has(v.moduleId)) out.push(`View "${v.name}" belongs to a missing module`)
    else for (const fid of [v.config.groupBy, v.config.dateFieldId, ...v.config.filters.map((f) => f.fieldId)]) if (!hasField(v.moduleId, fid)) out.push(`View "${v.name}" uses missing field ${fid}`)
  }
  for (const w of cfg.workflows) {
    if (!mods.has(w.moduleId)) out.push(`Workflow "${w.name}" belongs to a missing module`)
    else {
      for (const fid of [w.trigger.fieldId, ...w.conditions.map((c) => c.fieldId), ...w.actions.map((a) => (a.moduleId ? undefined : a.fieldId))]) if (!hasField(w.moduleId, fid)) out.push(`Workflow "${w.name}" uses missing field ${fid}`)
      for (const a of w.actions) if (a.moduleId && !mods.has(a.moduleId)) out.push(`Workflow "${w.name}" creates records in a missing module`)
    }
  }
  for (const d of cfg.dashboards) for (const w of d.widgets) if (w.moduleId && (!mods.has(w.moduleId) || !hasField(w.moduleId, w.fieldId) || !hasField(w.moduleId, w.groupBy))) out.push(`Dashboard "${d.name}": "${w.title}" uses something that no longer exists`)
  return out
}
