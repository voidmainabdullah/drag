import type { CrmRecord, Field, Module } from '#/types'
import { displayValue, valueOf, type Ctx, recordTitle } from './records'
import { isEmpty, isSingleRel } from './fieldTypes'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQ = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else inQ = false
      } else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function esc(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => esc(c)).join(',')).join('\n')
}

export function recordsToTable(m: Module, records: CrmRecord[], ctx: Ctx, fields?: Field[]): string[][] {
  const cols = (fields ?? m.fields).filter((f) => f.type !== 'password' && f.type !== 'signature')
  const head = [...cols.map((f) => f.label), 'Created', 'Updated']
  const body = records.map((r) => [
    ...cols.map((f) => displayValue(f, valueOf(m, r, f, ctx), ctx)),
    r.createdAt,
    r.updatedAt,
  ])
  return [head, ...body]
}

export async function tableToXlsxBlob(sheets: { name: string; rows: string[][] }[]): Promise<Blob> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet')
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return parseCsv(await file.text())
  }
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' })
  return rows.map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim() !== ''))
}

export interface ParsedValue {
  value?: unknown
  error?: string
}

export function parseImportValue(field: Field, raw: string, ctx: Ctx, targetRecords: CrmRecord[]): ParsedValue {
  const s = raw.trim()
  if (s === '') return { value: undefined }
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percentage':
    case 'rating': {
      const n = Number(s.replace(/[$€£,%\s]/g, ''))
      return Number.isNaN(n) ? { error: `"${s}" is not a number` } : { value: n }
    }
    case 'date':
    case 'datetime': {
      const d = new Date(s)
      if (Number.isNaN(d.getTime())) return { error: `"${s}" is not a valid date` }
      return { value: field.type === 'date' ? d.toISOString().slice(0, 10) : d.toISOString() }
    }
    case 'yesNo':
      return { value: ['yes', 'true', '1', 'y', 'x'].includes(s.toLowerCase()) }
    case 'dropdown':
    case 'radio': {
      const o = field.options?.find((x) => x.label.toLowerCase() === s.toLowerCase() || x.id === s)
      return o ? { value: o.id } : { error: `"${s}" is not an option of ${field.label}` }
    }
    case 'multiSelect':
    case 'checkboxes': {
      const parts = s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean)
      const ids: string[] = []
      for (const p of parts) {
        const o = field.options?.find((x) => x.label.toLowerCase() === p.toLowerCase() || x.id === p)
        if (!o) return { error: `"${p}" is not an option of ${field.label}` }
        ids.push(o.id)
      }
      return { value: ids }
    }
    case 'tags':
      return { value: s.split(/[;,|]/).map((x) => x.trim()).filter(Boolean) }
    case 'user': {
      const u = [...ctx.users.values()].find((x) => x.name.toLowerCase() === s.toLowerCase() || x.email.toLowerCase() === s.toLowerCase())
      return u ? { value: u.id } : { error: `No team member matches "${s}"` }
    }
    case 'relationship': {
      const target = field.relation ? ctx.modules.get(field.relation.moduleId) : undefined
      if (!target) return { error: 'Related module missing' }
      const parts = !isSingleRel(field) ? s.split(/[;|]/).map((x) => x.trim()).filter(Boolean) : [s]
      const ids: string[] = []
      for (const p of parts) {
        const rec = targetRecords.find((r) => recordTitle(target, r, ctx).toLowerCase() === p.toLowerCase())
        if (!rec) return { error: `No ${target.name} record titled "${p}"` }
        ids.push(rec.id)
      }
      return { value: isSingleRel(field) ? ids[0] : ids }
    }
    case 'address':
      return { value: { street: s, city: '', state: '', zip: '', country: '' } }
    case 'file':
    case 'image':
    case 'document':
    case 'signature':
    case 'formula':
    case 'autoId':
      return { value: undefined }
    default:
      return { value: s }
  }
}

export function hasValue(v: unknown) {
  return !isEmpty(v)
}
