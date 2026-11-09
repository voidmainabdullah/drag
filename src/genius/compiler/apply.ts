import type { CrmRecord, Dashboard, Field, Form, Module, ModuleAccess, PermissionKey, Role, SelectOption, View, Widget, Workflow } from '#/types'
import { emptyViewConfig, makeSections, newForm, newView } from '#/services/defaults'
import { OPTION_COLORS } from '#/utils/fieldTypes'
import type { Blueprint, DashboardDef, FieldDef, FormDef, FormulaDef, LayoutDef, ModuleDef, PatchOp, PermissionRule, PipelineDef, RelationshipDef, RoleDef, ViewDef, WorkflowDef } from '../blueprint/schema'
import { clone, type ConfigModel } from '../config/model'
import { fieldDependents, moduleDependents } from '../config/dependencies'
import type { FormulaSpec, FormulaTestCase } from '../formula/ast'
import { walk } from '../formula/ast'
import { parseExpression, renderExpression } from '../formula/parser'
import { classifyWorkflow } from '../workflow/classify'
import { workflowHash } from '../workflow/core'
import { AI_ROLE_PREFIX } from '../config/model'
import { slugName, storeId } from './ids'

export class CompileError extends Error {
  constructor(
    public code: string,
    message: string,
    public path?: string,
  ) {
    super(message)
  }
}

export type ChangeKind = 'module' | 'field' | 'relationship' | 'form' | 'view' | 'pipeline' | 'workflow' | 'formula' | 'dashboard' | 'role' | 'permission'
export interface Change {
  kind: ChangeKind
  op: 'add' | 'update' | 'remove' | 'archive' | 'enable' | 'disable'
  id: string
  moduleId?: string
  label: string
  details?: string[]
  destructive?: boolean
}

export interface ApplyContext {
  workspaceId: string
  projectId: string
  actorUserId: string
  now: string
  /** live records of a module; used to warn when a stricter rule meets existing data */
  records?: (moduleId: string) => CrmRecord[]
  defaultCurrency?: string
}

export interface NavAdd {
  moduleId: string
  group?: string
  show: boolean
}

export interface ApplyResult {
  config: ConfigModel
  changes: Change[]
  warnings: string[]
  needsApproval: { workflowId: string; name: string; reasons: string[] }[]
  navAdds: NavAdd[]
  navRemoves: string[]
}

/** Record layouts exist only inside blueprints (they reorder/group fields); they are not a model-facing patch op. */
export type LayoutOp = { op: 'update_layout'; layout: LayoutDef }
export type AnyOp = PatchOp | LayoutOp

/** A blueprint is applied as an ordered list of patch operations: ONE code path for new builds and for modifications. */
export function blueprintToOps(bp: Blueprint): AnyOp[] {
  const ops: AnyOp[] = []
  for (const role of bp.roles) ops.push({ op: 'add_role', role })
  for (const module of bp.modules) ops.push({ op: 'add_module', module })
  for (const relationship of bp.relationships) ops.push({ op: 'add_relationship', relationship })
  for (const pipeline of bp.pipelines) ops.push({ op: 'add_pipeline', pipeline })
  for (const formula of bp.formulas) ops.push({ op: 'add_formula', formula })
  for (const form of bp.forms) ops.push({ op: 'add_form', form })
  for (const view of bp.views) ops.push({ op: 'add_view', view })
  for (const workflow of bp.workflows) ops.push({ op: 'add_workflow', workflow })
  for (const dashboard of bp.dashboards) ops.push({ op: 'add_dashboard', dashboard })
  for (const rule of bp.permissions) ops.push({ op: 'update_permissions', rule })
  // layouts are applied last because they reorder fields that other operations create
  for (const layout of bp.layouts) ops.push({ op: 'update_layout', layout })
  return ops
}

const opLabel = (op: AnyOp): string => op.op

const scalarOrUndef = (v: unknown) => (v === null ? undefined : v)

function defaultOf(d: FieldDef['defaultValue']): { set: boolean; value?: unknown } {
  if (!d) return { set: false }
  switch (d.kind) {
    case 'null':
      return { set: true, value: undefined }
    case 'blank':
      return { set: true, value: '' }
    case 'empty_collection':
      return { set: true, value: [] }
    case 'value':
      return { set: true, value: d.value }
  }
}

function toOptions(opts: { id: string; label: string; color?: string }[]): SelectOption[] {
  return opts.map((o, i) => ({ id: o.id, label: o.label, color: o.color ?? OPTION_COLORS[i % OPTION_COLORS.length] }))
}

class Applier {
  cfg: ConfigModel
  changes: Change[] = []
  warnings: string[] = []
  needsApproval: ApplyResult['needsApproval'] = []
  navAdds: NavAdd[] = []
  navRemoves: string[] = []
  private newModules = new Set<string>()
  private explicitFormsFor = new Set<string>()
  private explicitViewsFor = new Set<string>()

  constructor(
    cfg: ConfigModel,
    private ctx: ApplyContext,
  ) {
    this.cfg = clone(cfg)
  }

  // ---- reference resolution ------------------------------------------------------------------
  private id(kind: 'module' | 'form' | 'view' | 'workflow' | 'dashboard' | 'role', bpId: string) {
    return storeId(kind, this.ctx.workspaceId, bpId)
  }
  mod(ref: string): Module {
    const m = this.cfg.modules.find((x) => x.id === ref) ?? this.cfg.modules.find((x) => x.id === this.id('module', ref))
    if (!m) throw new CompileError('REF_UNKNOWN_MODULE', `Module "${ref}" does not exist`)
    return m
  }
  private roleId(ref: string): string {
    if (this.cfg.roles.some((r) => r.id === ref)) return ref
    const ai = this.id('role', ref)
    if (this.cfg.roles.some((r) => r.id === ai)) return ai
    throw new CompileError('REF_UNKNOWN_ROLE', `Role "${ref}" does not exist`)
  }
  private field(m: Module, id: string): Field {
    const f = m.fields.find((x) => x.id === id)
    if (!f) throw new CompileError('REF_UNKNOWN_FIELD', `Field "${id}" does not exist in module "${m.name}"`)
    return f
  }
  private replaceModule(m: Module) {
    this.cfg.modules = this.cfg.modules.map((x) => (x.id === m.id ? m : x))
  }
  private touch(m: Module, patch: Partial<Module>): Module {
    const next = { ...m, ...patch, updatedAt: this.ctx.now }
    this.replaceModule(next)
    return next
  }
  private uniqueName(m: Module | undefined, label: string, ownId?: string): string {
    const base = slugName(label)
    const taken = new Set((m?.fields ?? []).filter((f) => f.id !== ownId).map((f) => f.name))
    if (!taken.has(base)) return base
    let i = 2
    while (taken.has(`${base}_${i}`)) i++
    return `${base}_${i}`
  }
  private fieldMapper = (m: Module | undefined) => (d: FieldDef, order: number): Field => {
    const f: Field = { id: d.id, name: this.uniqueName(m, d.label), label: d.label, type: d.type, width: d.width ?? 'full', order }
    this.copyFieldProps(f, d)
    if (d.type === 'percentage') {
      f.min = d.min ?? 0
      f.max = d.max ?? 100
    }
    if (d.type === 'rating' && f.max === undefined) f.max = 5
    if (d.type === 'currency') f.currency = d.currency ?? this.ctx.defaultCurrency ?? 'USD'
    if (d.type === 'autoId') {
      f.idPrefix = d.idPrefix ?? 'ID'
      f.readOnly = true
    }
    return f
  }
  private copyFieldProps(f: Field, d: Partial<FieldDef>) {
    if (d.label !== undefined) f.label = d.label
    if (d.description !== undefined) f.description = d.description
    if (d.required !== undefined) f.required = d.required
    if (d.readOnly !== undefined) f.readOnly = d.readOnly
    if (d.unique !== undefined) f.unique = d.unique
    if (d.options !== undefined) f.options = toOptions(d.options)
    if (d.min !== undefined) f.min = d.min
    if (d.max !== undefined) f.max = d.max
    if (d.minLength !== undefined) f.minLength = d.minLength
    if (d.maxLength !== undefined) f.maxLength = d.maxLength
    if (d.precision !== undefined) f.precision = d.precision
    if (d.currency !== undefined) f.currency = d.currency
    if (d.dateMin !== undefined) f.dateMin = d.dateMin
    if (d.dateMax !== undefined) f.dateMax = d.dateMax
    if (d.requiredWhen !== undefined) f.requiredWhen = { fieldId: d.requiredWhen.fieldId, op: d.requiredWhen.op, value: scalarOrUndef(d.requiredWhen.value) }
    if (d.idPrefix !== undefined) f.idPrefix = d.idPrefix
    if (d.group !== undefined) f.group = d.group
    if (d.width !== undefined) f.width = d.width
    const def = defaultOf(d.defaultValue)
    if (def.set) f.defaultValue = def.value
  }
  private reorder(m: Module): Module {
    return { ...m, fields: m.fields.map((f, i) => ({ ...f, order: i })) }
  }

  // ---- modules ---------------------------------------------------------------------------------
  private titleFormula(def: { id: string; titleTemplate?: string }, fields: Field[]): Field | undefined {
    if (!def.titleTemplate) return undefined
    const parts: string[] = []
    for (const piece of def.titleTemplate.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/g)) {
      if (!piece) continue
      const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(piece)
      if (m) {
        if (!fields.some((f) => f.id === m[1])) throw new CompileError('REF_UNKNOWN_FIELD', `titleTemplate uses unknown field "${m[1]}"`)
        parts.push(`{${m[1]}}`)
      } else parts.push(JSON.stringify(piece))
    }
    const expression = `CONCAT(${parts.join(', ')})`
    const spec = this.makeSpec({ id: 'display_title', expression, resultType: 'text', precision: 0, rounding: 'half_up', nullBehavior: 'null', divByZero: 'null', tests: [] })
    return { id: 'display_title', name: 'display_title', label: 'Title', type: 'formula', formula: spec.expression, formulaSpec: spec, readOnly: true, width: 'full', order: 0 }
  }
  private makeSpec(d: { id: string; expression: string; resultType: FormulaSpec['resultType']; currency?: string; precision: number; rounding: FormulaSpec['rounding']; nullBehavior: FormulaSpec['nullBehavior']; divByZero: FormulaSpec['divByZero']; description?: string; tests?: FormulaDef['tests'] }): FormulaSpec {
    let ast
    try {
      ast = parseExpression(d.expression)
    } catch (e) {
      throw new CompileError('FORMULA_SYNTAX', e instanceof Error ? e.message : 'Invalid formula', d.id)
    }
    // aggregates name the module they sum over: the blueprint uses its own ids, the store uses the real ones
    const resolveModule = (ref: string): string => {
      const m = this.cfg.modules.find((x) => x.id === ref) ?? this.cfg.modules.find((x) => x.id === this.id('module', ref))
      if (!m) throw new CompileError('REF_UNKNOWN_MODULE', `Formula "${d.id}" aggregates over unknown module "${ref}"`, d.id)
      return m.id
    }
    walk(ast, (n) => {
      if (n.t === 'agg' && n.module) n.module = resolveModule(n.module)
    })
    const tests: FormulaTestCase[] = (d.tests ?? []).map((t) => ({
      name: t.name,
      record: Object.fromEntries(t.record.map((r) => [r.fieldId, r.value])),
      related: t.related.reduce<Record<string, Record<string, unknown>[]>>((acc, row, i) => {
        const data: Record<string, unknown> = Object.fromEntries(row.values.map((r) => [r.fieldId, r.value]))
        for (const via of row.linksToSelfVia) data[via] = '$self'
        data.id = `${row.moduleId}_${i}`
        ;(acc[resolveModule(row.moduleId)] ??= []).push(data)
        return acc
      }, {}),
      today: t.today,
      expected: t.expected,
    }))
    return {
      id: d.id,
      expression: renderExpression(ast),
      ast,
      resultType: d.resultType,
      currency: d.currency,
      precision: d.precision,
      rounding: d.rounding,
      nullBehavior: d.nullBehavior,
      divByZero: d.divByZero,
      description: d.description,
      tests,
    }
  }

  addModule(def: ModuleDef) {
    const id = this.id('module', def.id)
    const existing = this.cfg.modules.find((m) => m.id === id)
    if (existing && existing.aiProject !== this.ctx.projectId) throw new CompileError('MODULE_EXISTS', `Module "${def.id}" already exists and was not created by this project`)
    const map = this.fieldMapper(existing)
    if (existing) {
      // idempotent re-run: update what the blueprint says, keep everything else (manual additions included)
      let m = existing
      const details: string[] = []
      for (const fd of def.fields) {
        const cur = m.fields.find((f) => f.id === fd.id)
        if (cur) {
          if (cur.type !== fd.type) throw new CompileError('FIELD_TYPE_CHANGE', `Field "${fd.id}" is ${cur.type}; changing its type is not supported automatically (it would reinterpret existing records)`)
          const next = { ...cur }
          this.copyFieldProps(next, { ...fd, label: cur.label })
          m = { ...m, fields: m.fields.map((f) => (f.id === fd.id ? next : f)) }
        } else {
          m = { ...m, fields: [...m.fields, map(fd, m.fields.length)] }
          details.push(`field ${fd.label}`)
        }
      }
      m = this.applyModuleProps(m, def)
      this.replaceModule({ ...this.reorder(m), updatedAt: this.ctx.now })
      this.changes.push({ kind: 'module', op: 'update', id, label: def.plural, details: details.length ? details : ['already up to date'] })
      return
    }
    const fields = def.fields.map((fd, i) => map(fd, i))
    // API names must be unique inside the module
    const names = new Set<string>()
    for (const f of fields) {
      let n = f.name
      for (let i = 2; names.has(n); i++) n = `${f.name}_${i}`
      names.add(n)
      f.name = n
    }
    const title = this.titleFormula(def, fields)
    if (title) fields.unshift(title)
    const siblings = this.cfg.modules.filter((m) => m.workspaceId === this.ctx.workspaceId)
    const parentId = def.parentModuleId ? this.mod(def.parentModuleId).id : undefined
    let m: Module = {
      id,
      workspaceId: this.ctx.workspaceId,
      name: def.plural,
      singularName: def.singular,
      description: def.description,
      icon: def.icon ?? 'Box',
      color: def.color ?? '#7B68EE',
      category: def.navigation?.group,
      parentId,
      fields: fields.map((f, i) => ({ ...f, order: i })),
      visible: true,
      showInNav: def.navigation?.show === false ? false : undefined,
      archived: false,
      order: siblings.length ? Math.max(...siblings.map((x) => x.order)) + 1 : 0,
      kind: def.kind,
      aiProject: this.ctx.projectId,
      createdAt: this.ctx.now,
      updatedAt: this.ctx.now,
    }
    m = this.applyModuleProps(m, def, true)
    this.cfg.modules = [...this.cfg.modules, m]
    this.newModules.add(id)
    this.navAdds.push({ moduleId: id, group: def.navigation?.group, show: def.navigation?.show !== false })
    this.changes.push({ kind: 'module', op: 'add', id, label: def.plural, details: [`${def.fields.length} fields`, `kind: ${def.kind}`] })
  }

  private applyModuleProps(m: Module, p: Partial<ModuleDef>, isNew = false): Module {
    const next: Module = { ...m }
    if (!isNew && p.plural) next.name = p.plural
    if (!isNew && p.singular) next.singularName = p.singular
    if (p.description !== undefined) next.description = p.description
    if (p.icon) next.icon = p.icon
    if (p.color) next.color = p.color
    if (p.uniqueTogether) next.constraints = { ...(next.constraints ?? {}), uniqueTogether: p.uniqueTogether }
    if (p.searchFieldIds) {
      for (const id of p.searchFieldIds) if (!next.fields.some((f) => f.id === id)) throw new CompileError('REF_UNKNOWN_FIELD', `searchFieldIds uses unknown field "${id}"`)
      next.searchFieldIds = p.searchFieldIds
    }
    if (p.titleTemplate !== undefined && !isNew) {
      const t = this.titleFormula({ id: m.id, titleTemplate: p.titleTemplate }, next.fields.filter((f) => f.id !== 'display_title'))
      if (t) next.fields = next.fields.some((f) => f.id === 'display_title') ? next.fields.map((f) => (f.id === 'display_title' ? { ...f, formula: t.formula, formulaSpec: t.formulaSpec } : f)) : [t, ...next.fields]
      next.titleFieldId = 'display_title'
    } else if (isNew && next.fields.some((f) => f.id === 'display_title')) next.titleFieldId = 'display_title'
    if (p.displayFieldId) {
      if (!next.fields.some((f) => f.id === p.displayFieldId)) throw new CompileError('REF_UNKNOWN_FIELD', `displayFieldId "${p.displayFieldId}" does not exist`)
      next.titleFieldId = p.displayFieldId
    }
    if (p.capabilities) {
      const perms = { ...(next.permissions ?? {}) }
      for (const r of this.cfg.roles) {
        const cur = perms[r.id]
        const base = (k: PermissionKey) => r.permissions[k]
        const v: ModuleAccess = {
          view: cur?.view ?? base('viewModules'),
          create: p.capabilities.create ? (cur?.create ?? base('createRecords')) : false,
          edit: p.capabilities.edit ? (cur?.edit ?? base('editRecords')) : false,
          delete: p.capabilities.delete ? (cur?.delete ?? base('deleteRecords')) : false,
        }
        perms[r.id] = v
      }
      next.permissions = perms
    }
    return next
  }

  updateModule(id: string, changes: Partial<ModuleDef>) {
    const m = this.mod(id)
    const next = this.applyModuleProps(m, changes)
    this.replaceModule({ ...this.reorder(next), updatedAt: this.ctx.now })
    this.changes.push({ kind: 'module', op: 'update', id: m.id, label: changes.plural ?? m.name, details: Object.keys(changes) })
  }

  removeModule(id: string, mode: 'archive' | 'delete') {
    const m = this.mod(id)
    if (m.system) throw new CompileError('MODULE_PROTECTED', `"${m.name}" is a system module`)
    const recs = this.ctx.records?.(m.id).length ?? 0
    if (mode === 'archive' || recs > 0) {
      if (mode === 'delete' && recs > 0) throw new CompileError('REMOVE_HAS_RECORDS', `"${m.name}" has ${recs} record(s); it can be archived but not deleted`)
      this.touch(m, { archived: true })
      this.changes.push({ kind: 'module', op: 'archive', id: m.id, label: m.name, details: [`${recs} record(s) kept`] })
      return
    }
    const deps = moduleDependents(this.cfg, m.id)
    if (deps.length) throw new CompileError('REMOVE_BREAKS_DEPENDENCY', `Cannot delete "${m.name}": ${deps.map((d) => d.label).join('; ')}`)
    this.cfg.modules = this.cfg.modules.filter((x) => x.id !== m.id)
    this.cfg.forms = this.cfg.forms.filter((f) => f.moduleId !== m.id)
    this.cfg.views = this.cfg.views.filter((v) => v.moduleId !== m.id)
    this.cfg.workflows = this.cfg.workflows.filter((w) => w.moduleId !== m.id)
    this.navRemoves.push(m.id)
    this.changes.push({ kind: 'module', op: 'remove', id: m.id, label: m.name, destructive: true })
  }

  // ---- fields ----------------------------------------------------------------------------------
  addField(moduleRef: string, def: FieldDef) {
    const m = this.mod(moduleRef)
    if (m.fields.some((f) => f.id === def.id)) throw new CompileError('FIELD_EXISTS', `Field "${def.id}" already exists in "${m.name}"`)
    const f = this.fieldMapper(m)(def, m.fields.length)
    this.replaceModule({ ...m, fields: [...m.fields, f], updatedAt: this.ctx.now })
    // make the new field usable: put it in the first section of the module's forms
    this.cfg.forms = this.cfg.forms.map((fm) =>
      fm.moduleId === m.id && !['formula', 'autoId'].includes(f.type) && fm.sections.length
        ? { ...fm, sections: fm.sections.map((s, i) => (i === 0 ? { ...s, items: [...s.items, { fieldId: f.id }] } : s)), updatedAt: this.ctx.now }
        : fm,
    )
    this.changes.push({ kind: 'field', op: 'add', id: def.id, moduleId: m.id, label: `${m.name} → ${def.label}`, details: [def.type] })
  }

  updateField(moduleRef: string, id: string, changes: Partial<FieldDef>) {
    const m = this.mod(moduleRef)
    const cur = this.field(m, id)
    const next: Field = { ...cur }
    const details: string[] = []
    this.copyFieldProps(next, changes)
    if (changes.label && changes.label !== cur.label) next.name = this.uniqueName(m, changes.label, cur.id)
    const records = this.ctx.records?.(m.id) ?? []
    if (changes.required && !cur.required) {
      const n = records.filter((r) => r.data[id] === undefined || r.data[id] === null || r.data[id] === '').length
      if (n) this.warnings.push(`${m.name}.${cur.label}: ${n} existing record(s) have no value; they stay as they are and are flagged when next edited`)
    }
    if (changes.unique && !cur.unique) {
      const seen = new Set<string>()
      let dup = 0
      for (const r of records) {
        const v = String(r.data[id] ?? '').toLowerCase()
        if (!v) continue
        if (seen.has(v)) dup++
        seen.add(v)
      }
      if (dup) throw new CompileError('MIGRATION_UNIQUE_CONFLICT', `Cannot make "${cur.label}" unique: ${dup} existing record(s) share a value. Resolve the duplicates first.`)
    }
    if (changes.options && cur.options) {
      const gone = cur.options.filter((o) => !changes.options!.some((n) => n.id === o.id))
      const used = gone.filter((o) => records.some((r) => r.data[id] === o.id || (Array.isArray(r.data[id]) && (r.data[id] as unknown[]).includes(o.id))))
      if (used.length) this.warnings.push(`${m.name}.${cur.label}: option(s) ${used.map((o) => o.label).join(', ')} are still used by existing records; the values are kept but will show as raw ids`)
    }
    if (changes.maxLength !== undefined && cur.maxLength !== undefined && changes.maxLength < cur.maxLength) {
      const n = records.filter((r) => typeof r.data[id] === 'string' && (r.data[id] as string).length > changes.maxLength!).length
      if (n) this.warnings.push(`${m.name}.${cur.label}: ${n} existing value(s) are longer than the new limit; they are kept unchanged`)
    }
    details.push(...Object.keys(changes))
    this.replaceModule({ ...m, fields: m.fields.map((f) => (f.id === id ? next : f)), updatedAt: this.ctx.now })
    this.changes.push({ kind: 'field', op: 'update', id, moduleId: m.id, label: `${m.name} → ${next.label}`, details })
  }

  removeField(moduleRef: string, id: string) {
    const m = this.mod(moduleRef)
    const f = this.field(m, id)
    const deps = fieldDependents(this.cfg, m.id, id)
    if (deps.length) throw new CompileError('REMOVE_BREAKS_DEPENDENCY', `Cannot remove "${f.label}": ${deps.map((d) => d.label).join('; ')}`)
    const stored = (this.ctx.records?.(m.id) ?? []).filter((r) => r.data[id] !== undefined && r.data[id] !== '' && r.data[id] !== null).length
    this.replaceModule({
      ...m,
      fields: m.fields.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i })),
      titleFieldId: m.titleFieldId === id ? undefined : m.titleFieldId,
      searchFieldIds: m.searchFieldIds?.filter((x) => x !== id),
      updatedAt: this.ctx.now,
    })
    // same clean-up as the manual "remove field" path: forms and views stop referencing it
    this.cfg.forms = this.cfg.forms.map((fm) => (fm.moduleId === m.id ? { ...fm, sections: fm.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.fieldId !== id) })) } : fm))
    this.cfg.views = this.cfg.views.map((v) => {
      if (v.moduleId !== m.id) return v
      const c = v.config
      return { ...v, config: { ...c, filters: c.filters.filter((x) => x.fieldId !== id), sorts: c.sorts.filter((x) => x.fieldId !== id), groupBy: c.groupBy === id ? undefined : c.groupBy, dateFieldId: c.dateFieldId === id ? undefined : c.dateFieldId, endDateFieldId: c.endDateFieldId === id ? undefined : c.endDateFieldId, hiddenFieldIds: c.hiddenFieldIds.filter((x) => x !== id), fieldOrder: c.fieldOrder.filter((x) => x !== id) } }
    })
    this.changes.push({ kind: 'field', op: 'remove', id, moduleId: m.id, label: `${m.name} → ${f.label}`, details: [stored ? `${stored} record value(s) stay stored in the records` : 'no stored values'], destructive: true })
  }

  // ---- relationships ---------------------------------------------------------------------------
  addRelationship(def: RelationshipDef) {
    const src = this.mod(def.sourceModuleId)
    const target = this.mod(def.targetModuleId)
    const cur = src.fields.find((f) => f.id === def.id)
    const relation = { moduleId: target.id, cardinality: def.cardinality, lookupFieldId: def.lookupFieldId, deletePolicy: def.deletePolicy, required: def.required }
    if (cur) {
      if (cur.type !== 'relationship' || (src.aiProject !== this.ctx.projectId && !this.newModules.has(src.id))) throw new CompileError('FIELD_EXISTS', `Field "${def.id}" already exists in "${src.name}"`)
      this.replaceModule({ ...src, fields: src.fields.map((f) => (f.id === def.id ? { ...f, label: def.label, required: def.required, relation } : f)), updatedAt: this.ctx.now })
      this.changes.push({ kind: 'relationship', op: 'update', id: def.id, moduleId: src.id, label: `${src.name} → ${target.name}` })
      return
    }
    const f: Field = { id: def.id, name: this.uniqueName(src, def.label), label: def.label, type: 'relationship', required: def.required, width: 'full', order: src.fields.length, relation }
    this.replaceModule({ ...src, fields: [...src.fields, f], updatedAt: this.ctx.now })
    if (def.reverseLabel) this.warnings.push(`Reverse label "${def.reverseLabel}" is informational: the related-records panel on ${target.name} is derived automatically`)
    this.changes.push({ kind: 'relationship', op: 'add', id: def.id, moduleId: src.id, label: `${src.name} → ${target.name} (${def.cardinality})`, details: [`on delete: ${def.deletePolicy}`] })
  }

  updateRelationship(moduleRef: string | undefined, id: string, changes: Partial<RelationshipDef>) {
    const src = this.findRelModule(moduleRef, id)
    const cur = this.field(src, id)
    const relation = { ...cur.relation!, ...(changes.deletePolicy ? { deletePolicy: changes.deletePolicy } : {}), ...(changes.required !== undefined ? { required: changes.required } : {}), ...(changes.lookupFieldId ? { lookupFieldId: changes.lookupFieldId } : {}) }
    this.replaceModule({ ...src, fields: src.fields.map((f) => (f.id === id ? { ...f, label: changes.label ?? f.label, required: changes.required ?? f.required, relation } : f)), updatedAt: this.ctx.now })
    this.changes.push({ kind: 'relationship', op: 'update', id, moduleId: src.id, label: `${src.name} → ${cur.label}`, details: Object.keys(changes) })
  }

  removeRelationship(moduleRef: string | undefined, id: string) {
    const src = this.findRelModule(moduleRef, id)
    this.removeField(src.id, id)
    const last = this.changes[this.changes.length - 1]
    last.kind = 'relationship'
  }

  /** The module owning field `id`. Without an explicit module the id must be unambiguous: never guess between modules. */
  private fieldOwner(moduleRef: string | undefined, id: string, pred: (f: Field) => boolean, what: string): Module {
    if (moduleRef) return this.mod(moduleRef)
    const hits = this.cfg.modules.filter((m) => m.fields.some((f) => f.id === id && pred(f)))
    if (hits.length !== 1) throw new CompileError(hits.length ? 'REF_AMBIGUOUS' : 'REF_UNKNOWN_FIELD', `${what} "${id}" ${hits.length ? 'exists in several modules; give moduleId' : 'does not exist'}`)
    return hits[0]
  }

  private findRelModule(moduleRef: string | undefined, id: string): Module {
    if (moduleRef) return this.mod(moduleRef)
    const hits = this.cfg.modules.filter((m) => m.fields.some((f) => f.id === id && f.type === 'relationship'))
    if (hits.length !== 1) throw new CompileError('REF_AMBIGUOUS', `Relationship "${id}" ${hits.length ? 'exists in several modules; give moduleId' : 'does not exist'}`)
    return hits[0]
  }

  // ---- formulas --------------------------------------------------------------------------------
  addFormula(def: FormulaDef) {
    const m = this.mod(def.moduleId)
    const cur = m.fields.find((f) => f.id === def.id)
    if (cur && cur.type !== 'formula') throw new CompileError('FORMULA_TARGET_CONFLICT', `"${def.id}" is an existing ${cur.type} field, not a formula field`)
    const spec = this.makeSpec(def)
    const rendered = renderExpression(spec.ast!)
    const field: Field = {
      ...(cur ?? { id: def.id, name: this.uniqueName(m, def.label), type: 'formula' as const, width: 'full' as const, order: m.fields.length }),
      label: def.label,
      formula: rendered,
      formulaSpec: spec,
      readOnly: true,
      currency: def.resultType === 'money' ? def.currency : undefined,
      precision: def.precision,
    }
    this.replaceModule({ ...m, fields: cur ? m.fields.map((f) => (f.id === def.id ? field : f)) : [...m.fields, field], updatedAt: this.ctx.now })
    this.changes.push({ kind: 'formula', op: cur ? 'update' : 'add', id: def.id, moduleId: m.id, label: `${m.name} → ${def.label}`, details: [rendered] })
  }

  updateFormula(moduleRef: string | undefined, id: string, changes: Partial<FormulaDef>) {
    const m = this.fieldOwner(moduleRef, id, (f) => f.type === 'formula', 'Formula')
    const f = this.field(m, id)
    const old = f.formulaSpec
    if (!old) throw new CompileError('FORMULA_TARGET_CONFLICT', `"${id}" has no deterministic formula to update`)
    this.addFormula({
      id,
      moduleId: m.id,
      label: changes.label ?? f.label,
      expression: changes.expression ?? old.expression,
      resultType: changes.resultType ?? old.resultType,
      currency: changes.currency ?? old.currency,
      precision: changes.precision ?? old.precision,
      rounding: changes.rounding ?? old.rounding,
      nullBehavior: changes.nullBehavior ?? old.nullBehavior,
      divByZero: changes.divByZero ?? old.divByZero,
      sources: changes.sources ?? [],
      description: changes.description ?? old.description,
      tests: changes.tests ?? [],
    })
    // keep the previous deterministic tests when the patch does not supply new ones
    if (!changes.tests && old.tests?.length) {
      const mm = this.mod(m.id)
      this.replaceModule({ ...mm, fields: mm.fields.map((x) => (x.id === id && x.formulaSpec ? { ...x, formulaSpec: { ...x.formulaSpec, tests: old.tests } } : x)) })
    }
  }

  removeFormula(moduleRef: string | undefined, id: string) {
    const m = this.fieldOwner(moduleRef, id, (f) => f.type === 'formula', 'Formula')
    this.removeField(m.id, id)
    this.changes[this.changes.length - 1].kind = 'formula'
  }

  // ---- pipelines -------------------------------------------------------------------------------
  addPipeline(def: PipelineDef) {
    const m = this.mod(def.moduleId)
    let f = m.fields.find((x) => x.id === def.id)
    if (f && f.type !== 'dropdown' && f.type !== 'radio') throw new CompileError('PIPELINE_STAGE_FIELD_TYPE', `"${def.id}" must be a dropdown field to hold pipeline stages`)
    const options = toOptions(def.stages.map((s) => ({ id: s.id, label: s.label, color: s.color })))
    const transitions: Record<string, string[]> = {}
    for (const t of def.transitions ?? []) (transitions[t.from] ??= []).push(t.to)
    const requiredFields = Object.fromEntries(def.stages.filter((s) => s.requiredFieldIds?.length).map((s) => [s.id, s.requiredFieldIds!]))
    const pipeline = { transitions: def.transitions?.length ? transitions : undefined, requiredFields: Object.keys(requiredFields).length ? requiredFields : undefined, trackTimeInStage: def.trackTimeInStage }
    if (f) {
      const records = this.ctx.records?.(m.id) ?? []
      const orphan = records.filter((r) => typeof r.data[f!.id] === 'string' && r.data[f!.id] !== '' && !options.some((o) => o.id === r.data[f!.id])).length
      if (orphan) this.warnings.push(`${m.name}: ${orphan} record(s) have a stage that is not in the new pipeline; their value is kept`)
      f = { ...f, options, pipeline, defaultValue: options[0].id }
      this.replaceModule({ ...m, fields: m.fields.map((x) => (x.id === f!.id ? f! : x)), updatedAt: this.ctx.now })
    } else {
      f = { id: def.id, name: this.uniqueName(m, def.stageFieldLabel ?? 'Stage'), label: def.stageFieldLabel ?? 'Stage', type: 'dropdown', options, pipeline, defaultValue: options[0].id, required: true, width: 'half', order: m.fields.length }
      this.replaceModule({ ...m, fields: [...m.fields, f], updatedAt: this.ctx.now })
    }
    const boardId = `view_${m.id}_${def.id}_board`
    if (!this.cfg.views.some((v) => v.id === boardId) && !this.cfg.views.some((v) => v.moduleId === m.id && v.type === 'kanban' && v.config.groupBy === def.id)) {
      const t = this.ctx.now
      this.cfg.views.push({ id: boardId, workspaceId: this.ctx.workspaceId, moduleId: m.id, name: `${f.label} board`, type: 'kanban', config: { ...emptyViewConfig(), groupBy: def.id }, order: this.cfg.views.filter((v) => v.moduleId === m.id).length, createdAt: t, updatedAt: t })
    }
    this.changes.push({ kind: 'pipeline', op: 'add', id: def.id, moduleId: m.id, label: `${m.name} pipeline: ${def.stages.map((s) => s.label).join(' → ')}` })
  }

  updatePipeline(moduleRef: string | undefined, id: string, changes: Partial<PipelineDef>) {
    const m = this.fieldOwner(moduleRef, id, (f) => !!f.pipeline, 'Pipeline')
    const f = this.field(m, id)
    const stages = changes.stages ?? (f.options ?? []).map((o) => ({ id: o.id, label: o.label, color: o.color, requiredFieldIds: f.pipeline?.requiredFields?.[o.id] }))
    const transitions =
      changes.transitions ?? Object.entries(f.pipeline?.transitions ?? {}).flatMap(([from, tos]) => tos.map((to) => ({ from, to })))
    this.addPipeline({ id, moduleId: m.id, stages, transitions, trackTimeInStage: changes.trackTimeInStage ?? f.pipeline?.trackTimeInStage, stageFieldLabel: changes.stageFieldLabel })
    this.changes[this.changes.length - 1].op = 'update'
  }

  removePipeline(moduleRef: string | undefined, id: string) {
    const m = this.fieldOwner(moduleRef, id, (f) => !!f.pipeline, 'Pipeline')
    this.replaceModule({ ...m, fields: m.fields.map((f) => (f.id === id ? { ...f, pipeline: undefined } : f)), updatedAt: this.ctx.now })
    this.changes.push({ kind: 'pipeline', op: 'remove', id, moduleId: m.id, label: `${m.name} pipeline rules removed (the stage field and its data stay)` })
  }

  // ---- forms / views / layouts -----------------------------------------------------------------
  private checkFields(m: Module, ids: string[], what: string) {
    for (const id of ids) if (!m.fields.some((f) => f.id === id)) throw new CompileError('REF_UNKNOWN_FIELD', `${what} uses unknown field "${id}" of "${m.name}"`)
  }
  private buildForm(def: Partial<FormDef> & { id: string }, m: Module, base?: Form): Form {
    const sections = def.sections
      ? def.sections.map((s) => {
          this.checkFields(m, s.fieldIds, `Form "${def.name ?? base?.name}"`)
          return { id: `sec_${s.id}`, title: s.title, columns: s.columns, items: s.fieldIds.map((fieldId) => ({ fieldId })) }
        })
      : (base?.sections ?? [])
    const t = this.ctx.now
    return {
      id: base?.id ?? this.id('form', def.id),
      workspaceId: this.ctx.workspaceId,
      moduleId: m.id,
      name: def.name ?? base?.name ?? `${m.name} form`,
      description: def.description ?? base?.description,
      sections,
      submitLabel: def.submitLabel ?? base?.submitLabel ?? 'Submit',
      // AI never publishes a form to the public web: that stays an explicit, manual decision
      public: { ...(base?.public ?? { enabled: false, title: def.name ?? `${m.name} form`, description: '', submitLabel: 'Submit', thankYouTitle: 'Thank you!', thankYouMessage: 'Your response has been recorded.', accent: '#7B68EE', background: '#F7F7FB', radius: 12, showBranding: true }), enabled: false },
      createdAt: base?.createdAt ?? t,
      updatedAt: t,
    }
  }
  addForm(def: FormDef) {
    const m = this.mod(def.moduleId)
    const id = this.id('form', def.id)
    const base = this.cfg.forms.find((f) => f.id === id)
    const form = this.buildForm(def, m, base)
    this.cfg.forms = base ? this.cfg.forms.map((f) => (f.id === id ? form : f)) : [...this.cfg.forms, form]
    this.explicitFormsFor.add(m.id)
    this.changes.push({ kind: 'form', op: base ? 'update' : 'add', id, moduleId: m.id, label: `${m.name}: ${def.name}` })
  }
  private formRef(ref: string) {
    const f = this.cfg.forms.find((x) => x.id === ref) ?? this.cfg.forms.find((x) => x.id === this.id('form', ref))
    if (!f) throw new CompileError('REF_UNKNOWN_FORM', `Form "${ref}" does not exist`)
    return f
  }
  updateForm(ref: string, changes: Partial<FormDef>) {
    const f = this.formRef(ref)
    const m = this.mod(f.moduleId)
    const next = this.buildForm({ ...changes, id: f.id }, m, f)
    next.id = f.id
    this.cfg.forms = this.cfg.forms.map((x) => (x.id === f.id ? next : x))
    this.changes.push({ kind: 'form', op: 'update', id: f.id, moduleId: m.id, label: `${m.name}: ${next.name}`, details: Object.keys(changes) })
  }
  removeForm(ref: string) {
    const f = this.formRef(ref)
    this.cfg.forms = this.cfg.forms.filter((x) => x.id !== f.id)
    this.changes.push({ kind: 'form', op: 'remove', id: f.id, moduleId: f.moduleId, label: f.name })
  }

  private buildView(def: Partial<ViewDef> & { id: string }, m: Module, base?: View): View {
    const ids = [...(def.filters ?? []).map((f) => f.fieldId), ...(def.sorts ?? []).map((s) => s.fieldId), ...(def.groupByFieldId ? [def.groupByFieldId] : []), ...(def.dateFieldId ? [def.dateFieldId] : []), ...(def.endDateFieldId ? [def.endDateFieldId] : []), ...(def.hiddenFieldIds ?? [])]
    this.checkFields(m, ids, `View "${def.name ?? base?.name}"`)
    const cfgBase = base?.config ?? emptyViewConfig()
    const config = {
      ...cfgBase,
      filters: def.filters ? def.filters.map((f, i) => ({ id: `flt_${i}`, fieldId: f.fieldId, op: f.op, value: scalarOrUndef(f.value) })) : cfgBase.filters,
      sorts: def.sorts ? def.sorts.map((s, i) => ({ id: `srt_${i}`, fieldId: s.fieldId, dir: s.dir })) : cfgBase.sorts,
      groupBy: def.groupByFieldId ?? cfgBase.groupBy,
      dateFieldId: def.dateFieldId ?? cfgBase.dateFieldId,
      endDateFieldId: def.endDateFieldId ?? cfgBase.endDateFieldId,
      hiddenFieldIds: def.hiddenFieldIds ?? cfgBase.hiddenFieldIds,
    }
    const t = this.ctx.now
    const view: View = { id: base?.id ?? this.id('view', def.id), workspaceId: this.ctx.workspaceId, moduleId: m.id, name: def.name ?? base?.name ?? 'View', type: def.type ?? base?.type ?? 'table', config, order: base?.order ?? this.cfg.views.filter((v) => v.moduleId === m.id).length, createdAt: base?.createdAt ?? t, updatedAt: t }
    if (view.type === 'kanban' && !view.config.groupBy) view.config.groupBy = m.fields.find((f) => f.type === 'dropdown' || f.type === 'radio')?.id
    if ((view.type === 'calendar' || view.type === 'timeline') && !view.config.dateFieldId) view.config.dateFieldId = m.fields.find((f) => f.type === 'date' || f.type === 'datetime')?.id
    return view
  }
  addView(def: ViewDef) {
    const m = this.mod(def.moduleId)
    const id = this.id('view', def.id)
    const base = this.cfg.views.find((v) => v.id === id)
    const v = this.buildView(def, m, base)
    this.cfg.views = base ? this.cfg.views.map((x) => (x.id === id ? v : x)) : [...this.cfg.views, v]
    this.explicitViewsFor.add(m.id)
    this.changes.push({ kind: 'view', op: base ? 'update' : 'add', id, moduleId: m.id, label: `${m.name}: ${def.name} (${def.type})` })
  }
  private viewRef(ref: string) {
    const v = this.cfg.views.find((x) => x.id === ref) ?? this.cfg.views.find((x) => x.id === this.id('view', ref))
    if (!v) throw new CompileError('REF_UNKNOWN_VIEW', `View "${ref}" does not exist`)
    return v
  }
  updateView(ref: string, changes: Partial<ViewDef>) {
    const base = this.viewRef(ref)
    const m = this.mod(base.moduleId)
    const v = this.buildView({ ...changes, id: base.id }, m, base)
    v.id = base.id
    this.cfg.views = this.cfg.views.map((x) => (x.id === base.id ? v : x))
    this.changes.push({ kind: 'view', op: 'update', id: base.id, moduleId: m.id, label: `${m.name}: ${v.name}`, details: Object.keys(changes) })
  }
  removeView(ref: string) {
    const v = this.viewRef(ref)
    this.cfg.views = this.cfg.views.filter((x) => x.id !== v.id)
    this.changes.push({ kind: 'view', op: 'remove', id: v.id, moduleId: v.moduleId, label: v.name })
  }

  applyLayout(layout: { moduleId: string; groups: { title: string; fieldIds: string[] }[] }) {
    const m = this.mod(layout.moduleId)
    const all = layout.groups.flatMap((g) => g.fieldIds)
    this.checkFields(m, all, `Layout of "${m.name}"`)
    const order = [...all, ...m.fields.filter((f) => !all.includes(f.id)).map((f) => f.id)]
    const byId = new Map(m.fields.map((f) => [f.id, f]))
    const group = new Map(layout.groups.flatMap((g) => g.fieldIds.map((id) => [id, g.title] as const)))
    this.replaceModule({ ...m, fields: order.map((id, i) => ({ ...byId.get(id)!, order: i, group: group.get(id) ?? byId.get(id)!.group })), updatedAt: this.ctx.now })
    this.changes.push({ kind: 'module', op: 'update', id: m.id, label: `${m.name} record layout`, details: layout.groups.map((g) => g.title) })
  }

  // ---- workflows -------------------------------------------------------------------------------
  private buildWorkflow(def: Partial<WorkflowDef> & { id: string }, m: Module, base?: Workflow): Workflow {
    const trigger = def.trigger ?? base!.trigger
    const t: Workflow['trigger'] = {
      type: trigger.type as Workflow['trigger']['type'],
      fieldId: trigger.fieldId,
      value: 'value' in trigger ? scalarOrUndef(trigger.value) : undefined,
      offsetDays: trigger.offsetDays,
      everyMinutes: 'everyMinutes' in trigger ? trigger.everyMinutes : undefined,
    }
    if (t.fieldId) this.checkFields(m, [t.fieldId], `Workflow "${def.name ?? base?.name}" trigger`)
    const conditions = def.conditions
      ? def.conditions.map((c) => {
          this.checkFields(m, [c.fieldId], 'Workflow condition')
          return { id: `cnd_${c.id}`, fieldId: c.fieldId, op: c.op, value: scalarOrUndef(c.value) }
        })
      : (base?.conditions ?? [])
    const actions = def.actions
      ? def.actions.map((a) => {
          if (a.moduleId) this.mod(a.moduleId)
          return {
            id: `act_${a.id}`,
            type: a.type as Workflow['actions'][number]['type'],
            fieldId: a.fieldId,
            value: scalarOrUndef(a.value),
            moduleId: a.moduleId ? this.mod(a.moduleId).id : undefined,
            values: a.values ? Object.fromEntries(a.values.map((v) => [v.fieldId, v.value])) : undefined,
            title: a.title,
            days: a.days,
            userId: a.userId,
            message: a.message,
          }
        })
      : (base?.actions ?? [])
    const t0 = this.ctx.now
    const wf: Workflow = {
      id: base?.id ?? this.id('workflow', def.id),
      workspaceId: this.ctx.workspaceId,
      moduleId: m.id,
      name: def.name ?? base?.name ?? 'Workflow',
      description: def.description ?? base?.description,
      enabled: false,
      trigger: t,
      conditions,
      actions,
      origin: 'ai',
      createdAt: base?.createdAt ?? t0,
      updatedAt: t0,
    }
    const cls = classifyWorkflow(wf, this.cfg.modules)
    wf.consequential = cls.consequential
    // an approval is bound to the exact definition that was approved: any change voids it
    const defHash = workflowHash(wf)
    wf.approval = base?.approval && base.approval.hash === defHash ? base.approval : undefined
    wf.enabled = base ? base.enabled && (!cls.consequential || !!wf.approval) : false
    if (base && base.enabled && !wf.enabled) this.warnings.push(`Workflow "${wf.name}" was switched off because its definition changed and it needs to be approved again`)
    wf.lastScheduledAt = base?.lastScheduledAt
    return wf
  }
  addWorkflow(def: WorkflowDef) {
    const m = this.mod(def.moduleId)
    const id = this.id('workflow', def.id)
    const base = this.cfg.workflows.find((w) => w.id === id)
    const wf = this.buildWorkflow(def, m, base)
    this.cfg.workflows = base ? this.cfg.workflows.map((w) => (w.id === id ? wf : w)) : [...this.cfg.workflows, wf]
    this.changes.push({ kind: 'workflow', op: base ? 'update' : 'add', id, moduleId: m.id, label: `${m.name}: ${def.name}`, details: wf.consequential ? ['starts switched off — needs your approval to activate'] : ['starts switched off'] })
    if (wf.consequential) this.needsApproval.push({ workflowId: id, name: wf.name, reasons: classifyWorkflow(wf, this.cfg.modules).reasons })
  }
  private wfRef(ref: string) {
    const w = this.cfg.workflows.find((x) => x.id === ref) ?? this.cfg.workflows.find((x) => x.id === this.id('workflow', ref))
    if (!w) throw new CompileError('REF_UNKNOWN_WORKFLOW', `Workflow "${ref}" does not exist`)
    return w
  }
  updateWorkflow(ref: string, changes: Partial<WorkflowDef>) {
    const base = this.wfRef(ref)
    const m = this.mod(base.moduleId)
    const wf = this.buildWorkflow({ ...changes, id: base.id }, m, base)
    wf.id = base.id
    this.cfg.workflows = this.cfg.workflows.map((w) => (w.id === base.id ? wf : w))
    this.changes.push({ kind: 'workflow', op: 'update', id: base.id, moduleId: m.id, label: `${m.name}: ${wf.name}`, details: Object.keys(changes) })
    if (wf.consequential && !wf.approval) this.needsApproval.push({ workflowId: wf.id, name: wf.name, reasons: classifyWorkflow(wf, this.cfg.modules).reasons })
  }
  removeWorkflow(ref: string) {
    const w = this.wfRef(ref)
    this.cfg.workflows = this.cfg.workflows.filter((x) => x.id !== w.id)
    this.changes.push({ kind: 'workflow', op: 'remove', id: w.id, moduleId: w.moduleId, label: w.name })
  }
  setWorkflowEnabled(ref: string, enabled: boolean) {
    const w = this.wfRef(ref)
    if (enabled) {
      const cls = classifyWorkflow(w, this.cfg.modules)
      if (cls.consequential && !(w.approval && w.approval.hash === workflowHash(w))) {
        this.needsApproval.push({ workflowId: w.id, name: w.name, reasons: cls.reasons })
        this.changes.push({ kind: 'workflow', op: 'enable', id: w.id, moduleId: w.moduleId, label: `${w.name} — NOT enabled: needs your explicit approval`, details: cls.reasons })
        return
      }
    }
    this.cfg.workflows = this.cfg.workflows.map((x) => (x.id === w.id ? { ...x, enabled, updatedAt: this.ctx.now } : x))
    this.changes.push({ kind: 'workflow', op: enabled ? 'enable' : 'disable', id: w.id, moduleId: w.moduleId, label: w.name })
  }

  // ---- dashboards ------------------------------------------------------------------------------
  private buildDashboard(def: Partial<DashboardDef> & { id: string }, base?: Dashboard): Dashboard {
    const widgets: Widget[] = def.components
      ? def.components.map((c) => {
          const m = this.mod(c.moduleId)
          this.checkFields(m, [...(c.fieldId ? [c.fieldId] : []), ...(c.groupByFieldId ? [c.groupByFieldId] : []), ...(c.dateFieldId ? [c.dateFieldId] : []), ...c.filters.map((f) => f.fieldId)], `Dashboard component "${c.title}"`)
          return {
            id: c.id,
            type: c.type,
            title: c.title,
            moduleId: m.id,
            agg: c.agg,
            fieldId: c.fieldId,
            groupBy: c.groupByFieldId,
            dateField: c.dateFieldId,
            dateRange: c.dateRange,
            filters: c.filters.map((f, i) => ({ id: `flt_${i}`, fieldId: f.fieldId, op: f.op, value: scalarOrUndef(f.value) })),
            limit: c.limit,
            w: c.w,
            h: c.h,
            definition: c.definition,
            refresh: c.refresh,
          }
        })
      : (base?.widgets ?? [])
    const t = this.ctx.now
    return { id: base?.id ?? this.id('dashboard', def.id), workspaceId: this.ctx.workspaceId, name: def.name ?? base?.name ?? 'Dashboard', widgets, createdAt: base?.createdAt ?? t, updatedAt: t }
  }
  addDashboard(def: DashboardDef) {
    const id = this.id('dashboard', def.id)
    const base = this.cfg.dashboards.find((d) => d.id === id)
    const d = this.buildDashboard(def, base)
    this.cfg.dashboards = base ? this.cfg.dashboards.map((x) => (x.id === id ? d : x)) : [...this.cfg.dashboards, d]
    this.changes.push({ kind: 'dashboard', op: base ? 'update' : 'add', id, label: `${def.name} (${def.components.length} components)` })
  }
  private dashRef(ref: string) {
    const d = this.cfg.dashboards.find((x) => x.id === ref) ?? this.cfg.dashboards.find((x) => x.id === this.id('dashboard', ref))
    if (!d) throw new CompileError('REF_UNKNOWN_DASHBOARD', `Dashboard "${ref}" does not exist`)
    return d
  }
  updateDashboard(ref: string, changes: Partial<DashboardDef>) {
    const base = this.dashRef(ref)
    const d = this.buildDashboard({ ...changes, id: base.id }, base)
    d.id = base.id
    this.cfg.dashboards = this.cfg.dashboards.map((x) => (x.id === base.id ? d : x))
    this.changes.push({ kind: 'dashboard', op: 'update', id: base.id, label: d.name, details: Object.keys(changes) })
  }
  removeDashboard(ref: string) {
    const d = this.dashRef(ref)
    this.cfg.dashboards = this.cfg.dashboards.filter((x) => x.id !== d.id)
    this.changes.push({ kind: 'dashboard', op: 'remove', id: d.id, label: d.name })
  }

  // ---- roles / permissions ---------------------------------------------------------------------
  addRole(def: RoleDef) {
    const id = this.id('role', def.id)
    const keys: PermissionKey[] = ['viewModules', 'createRecords', 'editRecords', 'deleteRecords', 'exportData', 'manageFields', 'manageForms', 'manageWorkflows', 'manageDashboards', 'accessSettings']
    const role: Role = { id, name: def.name, description: def.description, permissions: Object.fromEntries(keys.map((k) => [k, def.grants.includes(k)])) as Role['permissions'] }
    const exists = this.cfg.roles.some((r) => r.id === id)
    this.cfg.roles = exists ? this.cfg.roles.map((r) => (r.id === id ? role : r)) : [...this.cfg.roles, role]
    this.changes.push({ kind: 'role', op: exists ? 'update' : 'add', id, label: def.name, details: def.grants })
  }
  updatePermissions(rule: PermissionRule) {
    const roleId = this.roleId(rule.roleId)
    const m = this.mod(rule.moduleId)
    const role = this.cfg.roles.find((r) => r.id === roleId)!
    let next: Module = { ...m }
    const details: string[] = []
    if (rule.access) {
      next.permissions = { ...(next.permissions ?? {}), [roleId]: { ...rule.access } }
      details.push(`access: ${Object.entries(rule.access).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`)
    }
    if (rule.recordScope) {
      next.recordScope = { ...(next.recordScope ?? {}), [roleId]: rule.recordScope }
      details.push(`records: ${rule.recordScope}`)
    }
    if (rule.fieldAccess?.length) {
      this.checkFields(m, rule.fieldAccess.map((f) => f.fieldId), 'Permission rule')
      const byId = new Map(rule.fieldAccess.map((f) => [f.fieldId, f.access]))
      next = { ...next, fields: next.fields.map((f) => (byId.has(f.id) ? { ...f, permissions: { ...(f.permissions ?? {}), [roleId]: byId.get(f.id)! } } : f)) }
      details.push(`${rule.fieldAccess.length} field rule(s)`)
    }
    this.replaceModule({ ...next, updatedAt: this.ctx.now })
    this.changes.push({ kind: 'permission', op: 'update', id: `${roleId}:${m.id}`, moduleId: m.id, label: `${role.name} on ${m.name}`, details })
  }

  // ---- driver ----------------------------------------------------------------------------------
  run(op: AnyOp) {
    switch (op.op) {
      case 'add_module': return this.addModule(op.module)
      case 'update_module': return this.updateModule(op.id, op.changes as Partial<ModuleDef>)
      case 'remove_module': return this.removeModule(op.id, op.mode)
      case 'add_field': return this.addField(op.moduleId, op.field)
      case 'update_field': return this.updateField(op.moduleId, op.id, op.changes as Partial<FieldDef>)
      case 'remove_field': return this.removeField(op.moduleId, op.id)
      case 'add_relationship': return this.addRelationship(op.relationship)
      case 'update_relationship': return this.updateRelationship(op.moduleId, op.id, op.changes as Partial<RelationshipDef>)
      case 'remove_relationship': return this.removeRelationship(op.moduleId, op.id)
      case 'add_form': return this.addForm(op.form)
      case 'update_form': return this.updateForm(op.id, op.changes as Partial<FormDef>)
      case 'remove_form': return this.removeForm(op.id)
      case 'add_view': return this.addView(op.view)
      case 'update_view': return this.updateView(op.id, op.changes as Partial<ViewDef>)
      case 'remove_view': return this.removeView(op.id)
      case 'add_pipeline': return this.addPipeline(op.pipeline)
      case 'update_pipeline': return this.updatePipeline(op.moduleId, op.id, op.changes as Partial<PipelineDef>)
      case 'remove_pipeline': return this.removePipeline(op.moduleId, op.id)
      case 'add_workflow': return this.addWorkflow(op.workflow)
      case 'update_workflow': return this.updateWorkflow(op.id, op.changes as Partial<WorkflowDef>)
      case 'remove_workflow': return this.removeWorkflow(op.id)
      case 'enable_workflow': return this.setWorkflowEnabled(op.id, true)
      case 'disable_workflow': return this.setWorkflowEnabled(op.id, false)
      case 'add_formula': return this.addFormula(op.formula)
      case 'update_formula': return this.updateFormula(op.moduleId, op.id, op.changes as Partial<FormulaDef>)
      case 'remove_formula': return this.removeFormula(op.moduleId, op.id)
      case 'add_dashboard': return this.addDashboard(op.dashboard)
      case 'update_dashboard': return this.updateDashboard(op.id, op.changes as Partial<DashboardDef>)
      case 'remove_dashboard': return this.removeDashboard(op.id)
      case 'update_permissions': return this.updatePermissions(op.rule)
      case 'add_role': return this.addRole(op.role)
      case 'update_layout': return this.applyLayout(op.layout)
    }
  }

  finalize(): ApplyResult {
    // default form + "All records" view for brand-new modules, built from their FINAL field list
    for (const id of this.newModules) {
      const m = this.cfg.modules.find((x) => x.id === id)
      if (!m) continue
      const t = this.ctx.now
      if (!this.explicitFormsFor.has(id)) {
        const f = newForm(this.ctx.workspaceId, m)
        this.cfg.forms.push({ ...f, id: `form_${id}_default`, sections: makeSections(m.fields), createdAt: t, updatedAt: t })
      }
      if (!this.explicitViewsFor.has(id)) {
        const v = newView(this.ctx.workspaceId, m, 'All records', 'table', {}, 0)
        this.cfg.views.unshift({ ...v, id: `view_${id}_all`, createdAt: t, updatedAt: t })
      }
    }
    this.cfg.modules = this.cfg.modules.map((m) => this.reorder(m))
    return { config: this.cfg, changes: this.changes, warnings: this.warnings, needsApproval: dedupeApprovals(this.needsApproval), navAdds: this.navAdds, navRemoves: this.navRemoves }
  }
}

function dedupeApprovals(a: ApplyResult['needsApproval']) {
  const seen = new Set<string>()
  return a.filter((x) => (seen.has(x.workflowId) ? false : (seen.add(x.workflowId), true)))
}

/** Hash of everything that defines what a workflow does (not its enabled/approval/bookkeeping fields). */
export { workflowHash }

/** Apply operations to a COPY of the config. Pure: nothing is written anywhere. Throws CompileError on an impossible operation. */
export function applyOps(cfg: ConfigModel, ops: AnyOp[], ctx: ApplyContext): ApplyResult {
  const a = new Applier(cfg, ctx)
  for (const op of ops) {
    try {
      a.run(op)
    } catch (e) {
      if (e instanceof CompileError) throw new CompileError(e.code, `${opLabel(op)}: ${e.message}`, e.path)
      throw e
    }
  }
  return a.finalize()
}

export interface OpFailure {
  index: number
  op: string
  code: string
  message: string
  path?: string
}

/**
 * Like applyOps, but an impossible operation is skipped (and reported) instead of aborting, so validation can show the model
 * every broken reference at once. The returned config is for diagnostics only; it is never committed when failures exist.
 */
export function applyOpsCollect(cfg: ConfigModel, ops: AnyOp[], ctx: ApplyContext): { result: ApplyResult; failures: OpFailure[] } {
  const a = new Applier(cfg, ctx)
  const failures: OpFailure[] = []
  ops.forEach((op, index) => {
    const snap = clone(a.cfg)
    const lens = [a.changes.length, a.warnings.length, a.needsApproval.length, a.navAdds.length, a.navRemoves.length]
    try {
      a.run(op)
    } catch (e) {
      if (!(e instanceof CompileError)) throw e
      a.cfg = snap
      a.changes.length = lens[0]
      a.warnings.length = lens[1]
      a.needsApproval.length = lens[2]
      a.navAdds.length = lens[3]
      a.navRemoves.length = lens[4]
      failures.push({ index, op: opLabel(op), code: e.code, message: e.message, path: e.path })
    }
  })
  return { result: a.finalize(), failures }
}

export { AI_ROLE_PREFIX }
