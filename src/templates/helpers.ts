import type { Cardinality, Field, FieldType, Template, TemplateDashboard, TemplateForm, TemplateModule, TemplateView, TemplateWorkflow, Widget } from '#/types'
import { makeOptions } from '#/utils/fieldTypes'
import { slug, uid } from '#/utils/id'
import { makeSections } from '#/services/defaults'

const CODES: Record<string, FieldType> = {
  text: 'shortText', long: 'longText', num: 'number', cur: 'currency', email: 'email', phone: 'phone', url: 'website',
  date: 'date', dt: 'datetime', sel: 'dropdown', multi: 'multiSelect', radio: 'radio', check: 'checkboxes', bool: 'yesNo',
  addr: 'address', file: 'file', img: 'image', doc: 'document', sig: 'signature', user: 'user', rel: 'relationship',
  f: 'formula', id: 'autoId', rate: 'rating', pct: 'percentage', tags: 'tags', time: 'time', color: 'color', pass: 'password',
}

const WIDE: FieldType[] = ['longText', 'address', 'tags', 'file', 'image', 'document', 'signature', 'multiSelect', 'checkboxes', 'relationship']
const CARD: Record<string, Cardinality> = { n1: 'many-to-one', '11': 'one-to-one', '1n': 'one-to-many', nn: 'many-to-many' }

/**
 * Field DSL:  [*]Label:type[:arg]
 *  - sel/multi/radio/check: arg = comma separated options
 *  - rel: arg = moduleKey[|n1|11|1n|nn]  (default many-to-one)
 *  - f: arg = formula using other field ids, e.g. {amount}*2
 *  - id: arg = prefix
 */
export function fld(spec: string, order = 0): Field {
  const required = spec.startsWith('*')
  const clean = required ? spec.slice(1) : spec
  const [label, code, ...rest] = clean.split(':')
  const arg = rest.join(':')
  const type = CODES[code]
  if (!type) throw new Error(`Unknown field code "${code}" in "${spec}"`)
  const id = slug(label)
  const f: Field = { id, name: id, label, type, width: WIDE.includes(type) ? 'full' : 'half', order }
  if (required) f.required = true
  if (type === 'dropdown' || type === 'multiSelect' || type === 'radio' || type === 'checkboxes') {
    f.options = makeOptions(arg.split(',').map((s) => s.trim()).filter(Boolean))
    if (type === 'dropdown' && /status|stage/i.test(label)) f.defaultValue = f.options[0]?.id
  }
  if (type === 'relationship') {
    const [target, card] = arg.split('|')
    f.relation = { moduleId: target, cardinality: CARD[card ?? 'n1'] ?? 'many-to-one' }
  }
  if (type === 'formula') {
    f.formula = arg
    f.readOnly = true
  }
  if (type === 'autoId') {
    f.idPrefix = arg || 'ID'
    f.readOnly = true
  }
  if (type === 'currency') f.currency = 'USD'
  if (type === 'rating') f.max = 5
  if (type === 'percentage') {
    f.min = 0
    f.max = 100
  }
  return f
}

export function mod(key: string, name: string, icon: string, specs: string[], opts: { color?: string; description?: string } = {}): TemplateModule {
  const seen = new Map<string, number>()
  const fields = specs.map((s, i) => {
    const f = fld(s, i)
    const n = seen.get(f.id) ?? 0
    seen.set(f.id, n + 1)
    if (n) {
      f.id = `${f.id}_${n + 1}`
      f.name = f.id
    }
    if (i === 0) f.width = 'full'
    return f
  })
  return { key, name, icon, color: opts.color, description: opts.description, fields, titleFieldId: fields.find((f) => f.type === 'shortText')?.id ?? fields[0]?.id }
}

const isStatus = (f: Field) => f.type === 'dropdown' && /status|stage/i.test(f.label)

function W(type: Widget['type'], title: string, moduleKey: string | undefined, extra: Partial<Omit<Widget, 'id'>> = {}): Omit<Widget, 'id'> {
  return { type, title, moduleId: moduleKey, agg: 'count', dateRange: 'all', filters: [], w: 2, h: 1, ...extra }
}

export function autoDashboard(name: string, modules: TemplateModule[]): TemplateDashboard {
  const widgets: Omit<Widget, 'id'>[] = []
  modules.slice(0, 4).forEach((m) => widgets.push(W('stat', `Total ${m.name}`, m.key, { w: 1 })))
  const withChoice = modules.find((m) => m.fields.some(isStatus)) ?? modules.find((m) => m.fields.some((f) => f.type === 'dropdown'))
  if (withChoice) {
    const f = withChoice.fields.find(isStatus) ?? withChoice.fields.find((x) => x.type === 'dropdown')!
    widgets.push(W('pie', `${withChoice.name} by ${f.label}`, withChoice.key, { groupBy: f.id, w: 2, h: 2 }))
    widgets.push(W('bar', `${withChoice.name} by ${f.label}`, withChoice.key, { groupBy: f.id, w: 2, h: 2 }))
  }
  const money = modules.flatMap((m) => m.fields.filter((f) => f.type === 'currency').map((f) => ({ m, f })))[0]
  if (money) widgets.push(W('revenue', `${money.f.label} summary`, money.m.key, { fieldId: money.f.id, agg: 'sum', w: 2, h: 2 }))
  widgets.push(W('recentRecords', `Recent ${modules[0].name}`, modules[0].key, { w: 2, h: 2, limit: 6 }))
  widgets.push(W('line', `${modules[0].name} created over time`, modules[0].key, { groupBy: '__createdAt', w: 2, h: 2 }))
  widgets.push(W('recentActivities', 'Recent activity', undefined, { w: 2, h: 2, limit: 8 }))
  return { name, widgets }
}

export interface TplDef {
  id: string
  name: string
  category: string
  description: string
  icon: string
  color?: string
  modules: TemplateModule[]
  dashboardName?: string
}

export function tpl(d: TplDef): Template {
  const forms: TemplateForm[] = d.modules.map((m) => ({ moduleKey: m.key, name: `${m.name} form`, sections: makeSections(m.fields) }))
  const views: TemplateView[] = []
  const workflows: TemplateWorkflow[] = []
  d.modules.forEach((m, mi) => {
    views.push({ moduleKey: m.key, name: 'All records', type: 'table', config: {} })
    const status = m.fields.find(isStatus) ?? m.fields.find((f) => f.type === 'dropdown' && (f.options?.length ?? 0) >= 2 && (f.options?.length ?? 0) <= 8)
    if (status) views.push({ moduleKey: m.key, name: 'Board', type: 'kanban', config: { groupBy: status.id } })
    const date = m.fields.find((f) => f.type === 'date' || f.type === 'datetime')
    if (date) views.push({ moduleKey: m.key, name: 'Calendar', type: 'calendar', config: { dateFieldId: date.id } })
    if (m.fields.some((f) => f.type === 'image')) views.push({ moduleKey: m.key, name: 'Gallery', type: 'gallery', config: {} })
    if (status && mi < 2) {
      workflows.push({
        name: `${m.name}: notify when ${status.label} changes`,
        moduleKey: m.key,
        trigger: { type: 'status_changed', fieldId: status.id },
        conditions: [],
        actions: [{ id: uid('a'), type: 'notify', message: '{{title}} moved to {{value}}' }],
      })
    }
    if (mi === 0) {
      workflows.push({
        name: `${m.name}: create follow-up task when added`,
        moduleKey: m.key,
        trigger: { type: 'record_created' },
        conditions: [],
        actions: [{ id: uid('a'), type: 'create_followup', title: 'Review new record: {{title}}', days: 1, userId: 'owner' }],
      })
    }
  })
  return { id: d.id, name: d.name, category: d.category, description: d.description, icon: d.icon, color: d.color, builtin: true, modules: d.modules, forms, views, workflows, dashboard: autoDashboard(d.dashboardName ?? `${d.name} dashboard`, d.modules) }
}
