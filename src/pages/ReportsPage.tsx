import { useMemo, useState } from 'react'
import { useAllModules, useCtx, useDashboards, usePerms, useRecords } from '#/hooks/useData'
import { useDashboardStore } from '#/stores/collections'
import { useUiStore } from '#/stores/uiStore'
import { AGG_LABELS, RANGE_LABELS, aggregate, defaultWidget, formatNumber, scopedRecords, series } from '#/utils/metrics'
import { applySorts, displayValue, findField, META_FIELDS, recordTitle, valueOf } from '#/utils/records'
import { isDateType, isNumericType } from '#/utils/fieldTypes'
import { recordsToTable, tableToXlsxBlob, toCsv } from '#/utils/csv'
import { downloadBlob, downloadText, safeFileName } from '#/utils/download'
import { uid } from '#/utils/id'
import { toast } from '#/utils/toast'
import type { Agg, DateRange, Filter, Widget } from '#/types'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Card, EmptyState, PageHeader, Segmented } from '#/components/ui/misc'
import { Field, Select } from '#/components/ui/controls'
import { FilterEditor } from '#/components/records/FilterEditor'
import { WidgetView } from '#/components/dashboard/WidgetView'

type Kind = 'summary' | 'detail'

export function ReportsPage() {
  const modules = useAllModules().filter((m) => !m.archived && !m.system)
  const perms = usePerms()
  const ctx = useCtx()
  const dashboards = useDashboards()
  const showRecord = useUiStore((s) => s.showRecord)
  const [moduleId, setModuleId] = useState<string>('')
  const module = modules.find((m) => m.id === moduleId) ?? modules[0]
  const allRecords = useRecords()
  const [kind, setKind] = useState<Kind>('summary')
  const [groupBy, setGroupBy] = useState('')
  const [agg, setAgg] = useState<Agg>('count')
  const [fieldId, setFieldId] = useState('')
  const [range, setRange] = useState<DateRange>('all')
  const [dateField, setDateField] = useState('')
  const [filters, setFilters] = useState<Filter[]>([])
  const [sortField, setSortField] = useState('')
  const [adding, setAdding] = useState(false)
  const [targetDash, setTargetDash] = useState('')

  const widget: Widget = useMemo(() => ({ ...defaultWidget('bar', module?.id, 'report'), agg, fieldId: fieldId || undefined, groupBy: groupBy || undefined, dateRange: range, dateField: dateField || undefined, filters }), [module?.id, agg, fieldId, groupBy, range, dateField, filters])

  const scoped = useMemo(() => (module ? scopedRecords(widget, modules, allRecords, ctx) : { records: [] }), [widget, modules, allRecords, ctx, module])
  const points = useMemo(() => (module && kind === 'summary' ? series(widget, module, scoped.records, ctx) : []), [widget, module, scoped.records, ctx, kind])
  const detail = useMemo(() => (module && kind === 'detail' ? applySorts(module, scoped.records, sortField ? [{ id: 's', fieldId: sortField, dir: 'asc' }] : [{ id: 's', fieldId: '__createdAt', dir: 'desc' }], ctx) : []), [module, scoped.records, sortField, ctx, kind])
  const numeric = module?.fields.filter((f) => isNumericType(f.type)) ?? []
  const groupable = [...(module?.fields.filter((f) => !['password', 'file', 'image', 'document', 'signature', 'longText', 'address', 'formula'].includes(f.type)) ?? []), ...META_FIELDS]
  const dates = [...(module?.fields.filter((f) => isDateType(f.type)) ?? []), ...META_FIELDS]
  const total = module ? aggregate(module, scoped.records, agg, fieldId || undefined, ctx) : 0
  const valueField = module && fieldId ? findField(module, fieldId) : undefined
  const currency = valueField?.type === 'currency' ? (valueField.currency ?? 'USD') : undefined

  const exportable = (): string[][] => {
    if (!module) return []
    if (kind === 'detail') return recordsToTable(module, detail, ctx)
    return [[groupBy ? (findField(module, groupBy)?.label ?? 'Group') : 'Group', 'Records', agg === 'count' ? 'Count' : `${AGG_LABELS[agg]} of ${valueField?.label ?? ''}`], ...points.map((p) => [p.name, String(p.count), String(Math.round(p.value * 100) / 100)])]
  }
  const name = module ? `${module.name} ${kind} report` : 'report'
  const exp = async (type: 'csv' | 'xlsx') => {
    if (!perms.can('exportData')) return toast.error('Your role cannot export data')
    const rows = exportable()
    if (rows.length < 2) return toast.info('Nothing to export', 'The report is empty.')
    if (type === 'csv') downloadText(toCsv(rows), `${safeFileName(name)}.csv`, 'text/csv')
    else downloadBlob(await tableToXlsxBlob([{ name: 'Report', rows }]), `${safeFileName(name)}.xlsx`)
    toast.success('Report exported')
  }
  const addToDashboard = () => {
    const d = dashboards.find((x) => x.id === targetDash) ?? dashboards[0]
    if (!d || !module) return
    const w: Widget = { ...widget, id: uid('w'), type: kind === 'detail' ? 'table' : groupBy ? 'bar' : 'stat', title: name.replace(/^./, (c) => c.toUpperCase()), w: 2, h: 2 }
    useDashboardStore.getState().update(d.id, { widgets: [...d.widgets, w] })
    setAdding(false)
    toast.success('Added to dashboard', d.name)
  }

  return (
    <Page title="Reports" wide skeleton="table">
      <PageHeader title="Reports" icon="FileBarChart" description="Build summary or detail reports from any module, then export them or pin them to a dashboard."
        actions={module && <><Button icon="Download" onClick={() => void exp('csv')}>CSV</Button><Button icon="Download" onClick={() => void exp('xlsx')}>Excel</Button>{dashboards.length > 0 && perms.can('manageDashboards') && <Button variant="primary" icon="PieChart" onClick={() => { setTargetDash(dashboards[0].id); setAdding(true) }}>Add to dashboard</Button>}</>} />
      {!module ? <EmptyState icon="FileBarChart" title="No modules to report on" description="Create a module and add some records first." /> : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <Card className="space-y-3 p-4">
            <Segmented<Kind> value={kind} onChange={setKind} options={[{ id: 'summary', label: 'Summary', icon: 'BarChart3' }, { id: 'detail', label: 'Detail', icon: 'Table2' }]} />
            <Field label="Module"><Select value={module.id} onChange={(e) => { setModuleId(e.target.value); setGroupBy(''); setFieldId(''); setDateField(''); setFilters([]); setSortField('') }}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            {kind === 'summary' && (
              <>
                <Field label="Group by"><Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="">No grouping (total)</option>{groupable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
                <Field label="Calculation"><Select value={agg} onChange={(e) => setAgg(e.target.value as Agg)}>{(Object.keys(AGG_LABELS) as Agg[]).map((a) => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}</Select></Field>
                {agg !== 'count' && <Field label="Of field"><Select value={fieldId} onChange={(e) => setFieldId(e.target.value)}><option value="">Choose a numeric field…</option>{numeric.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>}
              </>
            )}
            {kind === 'detail' && <Field label="Sort by (A→Z)"><Select value={sortField} onChange={(e) => setSortField(e.target.value)}><option value="">Newest first</option>{groupable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>}
            <Field label="Date range"><Select value={range} onChange={(e) => setRange(e.target.value as DateRange)}>{(Object.keys(RANGE_LABELS) as DateRange[]).map((r) => <option key={r} value={r}>{RANGE_LABELS[r]}</option>)}</Select></Field>
            {range !== 'all' && <Field label="Date field"><Select value={dateField} onChange={(e) => setDateField(e.target.value)}><option value="">Created date</option>{dates.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>}
            <div><div className="mb-1 text-[13px] font-medium">Filters</div><div className="rounded-lg border border-line p-2"><FilterEditor module={module} filters={filters} onChange={setFilters} /></div></div>
          </Card>
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Card className="p-4"><div className="text-xs text-muted">Records in report</div><div className="text-2xl font-bold tabular-nums">{scoped.records.length}</div></Card>
              {kind === 'summary' && <Card className="p-4"><div className="text-xs text-muted">{agg === 'count' ? 'Total count' : `${AGG_LABELS[agg]} of ${valueField?.label ?? '…'}`}</div><div className="text-2xl font-bold tabular-nums">{formatNumber(total, currency)}</div></Card>}
              {kind === 'summary' && <Card className="p-4"><div className="text-xs text-muted">Groups</div><div className="text-2xl font-bold tabular-nums">{groupBy ? points.length : 1}</div></Card>}
            </div>
            {scoped.records.length === 0 ? <EmptyState icon="SearchX" title="No records match" description="Loosen the filters or widen the date range." /> : kind === 'summary' ? (
              <>
                {groupBy && <Card className="h-72 p-4"><WidgetView w={{ ...widget, type: 'bar' }} /></Card>}
                <div className="overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-[13px]">
                    <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">{groupBy ? findField(module, groupBy)?.label : 'Group'}</th><th className="px-3 py-2 text-right">Records</th><th className="px-3 py-2 text-right">{agg === 'count' ? 'Count' : AGG_LABELS[agg]}</th></tr></thead>
                    <tbody>{points.map((p) => <tr key={p.key} className="border-t border-line"><td className="px-3 py-2">{p.name}</td><td className="px-3 py-2 text-right tabular-nums">{p.count}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(p.value, currency)}</td></tr>)}</tbody>
                    <tfoot className="border-t border-line bg-subtle/50 font-semibold"><tr><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tabular-nums">{scoped.records.length}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(total, currency)}</td></tr></tfoot>
                  </table>
                </div>
              </>
            ) : (
              <div className="scroll-thin max-h-[60vh] overflow-auto rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-subtle text-xs text-muted"><tr>{module.fields.slice(0, 7).map((f) => <th key={f.id} className="px-3 py-2 text-left whitespace-nowrap">{f.label}</th>)}</tr></thead>
                  <tbody>{detail.slice(0, 500).map((r) => <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-subtle" onClick={() => showRecord(module.id, r.id)} title={recordTitle(module, r, ctx)}>{module.fields.slice(0, 7).map((f) => <td key={f.id} className="max-w-[200px] truncate px-3 py-2">{displayValue(f, valueOf(module, r, f, ctx), ctx) || '—'}</td>)}</tr>)}</tbody>
                </table>
                {detail.length > 500 && <p className="p-3 text-xs text-muted">Showing the first 500 of {detail.length}. Exports include every row.</p>}
              </div>
            )}
          </div>
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add to dashboard" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" onClick={addToDashboard}>Add widget</Button></>}>
        <Field label="Dashboard"><Select value={targetDash} onChange={(e) => setTargetDash(e.target.value)}>{dashboards.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      </Modal>
    </Page>
  )
}
