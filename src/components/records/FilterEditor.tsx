import { Plus, Trash2 } from 'lucide-react'
import type { Field, Filter, FilterOp, Module, SortRule } from '#/types'
import { fieldsWithMeta } from '#/utils/records'
import { OPERATORS, isDateType, isNumericType } from '#/utils/fieldTypes'
import { uid } from '#/utils/id'
import { useUsers } from '#/hooks/useData'
import { Input, Select } from '#/components/ui/controls'
import { Button } from '#/components/ui/Button'

export function FilterValueInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  const users = useUsers()
  if (field.options?.length && ['dropdown', 'radio', 'multiSelect', 'checkboxes'].includes(field.type)) {
    return (
      <Select aria-label="Filter value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
        <option value="">Choose…</option>
        {field.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
    )
  }
  if (field.type === 'yesNo') {
    return (
      <Select aria-label="Filter value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
        <option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option>
      </Select>
    )
  }
  if (field.type === 'user') {
    return (
      <Select aria-label="Filter value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]">
        <option value="">Choose…</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
    )
  }
  if (isNumericType(field.type)) return <Input aria-label="Filter value" type="number" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]" />
  if (isDateType(field.type) || field.id.startsWith('__')) return <Input aria-label="Filter value" type="date" value={String(value ?? '').slice(0, 10)} onChange={(e) => onChange(e.target.value)} className="h-8 text-[13px]" />
  return <Input aria-label="Filter value" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Value" className="h-8 text-[13px]" />
}

export function FilterEditor({ module, filters, onChange }: { module: Module; filters: Filter[]; onChange: (f: Filter[]) => void }) {
  const fields = fieldsWithMeta(module).filter((f) => f.type !== 'password')
  const update = (id: string, patch: Partial<Filter>) => onChange(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  return (
    <div className="w-[min(92vw,520px)] space-y-2 p-2">
      {filters.length === 0 && <p className="px-1 py-2 text-[13px] text-muted">No filters yet. Records matching <strong>all</strong> filters are shown.</p>}
      {filters.map((f) => {
        const field = fields.find((x) => x.id === f.fieldId)
        const op = OPERATORS.find((o) => o.op === f.op)
        return (
          <div key={f.id} className="grid grid-cols-[1fr_1fr_1.2fr_auto] items-center gap-1.5">
            <Select aria-label="Filter field" value={f.fieldId} onChange={(e) => update(f.id, { fieldId: e.target.value, value: undefined })} className="h-8 text-[13px]">
              {fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </Select>
            <Select aria-label="Filter operator" value={f.op} onChange={(e) => update(f.id, { op: e.target.value as FilterOp })} className="h-8 text-[13px]">
              {OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
            </Select>
            {field && op?.needsValue ? <FilterValueInput field={field} value={f.value} onChange={(v) => update(f.id, { value: v })} /> : <span />}
            <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((x) => x.id !== f.id))} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
          </div>
        )
      })}
      <div className="flex items-center justify-between pt-1">
        <Button size="xs" variant="soft" onClick={() => onChange([...filters, { id: uid('flt'), fieldId: fields[0]?.id ?? '', op: 'contains', value: '' }])}><Plus size={12} /> Add filter</Button>
        {filters.length > 0 && <Button size="xs" variant="ghost" onClick={() => onChange([])}>Clear all</Button>}
      </div>
    </div>
  )
}

export function SortEditor({ module, sorts, onChange }: { module: Module; sorts: SortRule[]; onChange: (s: SortRule[]) => void }) {
  const fields = fieldsWithMeta(module).filter((f) => f.type !== 'password')
  const update = (id: string, patch: Partial<SortRule>) => onChange(sorts.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  return (
    <div className="w-[min(92vw,360px)] space-y-2 p-2">
      {sorts.length === 0 && <p className="px-1 py-2 text-[13px] text-muted">Records are shown in creation order.</p>}
      {sorts.map((s) => (
        <div key={s.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-1.5">
          <Select aria-label="Sort field" value={s.fieldId} onChange={(e) => update(s.id, { fieldId: e.target.value })} className="h-8 text-[13px]">
            {fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </Select>
          <Select aria-label="Direction" value={s.dir} onChange={(e) => update(s.id, { dir: e.target.value as 'asc' | 'desc' })} className="h-8 w-28 text-[13px]">
            <option value="asc">Ascending</option><option value="desc">Descending</option>
          </Select>
          <button type="button" aria-label="Remove sort" onClick={() => onChange(sorts.filter((x) => x.id !== s.id))} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
      <Button size="xs" variant="soft" onClick={() => onChange([...sorts, { id: uid('srt'), fieldId: fields[0]?.id ?? '', dir: 'asc' }])}><Plus size={12} /> Add sort</Button>
    </div>
  )
}
