import type { Field, FilterOp, Module, Workflow } from '#/types'
import { canonicalJson, type ConfigModel } from '../config/model'
import { analyseGraph, dependenciesOf, kindOfField, runFormulaTests, typeCheck, type FormulaSchema } from '../formula/analysis'
import { parseExpression } from '../formula/parser'
import { formulaNodes, schemaOf } from '../config/dependencies'
import { ACTION_REGISTRY, CHOICE_FIELD_TYPES, COLLECTION_FIELD_TYPES, DATE_FIELD_TYPES, NUMERIC_FIELD_TYPES, RESERVED_FIELD_IDS, SUPPORTED_TRIGGERS, TEXT_FIELD_TYPES } from '../registry'
import { issue, type Issue } from './issues'
import { detectWorkflowLoops } from './loops'
import type { Change } from '../compiler/apply'

const b = 'business' as const
const cyc = 'cycles' as const

export interface RuleInput {
  next: ConfigModel
  prev: ConfigModel
  changes: Change[]
  /** declared sources per `${moduleId}.${fieldId}` for formulas added in this request */
  declared: Map<string, { moduleId: string; fieldId: string }[]>
}

export function touchedOf(changes: Change[]) {
  const modules = new Set<string>()
  const workflows = new Set<string>()
  const dashboards = new Set<string>()
  const forms = new Set<string>()
  const views = new Set<string>()
  for (const c of changes) {
    if (c.moduleId) modules.add(c.moduleId)
    if (c.kind === 'module') modules.add(c.id)
    if (c.kind === 'workflow') workflows.add(c.id)
    if (c.kind === 'dashboard') dashboards.add(c.id)
    if (c.kind === 'form') forms.add(c.id)
    if (c.kind === 'view') views.add(c.id)
  }
  return { modules, workflows, dashboards, forms, views }
}

const fieldOf = (m: Module | undefined, id: string | undefined) => (id ? m?.fields.find((f) => f.id === id) : undefined)
const isNumeric = (f: Field | undefined) => !!f && (NUMERIC_FIELD_TYPES.includes(f.type) || (f.type === 'formula' && kindOfField(f).kind === 'number'))
const isDate = (f: Field | undefined) => !!f && (DATE_FIELD_TYPES.includes(f.type) || (f.type === 'formula' && kindOfField(f).kind === 'date'))
const isTextual = (f: Field | undefined) => !!f && (TEXT_FIELD_TYPES.includes(f.type) || COLLECTION_FIELD_TYPES.includes(f.type) || CHOICE_FIELD_TYPES.includes(f.type) || f.type === 'address')

const NOT_COMPARABLE = new Set(['file', 'image', 'document', 'signature', 'password', 'address'])

function opCompatible(f: Field, op: FilterOp): boolean {
  if (op === 'empty' || op === 'not_empty') return true
  if (NOT_COMPARABLE.has(f.type)) return false
  if (op === 'greater' || op === 'less') return isNumeric(f) || isDate(f)
  if (op === 'contains' || op === 'not_contains') return isTextual(f) || f.type === 'user' || f.type === 'relationship'
  return true
}

function valueFits(f: Field, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  const s = String(value)
  if (s.includes('{{')) return true // template: resolved per record at run time
  if (isNumeric(f)) return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  if (f.type === 'yesNo') return typeof value === 'boolean' || ['true', 'false', 'yes', 'no'].includes(s.toLowerCase())
  if (CHOICE_FIELD_TYPES.includes(f.type) || f.type === 'tags') {
    if (f.type === 'tags') return true
    return !!f.options?.some((o) => o.id === s || o.label.toLowerCase() === s.toLowerCase())
  }
  if (isDate(f)) return /^\d{4}-\d{2}-\d{2}/.test(s)
  return true
}

function defaultFits(f: Field, d: unknown): string | null {
  if (d === undefined) return null
  if (d === '' && TEXT_FIELD_TYPES.includes(f.type)) return null
  if (Array.isArray(d)) return COLLECTION_FIELD_TYPES.includes(f.type) ? null : `an empty list is not a valid default for a ${f.type} field`
  if (isNumeric(f)) return typeof d === 'number' ? null : 'default must be a number'
  if (f.type === 'yesNo') return typeof d === 'boolean' ? null : 'default must be true or false'
  if (f.type === 'dropdown' || f.type === 'radio') return typeof d === 'string' && f.options?.some((o) => o.id === d) ? null : 'default must be the id of one of the options'
  if (isDate(f)) return typeof d === 'string' && (/^\d{4}-\d{2}-\d{2}/.test(d) || d === '{{today}}') ? null : 'default must be a date (YYYY-MM-DD) or {{today}}'
  if (TEXT_FIELD_TYPES.includes(f.type)) return typeof d === 'string' ? null : 'default must be text'
  return null
}

function checkField(m: Module, f: Field, next: ConfigModel): Issue[] {
  const out: Issue[] = []
  const p = `modules.${m.id}.fields.${f.id}`
  const err = (code: string, message: string, repair: string, sev: Issue['severity'] = 'error') => out.push(issue(b, code, p, message, repair, sev))
  if (RESERVED_FIELD_IDS.has(f.id) || f.id.startsWith('__')) err('FIELD_RESERVED_ID', `"${f.id}" is a system-managed field id`, 'Choose another id; id, created/updated, creator and owner fields are added automatically by Modules.')
  const isChoice = CHOICE_FIELD_TYPES.includes(f.type)
  if (isChoice && !(f.options && f.options.length >= 2)) err('FIELD_OPTIONS_REQUIRED', `${f.label} is a ${f.type} field and needs at least two options`, 'Add an options list with stable ids and labels.')
  if (!isChoice && f.type !== 'tags' && f.type !== 'formula' && f.options?.length) err('FIELD_OPTIONS_NOT_ALLOWED', `${f.label}: options only apply to choice fields`, 'Remove options or change the type to dropdown/radio/multiSelect/checkboxes.')
  if (f.options) {
    const ids = f.options.map((o) => o.id)
    if (new Set(ids).size !== ids.length) err('FIELD_OPTION_DUPLICATE', `${f.label} has duplicate option ids`, 'Give every option a unique id.')
  }
  if (f.type === 'currency' && !/^[A-Z]{3}$/.test(f.currency ?? '')) err('FIELD_CURRENCY_REQUIRED', `${f.label}: money fields need an ISO currency code`, 'Set currency, e.g. "GBP".')
  if (f.type !== 'currency' && f.type !== 'formula' && f.currency) err('FIELD_CURRENCY_NOT_ALLOWED', `${f.label}: currency only applies to money fields`, 'Remove currency or use the currency type.', 'warning')
  if (f.min !== undefined && f.max !== undefined && f.min > f.max) err('FIELD_RANGE', `${f.label}: min (${f.min}) is greater than max (${f.max})`, 'Make min <= max.')
  if (f.minLength !== undefined && f.maxLength !== undefined && f.minLength > f.maxLength) err('FIELD_LENGTH_RANGE', `${f.label}: minLength is greater than maxLength`, 'Make minLength <= maxLength.')
  if (f.precision !== undefined && !isNumeric(f) && f.type !== 'formula') err('FIELD_PRECISION_TYPE', `${f.label}: precision only applies to numeric fields`, 'Remove precision.', 'warning')
  if (f.dateMin && f.dateMax && f.dateMin > f.dateMax) err('FIELD_DATE_BOUNDS', `${f.label}: dateMin is after dateMax`, 'Make dateMin <= dateMax.')
  if ((f.dateMin || f.dateMax) && !isDate(f)) err('FIELD_DATE_BOUNDS', `${f.label}: date bounds only apply to date fields`, 'Remove dateMin/dateMax.', 'warning')
  const dm = defaultFits(f, f.defaultValue)
  if (dm) err('FIELD_DEFAULT_TYPE', `${f.label}: ${dm}`, 'Fix the default value so it matches the field type.')
  if (f.requiredWhen) {
    const t = fieldOf(m, f.requiredWhen.fieldId)
    if (!t) err('FIELD_REQUIRED_WHEN_REF', `${f.label}: requiredWhen points at unknown field "${f.requiredWhen.fieldId}"`, 'Reference a field of the same module.')
    else if (t.id === f.id) err('FIELD_REQUIRED_WHEN_REF', `${f.label}: a field cannot be conditionally required on itself`, 'Reference a different field.')
    else if (!opCompatible(t, f.requiredWhen.op)) err('FIELD_REQUIRED_WHEN_OP', `${f.label}: "${f.requiredWhen.op}" cannot be used on a ${t.type} field`, 'Use an operator that fits the referenced field type.')
  }
  if (f.unique && (f.type === 'yesNo' || COLLECTION_FIELD_TYPES.includes(f.type) || f.type === 'longText')) err('FIELD_UNIQUE_TYPE', `${f.label}: ${f.type} fields cannot be unique`, 'Remove unique or use a text/number/email field.')
  if (f.type === 'relationship') {
    const r = f.relation
    if (!r) err('REL_MISSING', `${f.label}: relationship has no target`, 'Define the relationship in "relationships".')
    else {
      if (r.required && r.deletePolicy === 'set_null') err('REL_REQUIRED_SET_NULL', `${f.label}: a required relationship cannot use "set null" on delete`, 'Use restrict or cascade, or make the relationship optional.')
      if (r.cardinality === 'one-to-many') out.push(issue(b, 'REL_PREFER_MANY_TO_ONE', p, `${f.label}: one-to-many stores a list on "${m.name}"; the usual design puts a many-to-one link on the "many" side`, 'Consider moving the link to the other module as many-to-one so it can be aggregated and filtered.', 'warning'))
      if (r.deletePolicy === 'cascade' && next.modules.find((x) => x.id === r.moduleId)?.kind === 'ledger') err('REL_CASCADE_LEDGER', `${f.label}: cascading delete into a ledger would erase financial history`, 'Use restrict.')
    }
  }
  return out
}

function checkFormula(m: Module, f: Field, rin: RuleInput): Issue[] {
  const out: Issue[] = []
  const spec = f.formulaSpec
  if (!spec) return out
  const p = `formulas.${m.id}.${f.id}`
  const schema = schemaOf(rin.next)
  const err = (code: string, message: string, repair: string, sev: Issue['severity'] = 'error') => out.push(issue(b, code, p, message, repair, sev))
  let ast
  try {
    ast = spec.ast ?? parseExpression(spec.expression)
  } catch (e) {
    err('FORMULA_SYNTAX', `${f.label}: ${e instanceof Error ? e.message : 'invalid expression'}`, 'Rewrite the expression using only the documented operators and functions.')
    return out
  }
  const tc = typeCheck(ast, m.id, schema)
  for (const i of tc.issues) err(i.code, `${f.label}: ${i.message}`, i.code === 'FORMULA_CURRENCY_MIX' ? 'Only combine amounts in the same currency.' : 'Reference real field ids with matching types.')
  const t = tc.type
  const rt = spec.resultType
  const numericResult = ['decimal', 'money', 'percentage', 'integer'].includes(rt)
  if (numericResult && t.kind !== 'number' && t.kind !== 'any' && t.kind !== 'null') err('FORMULA_RESULT_TYPE', `${f.label}: result type is ${rt} but the expression produces ${t.kind}`, 'Change resultType or the expression.')
  if (rt === 'text' && t.kind !== 'text' && t.kind !== 'any' && t.kind !== 'null') err('FORMULA_RESULT_TYPE', `${f.label}: result type is text but the expression produces ${t.kind}`, 'Change resultType or the expression.')
  if (rt === 'boolean' && t.kind !== 'boolean' && t.kind !== 'any') err('FORMULA_RESULT_TYPE', `${f.label}: result type is yes/no but the expression produces ${t.kind}`, 'Use a comparison or change resultType.')
  if (rt === 'date' && t.kind !== 'date' && t.kind !== 'any' && t.kind !== 'text' && t.kind !== 'null') err('FORMULA_RESULT_TYPE', `${f.label}: result type is date but the expression produces ${t.kind}`, 'Change resultType or the expression.')
  if (rt === 'money') {
    if (!/^[A-Z]{3}$/.test(spec.currency ?? '')) err('FORMULA_CURRENCY_REQUIRED', `${f.label}: money results need an ISO currency code`, 'Set currency, e.g. "GBP".')
    else if (t.currency && t.currency !== spec.currency) err('FORMULA_CURRENCY_MIX', `${f.label}: the expression is in ${t.currency} but the result currency is ${spec.currency}`, 'Make them the same: no exchange-rate source is configured.')
  } else if (spec.currency) err('FORMULA_CURRENCY_NOT_ALLOWED', `${f.label}: currency is only meaningful for money results`, 'Remove currency or set resultType to money.', 'warning')
  if (rt === 'percentage' && spec.precision > 4) err('FORMULA_PRECISION', `${f.label}: more than 4 decimals on a percentage is unusual`, 'Use precision 0-2.', 'warning')

  // declared sources versus what the expression really reads
  const real = dependenciesOf(ast, m.id, schema)
  const declared = rin.declared.get(`${m.id}.${f.id}`)
  if (declared) {
    const dk = new Set(declared.map((d) => `${d.moduleId}.${d.fieldId}`))
    for (const d of declared) {
      const dm = rin.next.modules.find((x) => x.id === d.moduleId) ?? rin.next.modules.find((x) => x.id.endsWith(`_${d.moduleId}`))
      if (!dm || !dm.fields.some((x) => x.id === d.fieldId)) err('FORMULA_SOURCE_UNKNOWN', `${f.label}: declared source ${d.moduleId}.${d.fieldId} does not exist`, 'List only fields that exist.')
    }
    const missing = real.filter((r) => !dk.has(`${r.moduleId}.${r.fieldId}`) && !dk.has(`${r.moduleId.replace(/^mod_[0-9a-f]{6}_/, '')}.${r.fieldId}`))
    if (missing.length) err('FORMULA_SOURCES_MISMATCH', `${f.label}: the expression reads ${missing.map((r) => `${r.moduleId.replace(/^mod_[0-9a-f]{6}_/, '')}.${r.fieldId}`).join(', ')} which are not declared in sources`, 'Declare every field the expression reads.', 'warning')
  }

  // deterministic tests: "parses" is not "correct"
  const needsTests = rt === 'money' || rt === 'percentage'
  const tests = spec.tests ?? []
  if (needsTests && tests.length === 0 && declared) err('FORMULA_TESTS_REQUIRED', `${f.label}: financial/percentage formulas need deterministic test cases with expected values`, 'Add at least 3 test cases (typical, boundary such as zero/empty, and a negative or edge case).')
  if (tests.length && !tc.issues.length) {
    for (const o of runFormulaTests(spec, m.id, schema, tests)) {
      if (!o.pass) err('FORMULA_TEST_FAILED', `${f.label}: test "${o.name}" expected ${JSON.stringify(o.expected)} but the formula gives ${JSON.stringify(o.actual)}${o.error ? ` (${o.error})` : ''}`, 'Fix the expression or the expected value; the engine result is exact decimal arithmetic.')
    }
  }
  // aggregates over records that can be entered twice
  if (real.some((r) => r.moduleId !== m.id)) {
    for (const mid of new Set(real.filter((r) => r.moduleId !== m.id).map((r) => r.moduleId))) {
      const om = rin.next.modules.find((x) => x.id === mid)
      if (om && !om.fields.some((x) => x.unique) && !om.constraints?.uniqueTogether?.length)
        out.push(issue(b, 'FORMULA_AGG_DUP_RISK', p, `${f.label} adds up "${om.name}" but that module has no unique field, so the same entry could be recorded twice and double counted`, 'Add a unique reference/receipt-number field to the aggregated module.', 'warning'))
    }
  }
  return out
}

function checkModule(m: Module, rin: RuleInput): Issue[] {
  const out: Issue[] = []
  const p = `modules.${m.id}`
  const err = (code: string, message: string, repair: string, sev: Issue['severity'] = 'error') => out.push(issue(b, code, p, message, repair, sev))
  const prev = rin.prev.modules.find((x) => x.id === m.id)
  const isNew = !prev
  if (isNew) {
    const dup = rin.next.modules.find((x) => x.id !== m.id && x.workspaceId === m.workspaceId && x.name.trim().toLowerCase() === m.name.trim().toLowerCase())
    if (dup) err('MODULE_NAME_COLLISION', `A module called "${m.name}" already exists`, 'Modify the existing module instead, or pick a different name.')
  }
  for (const f of m.fields) {
    const pf = prev?.fields.find((x) => x.id === f.id)
    if (pf && canonicalJson(pf) === canonicalJson(f)) continue
    out.push(...checkField(m, f, rin.next))
    if (f.type === 'formula') out.push(...checkFormula(m, f, rin))
  }
  if (m.titleFieldId) {
    const t = fieldOf(m, m.titleFieldId)
    if (!t) err('MODULE_DISPLAY_FIELD', `Display field "${m.titleFieldId}" does not exist`, 'Choose a text field of this module.')
    else if (['relationship', 'file', 'image', 'document', 'signature', 'password'].includes(t.type)) err('MODULE_DISPLAY_FIELD', `Display field "${t.label}" cannot be a ${t.type}`, 'Choose a text, number or formula field.')
  }
  for (const g of m.constraints?.uniqueTogether ?? []) for (const id of g) if (!fieldOf(m, id)) err('MODULE_UNIQUE_TOGETHER_REF', `uniqueTogether uses unknown field "${id}"`, 'Use field ids of this module.')
  if (m.kind === 'junction') {
    const links = m.fields.filter((f) => f.type === 'relationship' && f.relation && (f.relation.cardinality === 'many-to-one' || f.relation.cardinality === 'one-to-one'))
    if (links.length < 2) err('JUNCTION_LINKS', `Junction module "${m.name}" must link two modules with many-to-one relationships`, 'Add two many-to-one relationships from the junction module to the modules it connects.')
    else if (!m.constraints?.uniqueTogether?.some((g) => links.filter((l) => g.includes(l.id)).length >= 2)) err('JUNCTION_UNIQUE', `Junction module "${m.name}" needs a uniqueness constraint over its two links so the same pair cannot be linked twice`, 'Set uniqueTogether to the ids of the two relationship fields.')
  }
  // pipelines
  const stageFields = m.fields.filter((f) => f.pipeline)
  for (const f of stageFields) {
    const pp = `pipelines.${m.id}.${f.id}`
    const pipelineChanged = !prev || canonicalJson(prev.fields.find((x) => x.id === f.id)?.pipeline) !== canonicalJson(f.pipeline)
    if (!pipelineChanged) continue
    const ledgerish = m.kind === 'log' || m.kind === 'ledger' || m.kind === 'junction' || /attendance|ledger|journal|audit|history|(^|[^a-z])logs?([^a-z]|$)/i.test(`${m.name} ${m.id}`)
    if (ledgerish) out.push(issue(b, 'PIPELINE_NOT_APPLICABLE', pp, `"${m.name}" is a record of events/entries, not something that moves through stages`, 'Remove the pipeline; use a status dropdown only if entries genuinely change state.'))
    const ids = new Set((f.options ?? []).map((o) => o.id))
    for (const [from, tos] of Object.entries(f.pipeline!.transitions ?? {})) {
      if (!ids.has(from)) out.push(issue(b, 'PIPELINE_TRANSITION_REF', pp, `Transition from unknown stage "${from}"`, 'Use stage ids defined in the pipeline.'))
      for (const to of tos) if (!ids.has(to)) out.push(issue(b, 'PIPELINE_TRANSITION_REF', pp, `Transition to unknown stage "${to}"`, 'Use stage ids defined in the pipeline.'))
    }
    for (const [stage, fids] of Object.entries(f.pipeline!.requiredFields ?? {})) {
      if (!ids.has(stage)) out.push(issue(b, 'PIPELINE_TRANSITION_REF', pp, `Required-fields rule for unknown stage "${stage}"`, 'Use stage ids defined in the pipeline.'))
      for (const fid of fids) if (!fieldOf(m, fid)) out.push(issue(b, 'PIPELINE_REQUIRED_FIELD_REF', pp, `Stage "${stage}" requires unknown field "${fid}"`, 'Use field ids of this module.'))
    }
    if ((f.options ?? []).some((o) => /^(paid|unpaid|overdue|refunded|partially[ _]paid)$/i.test(o.label) || /^(paid|unpaid|overdue|refunded)$/.test(o.id)))
      out.push(issue(b, 'PIPELINE_MIXED_STATUS', pp, `Stages of "${m.name}" look like payment states; record stage, payment status and workflow status are three different things`, 'Keep payment status as its own (calculated) field and use the pipeline for the record lifecycle.', 'warning'))
  }
  return out
}

function checkViews(rin: RuleInput, touchedViews: Set<string>): Issue[] {
  const out: Issue[] = []
  for (const v of rin.next.views) {
    if (!touchedViews.has(v.id)) continue
    const m = rin.next.modules.find((x) => x.id === v.moduleId)
    if (!m) continue
    const p = `views.${v.id}`
    if (v.type === 'kanban') {
      const g = fieldOf(m, v.config.groupBy)
      if (!g || !(g.type === 'dropdown' || g.type === 'radio')) out.push(issue(b, 'VIEW_KANBAN_GROUP', p, `Board "${v.name}" must be grouped by a dropdown or radio field`, 'Set groupByFieldId to a dropdown field.'))
    }
    if (v.type === 'calendar' || v.type === 'timeline') if (!isDate(fieldOf(m, v.config.dateFieldId))) out.push(issue(b, 'VIEW_DATE_FIELD', p, `${v.type} view "${v.name}" needs a date field`, 'Set dateFieldId to a date field.'))
    for (const f of v.config.filters) {
      const fld = fieldOf(m, f.fieldId)
      if (fld && !opCompatible(fld, f.op)) out.push(issue(b, 'FILTER_OP_TYPE', p, `View "${v.name}": "${f.op}" cannot be used on ${fld.label} (${fld.type})`, 'Use an operator that fits the field type.'))
      else if (fld && !valueFits(fld, f.value)) out.push(issue(b, 'FILTER_VALUE_TYPE', p, `View "${v.name}": the value for ${fld.label} does not fit its type`, 'Use a value of the field type (an option id for dropdowns).'))
    }
  }
  return out
}

function checkForms(rin: RuleInput, touched: Set<string>): Issue[] {
  const out: Issue[] = []
  for (const f of rin.next.forms) {
    if (!touched.has(f.id)) continue
    const m = rin.next.modules.find((x) => x.id === f.moduleId)
    if (!m) continue
    const inForm = new Set(f.sections.flatMap((s) => s.items.map((i) => i.fieldId)))
    for (const fld of m.fields) if (fld.required && !['formula', 'autoId'].includes(fld.type) && !inForm.has(fld.id)) out.push(issue(b, 'FORM_REQUIRED_MISSING', `forms.${f.id}`, `Form "${f.name}" leaves out the required field "${fld.label}", so records could not be saved from it`, 'Add the field to a section or make it optional.', 'warning'))
  }
  return out
}

export function checkWorkflow(w: Workflow, next: ConfigModel): Issue[] {
  const out: Issue[] = []
  const p = `workflows.${w.id}`
  const m = next.modules.find((x) => x.id === w.moduleId)
  if (!m) return [issue(b, 'REF_UNKNOWN_MODULE', p, `Workflow "${w.name}" belongs to an unknown module`, 'Use an existing module id.')]
  const err = (code: string, message: string, repair: string, sev: Issue['severity'] = 'error') => out.push(issue(b, code, p, `${w.name}: ${message}`, repair, sev))
  const t = w.trigger
  if (!SUPPORTED_TRIGGERS[t.type]?.supported) err('WORKFLOW_UNREGISTERED_TRIGGER', `trigger "${t.type}" is not available`, 'Use a supported trigger.')
  const tf = fieldOf(m, t.fieldId)
  switch (t.type) {
    case 'status_changed':
      if (!tf || !(tf.type === 'dropdown' || tf.type === 'radio')) err('WORKFLOW_TRIGGER_FIELD', 'status_changed needs a dropdown/radio field', 'Set trigger.fieldId to the status field.')
      break
    case 'field_changed':
      if (!tf || tf.type === 'formula') err('WORKFLOW_TRIGGER_FIELD', 'field_changed needs a stored (non-formula) field', 'Set trigger.fieldId to a stored field.')
      break
    case 'relation_created':
    case 'relation_updated':
      if (!tf || tf.type !== 'relationship') err('WORKFLOW_TRIGGER_FIELD', `${t.type} needs a relationship field`, 'Set trigger.fieldId to a relationship field.')
      break
    case 'date_reached':
      if (!tf || !DATE_FIELD_TYPES.includes(tf.type)) err('WORKFLOW_TRIGGER_FIELD', 'date_reached needs a date field', 'Set trigger.fieldId to a date field.')
      break
    case 'scheduled':
      if (!t.everyMinutes || t.everyMinutes < 5) err('WORKFLOW_SCHEDULE', 'scheduled needs everyMinutes of at least 5', 'Set trigger.everyMinutes (e.g. 1440 for daily).')
      break
    default:
  }
  if (t.value !== undefined && t.value !== null && tf && !valueFits(tf, t.value)) err('WORKFLOW_TRIGGER_VALUE', `trigger value does not fit field ${tf.label}`, 'Use an option id / a value of the field type.')
  for (const c of w.conditions) {
    const f = fieldOf(m, c.fieldId)
    if (!f) continue
    if (!opCompatible(f, c.op)) err('WORKFLOW_COND_OP', `condition "${c.op}" cannot be used on ${f.label} (${f.type})`, 'Use an operator that fits the field type.')
    else if (!valueFits(f, c.value)) err('WORKFLOW_COND_VALUE', `condition value for ${f.label} does not fit its type`, 'Use a value of the field type (an option id for dropdowns).')
    else if ((c.op !== 'empty' && c.op !== 'not_empty') && (c.value === undefined || c.value === null || c.value === '')) err('WORKFLOW_COND_VALUE', `condition on ${f.label} needs a value`, 'Provide the value to compare with.')
  }
  for (const a of w.actions) {
    const spec = ACTION_REGISTRY[a.type]
    if (!spec) {
      err('WORKFLOW_UNREGISTERED_ACTION', `action "${a.type}" is not a registered action`, 'Use only registered actions.')
      continue
    }
    const params = { fieldId: a.fieldId, value: a.value, userId: a.userId, moduleId: a.moduleId, values: a.values, title: a.title, days: a.days, message: a.message }
    const parsed = spec.params.safeParse(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)))
    if (!parsed.success) {
      err('WORKFLOW_ACTION_PARAMS', `action "${spec.label}" has invalid parameters: ${parsed.error.issues.map((i) => i.path.join('.') || 'params').join(', ')}`, 'Provide the parameters documented for this action.')
      continue
    }
    if (a.type === 'update_record' || a.type === 'change_status' || a.type === 'assign_user' || a.type === 'add_tag') {
      const f = fieldOf(m, a.fieldId)
      if (!f) continue
      if (f.type === 'formula' || f.type === 'autoId') err('WORKFLOW_ACTION_FIELD', `cannot write to calculated field ${f.label}`, 'Target a stored field.')
      else if (a.type === 'change_status' && !(f.type === 'dropdown' || f.type === 'radio')) err('WORKFLOW_ACTION_FIELD', `change_status needs a dropdown/radio field, ${f.label} is ${f.type}`, 'Use update_record or a status field.')
      else if (a.type === 'assign_user' && f.type !== 'user') err('WORKFLOW_ACTION_FIELD', `assign_user needs a user field, ${f.label} is ${f.type}`, 'Target a user field.')
      else if (a.type === 'add_tag' && !(f.type === 'tags' || f.type === 'multiSelect' || f.type === 'checkboxes')) err('WORKFLOW_ACTION_FIELD', `add_tag needs a tags/multi-select field, ${f.label} is ${f.type}`, 'Target a tags field.')
      else if ((a.type === 'update_record' || a.type === 'change_status') && !valueFits(f, a.value)) err('WORKFLOW_ACTION_VALUE', `value for ${f.label} does not fit the field type`, 'Use a value of the field type (an option id for dropdowns).')
    }
    if (a.type === 'create_record') {
      const target = next.modules.find((x) => x.id === a.moduleId)
      if (target) {
        for (const [fid, tpl] of Object.entries(a.values ?? {})) {
          const f = fieldOf(target, fid)
          if (!f) err('WORKFLOW_ACTION_FIELD', `create_record sets unknown field "${fid}" of ${target.name}`, 'Use field ids of the target module.')
          else if (f.type === 'formula' || f.type === 'autoId') err('WORKFLOW_ACTION_FIELD', `cannot set calculated field ${f.label}`, 'Remove it from values.')
          else if (!valueFits(f, tpl)) err('WORKFLOW_ACTION_VALUE', `value for ${f.label} does not fit the field type`, 'Use a value of the field type.')
        }
        const missing = target.fields.filter((f) => f.required && !['formula', 'autoId'].includes(f.type) && f.defaultValue === undefined && !(a.values && f.id in a.values))
        if (missing.length) err('WORKFLOW_CREATE_MISSING_REQUIRED', `create_record does not fill required field(s) ${missing.map((f) => f.label).join(', ')} of ${target.name}`, 'Add them to values.', 'warning')
      }
    }
    if ((a.type === 'create_task' || a.type === 'create_followup') && !a.title) out.push(issue(b, 'WORKFLOW_PLACEHOLDER_TITLE', p, `${w.name}: the task has no title, so it will be named after the record only`, 'Give the task a specific title.', 'warning'))
  }
  return out
}

function checkDashboards(rin: RuleInput, touched: Set<string>): Issue[] {
  const out: Issue[] = []
  for (const d of rin.next.dashboards) {
    if (!touched.has(d.id)) continue
    for (const w of d.widgets) {
      const m = rin.next.modules.find((x) => x.id === w.moduleId)
      const p = `dashboards.${d.id}.${w.id}`
      if (!m) continue
      const f = fieldOf(m, w.fieldId)
      if (w.agg !== 'count' && !isNumeric(f)) out.push(issue(b, 'DASH_AGG_FIELD', p, `"${w.title}": ${w.agg} needs a numeric field`, 'Pick a number, money or percentage field, or use count.'))
      const g = fieldOf(m, w.groupBy)
      if (w.groupBy && g && ['file', 'image', 'document', 'signature', 'password', 'longText', 'address'].includes(g.type)) out.push(issue(b, 'DASH_GROUP_TYPE', p, `"${w.title}" cannot group by ${g.type}`, 'Group by a dropdown, date or relationship field.'))
      if (w.type === 'pipeline' && !(g && (g.type === 'dropdown' || g.type === 'radio'))) out.push(issue(b, 'DASH_PIPELINE_GROUP', p, `"${w.title}": a pipeline component must be grouped by a dropdown field`, 'Set groupByFieldId to the stage field.'))
      if (w.dateField && !isDate(fieldOf(m, w.dateField)) && !['__createdAt', '__updatedAt'].includes(w.dateField)) out.push(issue(b, 'DASH_DATE_FIELD', p, `"${w.title}": dateFieldId must be a date field`, 'Use a date/datetime field.'))
      if (w.dateRange !== 'all' && !w.dateField) out.push(issue(b, 'DASH_DATE_FIELD', p, `"${w.title}" filters by ${w.dateRange} but has no date field`, 'Set dateFieldId so the period is explicit.', 'warning'))
      for (const flt of w.filters) {
        const ff = fieldOf(m, flt.fieldId)
        if (ff && !opCompatible(ff, flt.op)) out.push(issue(b, 'FILTER_OP_TYPE', p, `"${w.title}": "${flt.op}" cannot be used on ${ff.label}`, 'Use an operator that fits the field type.'))
      }
    }
  }
  return out
}

/** Stage 3: business-logic validation, limited to components this request touched. */
export function businessRules(rin: RuleInput): Issue[] {
  const t = touchedOf(rin.changes)
  const out: Issue[] = []
  for (const m of rin.next.modules) if (t.modules.has(m.id)) out.push(...checkModule(m, rin))
  for (const w of rin.next.workflows) if (t.workflows.has(w.id)) out.push(...checkWorkflow(w, rin.next))
  out.push(...checkViews(rin, t.views), ...checkForms(rin, t.forms), ...checkDashboards(rin, t.dashboards))
  return out
}

/** Stage 4: cycle detection across relationships, formulas and workflow triggers (whole workspace, not just the changes). */
export function cycleRules(rin: RuleInput): Issue[] {
  const out: Issue[] = []
  const g = analyseGraph(formulaNodes(rin.next))
  const seen = new Set<string>()
  for (const c of g.cycles) {
    const key = [...c].sort().join('>')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue(cyc, 'FORMULA_CYCLE', `formulas.${c[0]}`, `Formulas depend on each other in a circle: ${c.join(' → ')}`, 'Break the circle: one of these formulas must read a stored field instead of another formula in the loop.'))
  }
  // a required relationship that (transitively) requires itself makes it impossible to create the first record
  const required = new Map<string, string[]>()
  for (const m of rin.next.modules)
    required.set(
      m.id,
      m.fields.filter((f) => f.type === 'relationship' && f.required && f.relation && f.relation.moduleId !== m.id && (f.relation.cardinality === 'many-to-one' || f.relation.cardinality === 'one-to-one')).map((f) => f.relation!.moduleId),
    )
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      const cycle = path.slice(path.indexOf(id))
      const key = [...cycle].sort().join('>')
      if (!seen.has(key)) {
        seen.add(key)
        out.push(issue(cyc, 'REL_REQUIRED_CYCLE', `relationships.${id}`, `Required relationships form a circle (${[...cycle, id].map((x) => rin.next.modules.find((m) => m.id === x)?.name ?? x).join(' → ')}): no first record could ever be created`, 'Make at least one of the relationships optional.'))
      }
      return
    }
    state.set(id, 1)
    for (const n of required.get(id) ?? []) visit(n, [...path, id])
    state.set(id, 2)
  }
  for (const id of required.keys()) visit(id, [])
  const touched = touchedOf(rin.changes)
  out.push(...detectWorkflowLoops(rin.next.workflows, touched.workflows.size ? touched.workflows : undefined))
  return out
}

export type { FormulaSchema }
