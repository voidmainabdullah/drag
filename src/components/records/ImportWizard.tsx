import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import type { Field, Module } from '#/types'
import { useCtx, useRecords } from '#/hooks/useData'
import { useRecordStore } from '#/stores/recordStore'
import { parseSpreadsheetFile, parseImportValue, toCsv } from '#/utils/csv'
import { validateRecordData } from '#/utils/validation'
import { defaultValueFor } from '#/utils/fieldTypes'
import { downloadText, safeFileName } from '#/utils/download'
import { toast } from '#/utils/toast'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Select } from '#/components/ui/controls'
import { Notice, Spinner } from '#/components/ui/misc'
import { logActivity } from '#/stores/activityStore'

const SKIP = ''
const NOT_IMPORTABLE = new Set(['formula', 'autoId', 'file', 'image', 'document', 'signature'])

interface Row {
  n: number
  data: Record<string, unknown>
  errors: string[]
}

export function ImportWizard({ module, open, onClose }: { module: Module; open: boolean; onClose: () => void }) {
  const ctx = useCtx()
  const existing = useRecords()
  const [table, setTable] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [done, setDone] = useState<{ ok: number; failed: Row[] } | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)

  const fields = module.fields.filter((f) => !NOT_IMPORTABLE.has(f.type))
  const header = table?.[0] ?? []

  const reset = () => {
    setTable(null)
    setFileName('')
    setMapping({})
    setDone(null)
  }
  const close = () => {
    reset()
    onClose()
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    try {
      const rows = await parseSpreadsheetFile(f)
      if (rows.length < 2) {
        toast.error('Nothing to import', 'The file needs a header row and at least one data row.')
        return
      }
      setTable(rows)
      setFileName(f.name)
      const m: Record<string, string> = {}
      for (const fld of fields) {
        const idx = rows[0].findIndex((h) => h.trim().toLowerCase() === fld.label.toLowerCase() || h.trim().toLowerCase() === fld.name.toLowerCase())
        m[fld.id] = idx >= 0 ? String(idx) : SKIP
      }
      setMapping(m)
    } catch {
      toast.error('Could not read file', 'Use a .csv, .xlsx or .xls file.')
    } finally {
      setBusy(false)
    }
  }

  const preview = useMemo(() => {
    if (!table) return null
    const targetCache = new Map<string, ReturnType<typeof useRecords>>()
    const rows: Row[] = []
    const seen = new Map<string, Set<string>>()
    table.slice(1).forEach((cells, i) => {
      const data: Record<string, unknown> = {}
      const errors: string[] = []
      for (const f of fields) {
        const col = mapping[f.id]
        if (col === SKIP || col === undefined) continue
        const raw = cells[Number(col)] ?? ''
        const targets = f.relation ? (targetCache.get(f.relation.moduleId) ?? existing.filter((r) => r.moduleId === f.relation!.moduleId)) : []
        if (f.relation) targetCache.set(f.relation.moduleId, targets)
        const p = parseImportValue(f, raw, ctx, targets)
        if (p.error) errors.push(`${f.label}: ${p.error}`)
        else if (p.value !== undefined) data[f.id] = p.value
      }
      const errs = validateRecordData(module, { ...defaults(module.fields), ...data }, { existing })
      for (const [k, msg] of Object.entries(errs)) errors.push(`${module.fields.find((f) => f.id === k)?.label ?? k}: ${msg}`)
      // duplicates inside the file for unique fields
      for (const f of module.fields) {
        if (!f.unique || data[f.id] === undefined) continue
        const set = seen.get(f.id) ?? new Set<string>()
        const key = String(data[f.id]).toLowerCase()
        if (set.has(key)) errors.push(`${f.label}: duplicate value "${data[f.id]}" inside the file`)
        set.add(key)
        seen.set(f.id, set)
      }
      rows.push({ n: i + 2, data, errors })
    })
    return rows
  }, [table, mapping, fields, ctx, existing, module])

  const valid = preview?.filter((r) => r.errors.length === 0) ?? []
  const invalid = preview?.filter((r) => r.errors.length > 0) ?? []
  const mappedCount = Object.values(mapping).filter((v) => v !== SKIP).length

  const run = () => {
    setBusy(true)
    const failed: Row[] = [...invalid]
    let ok = 0
    for (const r of valid) {
      const res = useRecordStore.getState().create(module.id, r.data, { validate: true, source: undefined })
      if (res.record) ok++
      else failed.push({ ...r, errors: Object.values(res.errors) })
    }
    logActivity({ workspaceId: module.workspaceId, action: 'records_imported', entity: 'module', moduleId: module.id, description: `Imported ${ok} record(s) into ${module.name} from ${fileName}${failed.length ? ` (${failed.length} failed)` : ''}` })
    setBusy(false)
    setDone({ ok, failed })
    if (ok) toast.success(`Imported ${ok} record${ok === 1 ? '' : 's'}`)
  }

  const downloadFailed = (rows: Row[]) => {
    if (!table) return
    const out = [[...table[0], 'Import error'], ...rows.map((r) => [...(table[r.n - 1] ?? []), r.errors.join(' | ')])]
    downloadText(toCsv(out), `${safeFileName(module.name)}-failed-rows-${format(new Date(), 'yyyyMMdd-HHmm')}.csv`, 'text/csv')
  }

  return (
    <Modal open={open} onClose={close} size="lg" title={`Import into ${module.name}`} description="CSV or Excel files with a header row. Rows are validated before anything is saved."
      footer={done ? <Button variant="primary" onClick={close}>Close</Button> : <>
        <Button onClick={close}>Cancel</Button>
        {table && <Button onClick={reset}>Choose another file</Button>}
        {table && <Button variant="primary" disabled={!valid.length || busy || !mappedCount} onClick={run}>{busy ? 'Importing…' : `Import ${valid.length} valid row${valid.length === 1 ? '' : 's'}`}</Button>}
      </>}>
      {!table && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><FileSpreadsheet size={22} /></div>
          <p className="text-sm font-medium">Choose a CSV or Excel file</p>
          <p className="mt-1 text-xs text-muted">Next you’ll map columns to fields and preview any problems.</p>
          <input ref={ref} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" aria-label="Import file" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button className="mt-4" variant="primary" onClick={() => ref.current?.click()} disabled={busy}>{busy ? <Spinner size={14} /> : <Upload size={14} />} Select file</Button>
        </div>
      )}

      {table && !done && preview && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-[13px]"><FileSpreadsheet size={15} className="text-primary" /> <strong>{fileName}</strong> · {table.length - 1} rows · {header.length} columns</div>
          <section>
            <h4 className="mb-2 text-sm font-semibold">1. Map columns to fields</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <label key={f.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                  <span className="w-32 shrink-0 truncate font-medium">{f.label}{f.required && <span className="text-danger">*</span>}</span>
                  <Select aria-label={`Column for ${f.label}`} className="h-8 text-[13px]" value={mapping[f.id] ?? SKIP} onChange={(e) => setMapping((m) => ({ ...m, [f.id]: e.target.value }))}>
                    <option value={SKIP}>— Don’t import —</option>
                    {header.map((h, i) => <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>)}
                  </Select>
                </label>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-2 text-sm font-semibold">2. Validation</h4>
            <div className="flex flex-wrap gap-3">
              <Notice tone="success"><span className="flex items-center gap-1.5"><CheckCircle2 size={14} /> {valid.length} rows ready to import</span></Notice>
              {invalid.length > 0 && <Notice tone="danger"><span className="flex items-center gap-1.5"><AlertTriangle size={14} /> {invalid.length} rows have problems and will be skipped</span></Notice>}
            </div>
            {invalid.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-line">
                <div className="flex items-center justify-between bg-subtle px-3 py-1.5 text-xs font-semibold"><span>Failed rows</span><Button size="xs" onClick={() => downloadFailed(invalid)}>Download failed rows (CSV)</Button></div>
                <ul className="scroll-thin max-h-44 divide-y divide-line overflow-y-auto text-xs">
                  {invalid.slice(0, 100).map((r) => <li key={r.n} className="px-3 py-1.5"><strong>Row {r.n}:</strong> {r.errors.join('; ')}</li>)}
                </ul>
              </div>
            )}
          </section>
          {valid.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold">Preview (first 5 valid rows)</h4>
              <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-subtle"><tr>{fields.filter((f) => mapping[f.id] !== SKIP).map((f) => <th key={f.id} className="px-2 py-1.5 text-left font-semibold">{f.label}</th>)}</tr></thead>
                  <tbody>{valid.slice(0, 5).map((r) => <tr key={r.n} className="border-t border-line">{fields.filter((f) => mapping[f.id] !== SKIP).map((f) => <td key={f.id} className="max-w-[160px] truncate px-2 py-1.5">{previewCell(f, r.data[f.id])}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {done && (
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-success/15 text-success"><CheckCircle2 size={24} /></div>
          <h3 className="text-base font-semibold">Import finished</h3>
          <p className="text-sm text-muted">{done.ok} record{done.ok === 1 ? '' : 's'} imported · {done.failed.length} row{done.failed.length === 1 ? '' : 's'} failed</p>
          {done.failed.length > 0 && <Button onClick={() => downloadFailed(done.failed)}>Download failed-row report (CSV)</Button>}
        </div>
      )}
    </Modal>
  )
}

function defaults(fields: Field[]): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  for (const f of fields) d[f.id] = defaultValueFor(f)
  return d
}

function previewCell(f: Field, v: unknown): string {
  if (v === undefined || v === null) return ''
  if (f.options) return f.options.find((o) => o.id === v)?.label ?? (Array.isArray(v) ? v.join(', ') : String(v))
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
