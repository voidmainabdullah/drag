import { format, isValid, parseISO } from 'date-fns'
import type { CrmRecord, Field, Filter, ID, Module, SortRule, User } from '#/types'
import { evaluateFormula, type FormulaValue } from './formula'
import { evaluateSpecField } from '#/genius/formula/appHost'
import { formatCurrency, isEmpty, isMultiValue, isNumericType } from './fieldTypes'

export interface Ctx {
  users: Map<ID, User>
  modules: Map<ID, Module>
  records: Map<ID, CrmRecord>
}

export function makeCtx(modules: Module[], records: CrmRecord[], users: User[]): Ctx {
  return {
    users: new Map(users.map((u) => [u.id, u])),
    modules: new Map(modules.map((m) => [m.id, m])),
    records: new Map(records.map((r) => [r.id, r])),
  }
}

export const META_FIELDS: Field[] = [
  { id: '__createdAt', name: 'created_at', label: 'Created', type: 'datetime', width: 'full', order: -2, readOnly: true },
  { id: '__updatedAt', name: 'updated_at', label: 'Updated', type: 'datetime', width: 'full', order: -1, readOnly: true },
]

export function fieldsWithMeta(m: Module): Field[] {
  return [...m.fields, ...META_FIELDS]
}

export function toIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v) return [v]
  return []
}

export function findField(m: Module, ref: string): Field | undefined {
  return fieldsWithMeta(m).find((f) => f.id === ref || f.name === ref)
}

export function valueOf(m: Module, r: CrmRecord, field: Field, ctx?: Ctx, depth = 0): unknown {
  if (field.id === '__createdAt') return r.createdAt
  if (field.id === '__updatedAt') return r.updatedAt
  if (field.type === 'formula' && field.formulaSpec) {
    // decimal-safe AST formulas (Genius AI builder / formula editor); aggregates over related records included
    const res = evaluateSpecField(ctx ?? makeCtx([m], [r], []), m, r, field.formulaSpec, (mm, rr, fid) => {
      const f = mm.fields.find((x) => x.id === fid)
      return f ? valueOf(mm, rr, f, ctx, depth + 1) : null
    })
    if (res !== null && typeof res === 'object') return `#ERR: ${res.error}`
    return res
  }
  if (field.type === 'formula') {
    if (depth > 4) return null
    const res = evaluateFormula(field.formula, (name) => {
      const f = m.fields.find((x) => x.name === name || x.id === name)
      if (!f) return null
      const v = valueOf(m, r, f, ctx, depth + 1)
      if (v === null || v === undefined) return null
      if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v as FormulaValue
      if (Array.isArray(v)) return v.length
      return String(v)
    })
    if (res !== null && typeof res === 'object' && 'error' in res) return `#ERR: ${res.error}`
    return res
  }
  return r.data[field.id]
}

export function safeDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const d = parseISO(v)
  if (isValid(d)) return d
  const d2 = new Date(v)
  return isValid(d2) ? d2 : null
}

export function fmtDate(v: unknown, withTime = false): string {
  const d = safeDate(v)
  if (!d) return ''
  return format(d, withTime ? 'MMM d, yyyy h:mm a' : 'MMM d, yyyy')
}

export function displayValue(field: Field, value: unknown, ctx?: Ctx): string {
  if (isEmpty(value) && value !== false && value !== 0) return ''
  switch (field.type) {
    case 'yesNo':
      return value ? 'Yes' : 'No'
    case 'date':
      return fmtDate(value)
    case 'datetime':
      return fmtDate(value, true)
    case 'currency':
      return typeof value === 'number' ? formatCurrency(value, field.currency) : String(value)
    case 'percentage':
      return `${value}%`
    case 'formula': {
      const spec = field.formulaSpec
      if (spec && typeof value === 'number') {
        if (spec.resultType === 'money') return formatCurrency(value, spec.currency)
        if (spec.resultType === 'percentage') return `${value.toFixed(spec.precision)}%`
        return value.toFixed(spec.resultType === 'integer' ? 0 : spec.precision)
      }
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
    }
    case 'rating':
      return '★'.repeat(Math.round(Number(value) || 0))
    case 'dropdown':
    case 'radio':
      return field.options?.find((o) => o.id === value)?.label ?? String(value)
    case 'multiSelect':
    case 'checkboxes':
      return toIds(value)
        .map((id) => field.options?.find((o) => o.id === id)?.label ?? id)
        .join(', ')
    case 'tags':
      return toIds(value).join(', ')
    case 'user':
      return ctx?.users.get(String(value))?.name ?? 'Unknown user'
    case 'address': {
      const a = value as Record<string, string>
      return [a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(', ')
    }
    case 'file':
    case 'image':
    case 'document':
      return (Array.isArray(value) ? value : []).map((f: { name: string }) => f.name).join(', ')
    case 'signature':
      return 'Signed'
    case 'password':
      return '••••••••'
    case 'relationship': {
      const target = field.relation ? ctx?.modules.get(field.relation.moduleId) : undefined
      const lookup = target && field.relation?.lookupFieldId ? target.fields.find((f) => f.id === field.relation!.lookupFieldId) : undefined
      return toIds(value)
        .map((id) => {
          const rec = ctx?.records.get(id)
          if (!rec || !target) return 'Deleted record'
          if (lookup) return displayValue(lookup, valueOf(target, rec, lookup, ctx), ctx)
          return recordTitle(target, rec, ctx)
        })
        .join(', ')
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

export function titleField(m: Module): Field | undefined {
  if (m.titleFieldId) {
    const f = m.fields.find((x) => x.id === m.titleFieldId)
    if (f) return f
  }
  return (
    m.fields.find((f) => f.type === 'shortText') ??
    m.fields.find((f) => f.type === 'autoId' || f.type === 'email') ??
    m.fields[0]
  )
}

export function recordTitle(m: Module, r: CrmRecord, ctx?: Ctx): string {
  const f = titleField(m)
  if (f) {
    const v = displayValue(f, valueOf(m, r, f, ctx), ctx)
    if (v) return v
  }
  return `${m.name} ${r.id.slice(-4).toUpperCase()}`
}

function compareRaw(a: unknown, b: unknown, field: Field): number {
  if (isNumericType(field.type)) return (Number(a) || 0) - (Number(b) || 0)
  if (field.type === 'date' || field.type === 'datetime' || field.id.startsWith('__')) {
    return (Date.parse(String(a)) || 0) - (Date.parse(String(b)) || 0)
  }
  if (field.type === 'yesNo') return Number(Boolean(a)) - Number(Boolean(b))
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' })
}

export function matchesFilter(m: Module, r: CrmRecord, f: Filter, ctx?: Ctx): boolean {
  const field = findField(m, f.fieldId)
  if (!field) return true
  const raw = valueOf(m, r, field, ctx)
  const empty = isEmpty(raw) && raw !== false && raw !== 0
  switch (f.op) {
    case 'empty':
      return empty
    case 'not_empty':
      return !empty
  }
  const fv = f.value
  if (fv === undefined || fv === '' || fv === null) return true
  const text = displayValue(field, raw, ctx).toLowerCase()
  const q = String(fv).toLowerCase()
  switch (f.op) {
    case 'equals':
    case 'not_equals': {
      let eq: boolean
      if (field.type === 'yesNo') eq = String(Boolean(raw)) === q
      else if (isMultiValue(field.type) || field.type === 'relationship') eq = toIds(raw).map((x) => x.toLowerCase()).includes(q) || text === q
      else if (isNumericType(field.type)) eq = Number(raw) === Number(fv)
      else if (field.type === 'date' || field.type === 'datetime') eq = String(raw).slice(0, 10) === String(fv).slice(0, 10)
      else eq = String(raw ?? '').toLowerCase() === q || text === q
      return f.op === 'equals' ? eq : !eq
    }
    case 'contains':
      return text.includes(q) || String(raw ?? '').toLowerCase().includes(q)
    case 'not_contains':
      return !(text.includes(q) || String(raw ?? '').toLowerCase().includes(q))
    case 'greater':
      if (empty) return false
      return compareRaw(raw, fv, field) > 0
    case 'less':
      if (empty) return false
      return compareRaw(raw, fv, field) < 0
  }
  return true
}

export function applyFilters(m: Module, records: CrmRecord[], filters: Filter[], ctx?: Ctx): CrmRecord[] {
  const active = filters.filter((f) => f.fieldId)
  if (!active.length) return records
  return records.filter((r) => active.every((f) => matchesFilter(m, r, f, ctx)))
}

export function applySorts(m: Module, records: CrmRecord[], sorts: SortRule[], ctx?: Ctx): CrmRecord[] {
  const active = sorts.filter((s) => findField(m, s.fieldId))
  if (!active.length) return records
  return [...records].sort((a, b) => {
    for (const s of active) {
      const field = findField(m, s.fieldId)!
      const av = valueOf(m, a, field, ctx)
      const bv = valueOf(m, b, field, ctx)
      const ae = isEmpty(av)
      const be = isEmpty(bv)
      if (ae && be) continue
      if (ae) return 1
      if (be) return -1
      const c = compareRaw(field.type === 'relationship' || field.type === 'dropdown' || field.type === 'user' ? displayValue(field, av, ctx) : av, field.type === 'relationship' || field.type === 'dropdown' || field.type === 'user' ? displayValue(field, bv, ctx) : bv, field.type === 'relationship' || field.type === 'dropdown' || field.type === 'user' ? { ...field, type: 'shortText' } : field)
      if (c !== 0) return s.dir === 'asc' ? c : -c
    }
    return 0
  })
}

export function searchRecords(m: Module, records: CrmRecord[], q: string, ctx?: Ctx): CrmRecord[] {
  const s = q.trim().toLowerCase()
  if (!s) return records
  return records.filter((r) =>
    m.fields.some((f) => {
      if (f.type === 'password') return false
      const v = valueOf(m, r, f, ctx)
      if (isEmpty(v)) return false
      return displayValue(f, v, ctx).toLowerCase().includes(s)
    }),
  )
}

export interface Group {
  key: string
  label: string
  color?: string
  records: CrmRecord[]
}

export function groupRecords(m: Module, records: CrmRecord[], fieldId: string | undefined, ctx?: Ctx): Group[] {
  const field = fieldId ? findField(m, fieldId) : undefined
  if (!field) return [{ key: '__all', label: 'All', records }]
  const map = new Map<string, Group>()
  const ensure = (key: string, label: string, color?: string) => {
    if (!map.has(key)) map.set(key, { key, label, color, records: [] })
    return map.get(key)!
  }
  if (field.options?.length && (field.type === 'dropdown' || field.type === 'radio')) {
    field.options.forEach((o) => ensure(o.id, o.label, o.color))
  }
  const noneKey = '__none'
  for (const r of records) {
    const v = valueOf(m, r, field, ctx)
    if (isEmpty(v) && v !== false) {
      ensure(noneKey, 'No value').records.push(r)
      continue
    }
    const keys = Array.isArray(v) ? v.map(String) : [field.type === 'date' || field.type === 'datetime' ? String(v).slice(0, 10) : String(v)]
    for (const k of keys) {
      const label = Array.isArray(v) ? displayValue(field, [k], ctx) : displayValue(field, v, ctx)
      ensure(k, label || k).records.push(r)
    }
  }
  const out = [...map.values()]
  const none = out.filter((g) => g.key === noneKey)
  const rest = out.filter((g) => g.key !== noneKey)
  if (!field.options?.length) rest.sort((a, b) => a.label.localeCompare(b.label))
  // keep "No value" last, but drop it for option-grouped fields when empty (kanban re-adds it)
  return [...rest, ...none]
}

export function nextAutoId(m: Module, field: Field): { value: string; counters: Record<string, number> } {
  const counters = { ...(m.counters ?? {}) }
  const n = (counters[field.id] ?? 0) + 1
  counters[field.id] = n
  return { value: `${field.idPrefix || 'ID'}-${String(n).padStart(4, '0')}`, counters }
}
