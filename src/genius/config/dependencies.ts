import type { Module } from '#/types'
import { dependenciesOf, type FormulaSchema } from '../formula/analysis'
import { parseExpression } from '../formula/parser'
import type { ConfigModel } from './model'

export interface Dependent {
  kind: 'formula' | 'workflow' | 'dashboard' | 'relationship' | 'pipeline' | 'constraint' | 'module'
  id: string
  moduleId?: string
  label: string
}

export const schemaOf =
  (cfg: ConfigModel): FormulaSchema =>
  (id) =>
    cfg.modules.find((m) => m.id === id)

/** Formula specs of the whole config with their real dependencies (cross-module, aggregate-aware). */
export function formulaNodes(cfg: ConfigModel) {
  const schema = schemaOf(cfg)
  const out: { moduleId: string; fieldId: string; deps: ReturnType<typeof dependenciesOf> }[] = []
  for (const m of cfg.modules) {
    for (const f of m.fields) {
      if (f.type !== 'formula' || !f.formulaSpec) continue
      try {
        out.push({ moduleId: m.id, fieldId: f.id, deps: dependenciesOf(f.formulaSpec.ast ?? parseExpression(f.formulaSpec.expression), m.id, schema) })
      } catch {
        out.push({ moduleId: m.id, fieldId: f.id, deps: [] })
      }
    }
  }
  return out
}

/** Things that would break if `moduleId.fieldId` disappeared. (Forms and views are cleaned up automatically, so they are not listed.) */
export function fieldDependents(cfg: ConfigModel, moduleId: string, fieldId: string): Dependent[] {
  const out: Dependent[] = []
  const mod = cfg.modules.find((m) => m.id === moduleId)
  for (const n of formulaNodes(cfg)) {
    if (n.moduleId === moduleId && n.fieldId === fieldId) continue
    if (n.deps.some((d) => d.moduleId === moduleId && d.fieldId === fieldId)) {
      const label = cfg.modules.find((m) => m.id === n.moduleId)?.fields.find((f) => f.id === n.fieldId)?.label ?? n.fieldId
      out.push({ kind: 'formula', id: n.fieldId, moduleId: n.moduleId, label: `Formula "${label}"` })
    }
  }
  for (const w of cfg.workflows) {
    const own = w.moduleId === moduleId
    const refs =
      (own && (w.trigger.fieldId === fieldId || w.conditions.some((c) => c.fieldId === fieldId) || w.actions.some((a) => a.fieldId === fieldId))) ||
      w.actions.some((a) => a.moduleId === moduleId && a.values && fieldId in a.values)
    if (refs) out.push({ kind: 'workflow', id: w.id, moduleId: w.moduleId, label: `Workflow "${w.name}"` })
  }
  for (const d of cfg.dashboards) {
    if (d.widgets.some((w) => w.moduleId === moduleId && (w.fieldId === fieldId || w.groupBy === fieldId || w.dateField === fieldId || w.filters.some((f) => f.fieldId === fieldId))))
      out.push({ kind: 'dashboard', id: d.id, label: `Dashboard "${d.name}"` })
  }
  for (const m of cfg.modules) {
    for (const f of m.fields) {
      if (f.relation?.moduleId === moduleId && f.relation.lookupFieldId === fieldId) out.push({ kind: 'relationship', id: f.id, moduleId: m.id, label: `Relationship "${f.label}" (picker shows this field)` })
      if (m.id === moduleId && f.pipeline && Object.values(f.pipeline.requiredFields ?? {}).some((ids) => ids.includes(fieldId))) out.push({ kind: 'pipeline', id: f.id, moduleId: m.id, label: `Pipeline "${f.label}" (required for a stage)` })
    }
  }
  if (mod?.constraints?.uniqueTogether?.some((g) => g.includes(fieldId))) out.push({ kind: 'constraint', id: fieldId, moduleId, label: 'A unique-together constraint' })
  return out
}

/** Things outside the module that would break if the module itself were deleted. */
export function moduleDependents(cfg: ConfigModel, moduleId: string): Dependent[] {
  const out: Dependent[] = []
  for (const m of cfg.modules) {
    if (m.id === moduleId) continue
    for (const f of m.fields) {
      if (f.relation?.moduleId === moduleId) out.push({ kind: 'relationship', id: f.id, moduleId: m.id, label: `Relationship "${f.label}" in ${m.name}` })
    }
  }
  for (const n of formulaNodes(cfg)) {
    if (n.moduleId !== moduleId && n.deps.some((d) => d.moduleId === moduleId)) {
      const mm = cfg.modules.find((m) => m.id === n.moduleId)
      out.push({ kind: 'formula', id: n.fieldId, moduleId: n.moduleId, label: `Formula "${mm?.fields.find((f) => f.id === n.fieldId)?.label ?? n.fieldId}" in ${mm?.name}` })
    }
  }
  for (const w of cfg.workflows) if (w.moduleId !== moduleId && w.actions.some((a) => a.moduleId === moduleId)) out.push({ kind: 'workflow', id: w.id, moduleId: w.moduleId, label: `Workflow "${w.name}"` })
  for (const d of cfg.dashboards) if (d.widgets.some((w) => w.moduleId === moduleId)) out.push({ kind: 'dashboard', id: d.id, label: `Dashboard "${d.name}"` })
  return out
}

export const moduleLabel = (m: Module | undefined, fallback: string) => m?.name ?? fallback
