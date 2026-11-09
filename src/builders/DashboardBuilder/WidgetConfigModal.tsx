import { useEffect, useState } from 'react'
import type { Agg, DateRange, Widget } from '#/types'
import { useAllModules } from '#/hooks/useData'
import { AGG_LABELS, RANGE_LABELS, WIDGET_TYPES } from '#/utils/metrics'
import { isDateType, isNumericType } from '#/utils/fieldTypes'
import { META_FIELDS } from '#/utils/records'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Field, Input, Select } from '#/components/ui/controls'
import { Segmented } from '#/components/ui/misc'
import { FilterEditor } from '#/components/records/FilterEditor'

const SIZE_W = [1, 2, 3, 4] as const
const SIZE_H = [1, 2, 3] as const

export function WidgetConfigModal({ widget, onClose, onSave }: { widget: Widget; onClose: () => void; onSave: (w: Widget) => void }) {
  const modules = useAllModules().filter((m) => !m.archived)
  const [w, setW] = useState<Widget>(widget)
  useEffect(() => setW(widget), [widget])
  const set = (p: Partial<Widget>) => setW((x) => ({ ...x, ...p }))
  const module = modules.find((m) => m.id === w.moduleId)
  const type = w.type
  const usesModule = type !== 'recentActivities'
  const numeric = module?.fields.filter((f) => isNumericType(f.type)) ?? []
  const groupable = [...(module?.fields.filter((f) => !['password', 'file', 'image', 'document', 'signature', 'longText', 'address', 'formula'].includes(f.type)) ?? []), ...META_FIELDS]
  const dates = [...(module?.fields.filter((f) => isDateType(f.type)) ?? []), ...META_FIELDS]
  const chart = ['bar', 'line', 'pie', 'pipeline'].includes(type)
  const aggregated = ['stat', 'metric', 'progress', 'bar', 'line', 'pie', 'pipeline', 'revenue'].includes(type)
  const listy = ['table', 'recentRecords', 'recentActivities', 'tasks'].includes(type)
  const filterable = usesModule && type !== 'tasks'
  const needsFieldForAgg = aggregated && w.agg !== 'count'

  const save = () => onSave({ ...w, title: w.title.trim() || WIDGET_TYPES.find((t) => t.type === type)?.label || 'Widget' })

  return (
    <Modal open onClose={onClose} size="lg" title="Widget settings" description={WIDGET_TYPES.find((t) => t.type === type)?.hint} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Apply</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><Input value={w.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Widget type">
          <Select value={type} onChange={(e) => set({ type: e.target.value as Widget['type'] })}>{WIDGET_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select>
        </Field>
        {usesModule && (
          <Field label="Source module">
            <Select value={w.moduleId ?? ''} onChange={(e) => set({ moduleId: e.target.value || undefined, fieldId: undefined, groupBy: undefined, dateField: undefined, filters: [] })}>
              <option value="">{type === 'tasks' ? 'Tasks (default)' : 'Choose a module…'}</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        )}
        {aggregated && (
          <Field label="Calculation">
            <Select value={w.agg} onChange={(e) => set({ agg: e.target.value as Agg })}>{(Object.keys(AGG_LABELS) as Agg[]).map((a) => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}</Select>
          </Field>
        )}
        {(needsFieldForAgg || type === 'revenue') && (
          <Field label={type === 'revenue' ? 'Amount field' : 'Field to calculate'} error={module && numeric.length === 0 ? 'This module has no numeric field.' : undefined}>
            <Select value={w.fieldId ?? ''} onChange={(e) => set({ fieldId: e.target.value || undefined })}><option value="">Choose a field…</option>{numeric.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
          </Field>
        )}
        {chart && (
          <Field label={type === 'pipeline' ? 'Stage field' : 'Group by'}>
            <Select value={w.groupBy ?? ''} onChange={(e) => set({ groupBy: e.target.value || undefined })}><option value="">{type === 'pipeline' ? 'First dropdown field' : 'No grouping'}</option>{groupable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
          </Field>
        )}
        {(type === 'progress') && <Field label="Target"><Input type="number" min={1} value={w.target ?? ''} onChange={(e) => set({ target: Number(e.target.value) || undefined })} /></Field>}
        {(usesModule && type !== 'tasks') && (
          <>
            <Field label="Date range"><Select value={w.dateRange} onChange={(e) => set({ dateRange: e.target.value as DateRange })}>{(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}</Select></Field>
            <Field label={type === 'calendar' ? 'Date field to plot' : 'Date field for range'}><Select value={w.dateField ?? ''} onChange={(e) => set({ dateField: e.target.value || undefined })}><option value="">{type === 'calendar' ? 'First date field' : 'Created date'}</option>{dates.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
          </>
        )}
        {listy && <Field label="Rows to show"><Input type="number" min={1} max={30} value={w.limit ?? 8} onChange={(e) => set({ limit: Math.max(1, Math.min(30, Number(e.target.value) || 8)) })} /></Field>}
        <Field label="Width (columns)"><Segmented<string> value={String(w.w)} onChange={(v) => set({ w: Number(v) as Widget['w'] })} options={SIZE_W.map((n) => ({ id: String(n), label: String(n) }))} /></Field>
        <Field label="Height (rows)"><Segmented<string> value={String(w.h)} onChange={(v) => set({ h: Number(v) as Widget['h'] })} options={SIZE_H.map((n) => ({ id: String(n), label: String(n) }))} /></Field>
        {filterable && module && (
          <div className="sm:col-span-2">
            <div className="mb-1 text-[13px] font-medium">Filters</div>
            <div className="rounded-lg border border-line p-2"><FilterEditor module={module} filters={w.filters} onChange={(filters) => set({ filters })} /></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
