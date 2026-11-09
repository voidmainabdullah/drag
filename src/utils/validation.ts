import type { CrmRecord, Field, Module } from '#/types'
import { buildFieldSchema, isEmpty } from './fieldTypes'
import { matchesFilter } from './records'

export function isFieldVisible(m: Module, field: Field, data: Record<string, unknown>): boolean {
  const c = field.condition
  if (!c || !c.fieldId) return true
  const tmp = { id: 'tmp', data } as unknown as CrmRecord
  return matchesFilter(m, tmp, { id: 'c', fieldId: c.fieldId, op: c.op, value: c.value })
}

const NON_EDITABLE = new Set(['formula', 'autoId'])

/**
 * Pipeline rules (set by the Genius AI builder or by hand): which stage moves are allowed, and which fields must be
 * filled before a record may ENTER a stage. `prev` is the record before the change (absent on create).
 */
export function validatePipelines(m: Module, data: Record<string, unknown>, prev?: CrmRecord): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of m.fields) {
    const p = f.pipeline
    if (!p) continue
    const to = data[f.id]
    const from = prev?.data[f.id]
    if (typeof to !== 'string' || !to || to === from) continue
    const label = (id: unknown) => f.options?.find((o) => o.id === id)?.label ?? String(id)
    const tr = p.transitions
    if (prev && typeof from === 'string' && from && tr && Object.keys(tr).length) {
      const allowed = tr[from] ?? []
      if (!allowed.includes(to)) {
        errors[f.id] = `${f.label}: cannot move from "${label(from)}" to "${label(to)}"${allowed.length ? `; allowed: ${allowed.map(label).join(', ')}` : '; this is a final stage'}`
        continue
      }
    }
    const missing = (p.requiredFields?.[to] ?? []).filter((fid) => isEmpty(data[fid]))
    if (missing.length) errors[f.id] = `To move to "${label(to)}", fill in: ${missing.map((fid) => m.fields.find((x) => x.id === fid)?.label ?? fid).join(', ')}`
  }
  return errors
}

export function validateRecordData(
  m: Module,
  data: Record<string, unknown>,
  opts: { existing?: CrmRecord[]; selfId?: string; fields?: Field[]; previous?: CrmRecord } = {},
): Record<string, string> {
  const errors: Record<string, string> = {}
  const fields = opts.fields ?? m.fields
  for (const f of fields) {
    if (NON_EDITABLE.has(f.type)) continue
    if (!isFieldVisible(m, f, data)) continue
    const v = data[f.id]
    const res = buildFieldSchema(f).safeParse(v)
    if (!res.success) {
      errors[f.id] = res.error.issues[0]?.message ?? 'Invalid value'
      continue
    }
    const rw = f.requiredWhen
    if (rw && isEmpty(v) && matchesFilter(m, { id: 'tmp', data } as unknown as CrmRecord, { id: 'rw', fieldId: rw.fieldId, op: rw.op, value: rw.value })) {
      errors[f.id] = `${f.label} is required here`
      continue
    }
    if (f.unique && !isEmpty(v) && opts.existing) {
      const dup = opts.existing.some(
        (r) => r.moduleId === m.id && r.id !== opts.selfId && !r.deletedAt && String(r.data[f.id] ?? '').toLowerCase() === String(v).toLowerCase(),
      )
      if (dup) errors[f.id] = `${f.label} must be unique — this value is already used`
    }
  }
  // several fields that must be unique TOGETHER (e.g. one attendance mark per student per day)
  for (const group of m.constraints?.uniqueTogether ?? []) {
    if (!opts.existing || group.some((id) => isEmpty(data[id]))) continue
    const key = (d: Record<string, unknown>) => group.map((id) => JSON.stringify(d[id] ?? null).toLowerCase()).join('|')
    const mine = key(data)
    if (opts.existing.some((r) => r.moduleId === m.id && r.id !== opts.selfId && !r.deletedAt && key(r.data) === mine)) {
      const first = group[0]
      if (!errors[first]) errors[first] = `This combination of ${group.map((id) => m.fields.find((f) => f.id === id)?.label ?? id).join(' + ')} already exists`
    }
  }
  for (const [k, v] of Object.entries(validatePipelines(m, data, opts.previous))) errors[k] ??= v
  return errors
}
