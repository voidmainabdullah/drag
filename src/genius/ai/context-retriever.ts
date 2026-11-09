import type { Field, Module } from '#/types'
import { fieldDependents, formulaNodes } from '../config/dependencies'
import type { ConfigModel } from '../config/model'
import { canModule, fieldAccess, type Actor } from '../permissions/policy'
import { visibleConfig } from './context-manager'
import type { Intent } from './intent-parser'

/**
 * Retrieval of the RELEVANT slice of the configuration for one request, instead of sending the whole CRM.
 *
 *  1. match the request to modules (names, ids, field labels, workflow names)
 *  2. add what the validator will need to accept a change to them: relationship targets (both directions), the
 *     modules and fields their formulas read, formulas elsewhere that read them, workflows/dashboards that use them
 *  3. everything is filtered through the actor's permissions first: modules they cannot open and fields they cannot
 *     see are never sent, and formulas that read hidden data are redacted.
 * No record data is ever included, only configuration.
 */
export interface FieldContext {
  id: string
  label: string
  type: string
  required?: boolean
  unique?: boolean
  options?: { id: string; label: string }[]
  relation?: { to: string; cardinality: string; lookup?: string }
  formula?: { expression: string; resultType?: string } | { redacted: true }
  pipeline?: { transitions?: Record<string, string[]>; requiredFields?: Record<string, string[]> }
  currency?: string
}

export interface ModuleContext {
  id: string
  name: string
  kind?: string
  detail: 'full' | 'compact'
  why: string
  fields: FieldContext[]
  uniqueTogether?: string[][]
  titleFieldId?: string
}

export interface RetrievedContext {
  modules: ModuleContext[]
  /** other visible modules: id + name only */
  outline: { id: string; name: string }[]
  workflows: { id: string; name: string; module: string; enabled: boolean; trigger: unknown; conditions: unknown; actions: unknown }[]
  dashboards: { id: string; name: string; widgets: { title: string; module?: string; field?: string; agg: string }[] }[]
  forms: { id: string; name: string; module: string }[]
  views: { id: string; name: string; module: string }[]
  roles?: { id: string; name: string }[]
  /** things that would be affected by changes to the selected modules */
  dependents: { kind: string; id: string; label: string }[]
  /** ids of every module/field/workflow/dashboard/form/view included (for tests and token accounting) */
  ids: string[]
}

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'my', 'our', 'with', 'by', 'is', 'it', 'be', 'that', 'this', 'when', 'if', 'add', 'make', 'change', 'new', 'all', 'each', 'every', 'from', 'into', 'as', 'at', 'should', 'can', 'i', 'we', 'you', 'please', 'show', 'use', 'set', 'get', 'have', 'has', 'than', 'then', 'also', 'so', 'not'])

const stem = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem)

function fieldCtx(f: Field, actor: Actor, cfg: ConfigModel): FieldContext {
  const out: FieldContext = { id: f.id, label: f.label, type: f.type }
  if (f.required) out.required = true
  if (f.unique) out.unique = true
  if (f.options?.length) out.options = f.options.map((o) => ({ id: o.id, label: o.label }))
  if (f.currency) out.currency = f.currency
  if (f.relation) {
    const target = cfg.modules.find((m) => m.id === f.relation!.moduleId)
    out.relation = { to: target && canModule(actor.role, target, 'view') ? target.id : '(restricted)', cardinality: f.relation.cardinality, lookup: f.relation.lookupFieldId }
  }
  if (f.type === 'formula' && (f.formulaSpec || f.formula)) out.formula = { expression: f.formulaSpec?.expression ?? f.formula ?? '', resultType: f.formulaSpec?.resultType }
  if (f.pipeline) out.pipeline = { transitions: f.pipeline.transitions, requiredFields: f.pipeline.requiredFields }
  return out
}

export interface RetrieveOptions {
  maxModules?: number
}

export function retrieveContext(cfg: ConfigModel, actor: Actor, request: string, intent: Intent, opts: RetrieveOptions = {}): RetrievedContext {
  const vis = visibleConfig(cfg, actor)
  const modules = vis.modules.filter((m) => !m.system)
  const q = new Set(words(request))
  const text = request.toLowerCase()

  // 1. match
  const score = new Map<string, number>()
  const why = new Map<string, string>()
  const bump = (id: string, n: number, reason: string) => {
    score.set(id, (score.get(id) ?? 0) + n)
    if (!why.has(id)) why.set(id, reason)
  }
  for (const m of modules) {
    const names = [m.name, m.singularName ?? '', m.id.replace(/^mod_[a-z0-9]+_/, '')].flatMap(words)
    if (names.some((w) => q.has(w))) bump(m.id, 10, 'named in the request')
    for (const f of m.fields) {
      // links and auto-titles ("Student", "Title") exist in half the modules: matching them would select everything
      if (fieldAccess(actor.role, f) === 'hidden' || f.relation || f.id === 'display_title') continue
      const fw = [...words(f.label), ...words(f.id)]
      if (fw.length && fw.every((w) => q.has(w))) bump(m.id, 4, `field "${f.label}" mentioned`)
    }
  }
  for (const w of vis.workflows) {
    if (words(w.name).some((x) => q.has(x)) && words(w.name).filter((x) => q.has(x)).length >= 2) bump(w.moduleId, 6, `workflow "${w.name}" mentioned`)
  }
  const selected = new Set(
    [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, opts.maxModules ?? 6)
      .map(([id]) => id),
  )
  // a modify/repair request that names nothing: fall back to the most connected modules, still bounded
  if (!selected.size && intent !== 'new_build') {
    const connected = [...modules].sort((a, b) => b.fields.filter((f) => f.relation).length - a.fields.filter((f) => f.relation).length).slice(0, Math.min(3, modules.length))
    for (const m of connected) {
      selected.add(m.id)
      why.set(m.id, 'most connected module (request named no module)')
    }
  }

  // 2. dependencies
  const compact = new Map<string, string>()
  const addCompact = (id: string | undefined, reason: string) => {
    if (id && !selected.has(id) && !compact.has(id) && modules.some((m) => m.id === id)) compact.set(id, reason)
  }
  const nodes = formulaNodes(vis)
  for (const id of selected) {
    const m = modules.find((x) => x.id === id)!
    for (const f of m.fields) if (f.relation) addCompact(f.relation.moduleId, `target of ${m.name}.${f.label}`)
    for (const o of modules) if (o.id !== id && o.fields.some((f) => f.relation?.moduleId === id)) addCompact(o.id, `links to ${m.name}`)
  }
  for (const n of nodes) {
    if (selected.has(n.moduleId)) for (const d of n.deps) addCompact(d.moduleId, `read by a formula of ${n.moduleId}`)
    else if (n.deps.some((d) => selected.has(d.moduleId))) addCompact(n.moduleId, `has a formula that reads a selected module`)
  }
  // second hop for formulas of the compact modules is deliberately not followed: depth 1 keeps the slice small

  // what the actor may not see must not leak through a side door: a formula, workflow or pipeline rule that mentions
  // a hidden field or a module they cannot open is redacted / left out, even though its own field is visible
  const viewable = new Set(modules.map((m) => m.id))
  const isHidden = (moduleId: string, fieldId: string): boolean => {
    const m = cfg.modules.find((x) => x.id === moduleId)
    const f = m?.fields.find((x) => x.id === fieldId)
    return !m || !viewable.has(moduleId) || !f || fieldAccess(actor.role, f) === 'hidden'
  }
  const depsOf = new Map(formulaNodes(cfg).map((n) => [`${n.moduleId}.${n.fieldId}`, n.deps]))
  const hiddenModuleIds = cfg.modules.filter((m) => !viewable.has(m.id)).map((m) => m.id)
  const formulaLeaks = (moduleId: string, fieldId: string, expression: string): boolean => (depsOf.get(`${moduleId}.${fieldId}`) ?? []).some((d) => isHidden(d.moduleId, d.fieldId)) || hiddenModuleIds.some((id) => expression.includes(id))
  const workflowLeaks = (w: (typeof vis.workflows)[number]): boolean =>
    [w.trigger.fieldId, ...w.conditions.map((c) => c.fieldId), ...w.actions.map((a) => a.fieldId)].some((id) => id && isHidden(w.moduleId, id)) ||
    w.actions.some((a) => (a.moduleId && !viewable.has(a.moduleId)) || (a.moduleId && Object.keys(a.values ?? {}).some((k) => isHidden(a.moduleId!, k))))

  const detail = (m: Module, level: 'full' | 'compact', reason: string): ModuleContext => {
    const shown = m.fields.filter((f) => fieldAccess(actor.role, f) !== 'hidden')
    const fields = shown.map((f) => {
      const c = fieldCtx(f, actor, cfg)
      if (c.formula && 'expression' in c.formula && formulaLeaks(m.id, f.id, c.formula.expression)) c.formula = { redacted: true }
      if (c.pipeline?.requiredFields) c.pipeline = { ...c.pipeline, requiredFields: Object.fromEntries(Object.entries(c.pipeline.requiredFields).map(([k, ids]) => [k, ids.filter((id) => !isHidden(m.id, id))])) }
      return level === 'compact' ? { id: c.id, label: c.label, type: c.type, ...(c.relation ? { relation: c.relation } : {}), ...(c.formula ? { formula: c.formula } : {}), ...(c.options ? { options: c.options } : {}) } : c
    })
    return { id: m.id, name: m.name, kind: m.kind, detail: level, why: reason, fields, uniqueTogether: m.constraints?.uniqueTogether, titleFieldId: m.titleFieldId }
  }

  const ctxModules: ModuleContext[] = [
    ...modules.filter((m) => selected.has(m.id)).map((m) => detail(m, 'full', why.get(m.id) ?? '')),
    ...modules.filter((m) => compact.has(m.id)).map((m) => detail(m, 'compact', compact.get(m.id) ?? '')),
  ]
  const included = new Set(ctxModules.map((m) => m.id))

  const wants = (re: RegExp) => re.test(text)
  const wfWanted = wants(/workflow|automat|remind|notify|trigger|when .* (then|do)|follow.?up|task/) || intent === 'simulate_workflow'
  const wfs = vis.workflows.filter((w) => !workflowLeaks(w) && included.has(w.moduleId) && (wfWanted || selected.has(w.moduleId) || w.actions.some((a) => a.moduleId && selected.has(a.moduleId))))
  const dashWanted = wants(/dashboard|chart|report|analytic|metric|kpi|widget|graph|total/)
  const dashboards = vis.dashboards.filter((d) => dashWanted || d.widgets.some((w) => w.moduleId && selected.has(w.moduleId)))

  const dependents: RetrievedContext['dependents'] = []
  if (intent === 'delete_or_deactivate' || intent === 'modify' || intent === 'repair') {
    for (const id of selected) {
      const m = modules.find((x) => x.id === id)!
      for (const f of m.fields) for (const d of fieldDependents(vis, id, f.id)) if (d.kind !== 'pipeline' && d.kind !== 'constraint') dependents.push({ kind: d.kind, id: d.id, label: `${m.name}.${f.label} -> ${d.label}` })
    }
  }

  const ctx: RetrievedContext = {
    modules: ctxModules,
    outline: modules.filter((m) => !included.has(m.id)).map((m) => ({ id: m.id, name: m.name })),
    workflows: wfs.map((w) => ({ id: w.id, name: w.name, module: w.moduleId, enabled: w.enabled, trigger: w.trigger, conditions: w.conditions, actions: w.actions })),
    dashboards: dashboards.map((d) => ({ id: d.id, name: d.name, widgets: d.widgets.map((w) => ({ title: w.title, module: w.moduleId, field: w.fieldId, agg: w.agg })) })),
    forms: vis.forms.filter((f) => included.has(f.moduleId)).map((f) => ({ id: f.id, name: f.name, module: f.moduleId })),
    views: vis.views.filter((v) => included.has(v.moduleId)).map((v) => ({ id: v.id, name: v.name, module: v.moduleId })),
    roles: wants(/role|permission|access|allowed|see|hide|hidden|only|restrict|bursar|teacher|manager|admin|staff/) ? cfg.roles.map((r) => ({ id: r.id, name: r.name })) : undefined,
    dependents: dependents.slice(0, 40),
    ids: [],
  }
  ctx.ids = collectIds(ctx)
  return ctx
}

export function collectIds(c: RetrievedContext): string[] {
  const ids = new Set<string>()
  for (const m of c.modules) {
    ids.add(m.id)
    for (const f of m.fields) ids.add(`${m.id}.${f.id}`)
  }
  for (const m of c.outline) ids.add(m.id)
  for (const w of c.workflows) ids.add(w.id)
  for (const d of c.dashboards) ids.add(d.id)
  for (const f of c.forms) ids.add(f.id)
  for (const v of c.views) ids.add(v.id)
  return [...ids]
}

/** The whole visible configuration in full detail. Used for comparison and as the fallback when retrieval would be unsafe. */
export function fullContext(cfg: ConfigModel, actor: Actor): RetrievedContext {
  const names = visibleConfig(cfg, actor).modules.filter((m) => !m.system).map((m) => m.name).join(' ')
  return retrieveContext(cfg, actor, `${names} workflow dashboard role permission`, 'modify', { maxModules: 1000 })
}
