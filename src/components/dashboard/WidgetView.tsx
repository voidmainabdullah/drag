import { memo, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import type { Widget } from '#/types'
import { useActivities, useAllModules, useCtx, useCurrentUser, usePerms, useRecords } from '#/hooks/useData'
import { computeWidgetData, formatNumber, type Point } from '#/utils/metrics'
import { displayValue, findField, recordTitle, safeDate, valueOf } from '#/utils/records'
import { OPTION_COLORS } from '#/utils/fieldTypes'
import { useUiStore } from '#/stores/uiStore'
import { useRecordStore } from '#/stores/recordStore'
import { toast } from '#/utils/toast'
import { MonthGrid, type CalItem } from '#/components/records/MonthGrid'

const palette = (i: number, c?: string) => c ?? OPTION_COLORS[i % OPTION_COLORS.length]
const rowH = 150

export const widgetHeight = (h: number) => h * rowH + (h - 1) * 16

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center px-4 text-center text-[13px] text-muted">{text}</div>
}

function Charts({ w, points, currency }: { w: Widget; points: Point[]; currency?: string }) {
  if (!points.length || points.every((p) => p.value === 0 && p.count === 0)) return <Empty text="No data for this chart yet." />
  const tick = { fontSize: 11, fill: 'var(--muted)' }
  const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }, formatter: (v: unknown) => formatNumber(Number(v), currency) }
  if (w.type === 'pie') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={points} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="80%" paddingAngle={2} stroke="none">{points.map((p, i) => <Cell key={p.key} fill={palette(i, p.color)} />)}</Pie>
          <RTooltip {...tip} />
        </PieChart>
      </ResponsiveContainer>
    )
  }
  if (w.type === 'line' || w.type === 'revenue') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatNumber(Number(v))} />
          <RTooltip {...tip} />
          <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={points} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} interval={0} height={36} tickFormatter={(v: string) => (v.length > 10 ? `${v.slice(0, 9)}…` : v)} />
        <YAxis tick={tick} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatNumber(Number(v))} allowDecimals={false} />
        <RTooltip {...tip} cursor={{ fill: 'var(--subtle)' }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>{points.map((p, i) => <Cell key={p.key} fill={palette(i, p.color)} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function WidgetBody({ w }: { w: Widget }) {
  const modules = useAllModules()
  const records = useRecords()
  const ctx = useCtx()
  const activities = useActivities()
  const showRecord = useUiStore((s) => s.showRecord)
  const effective = useMemo(() => {
    if (w.type === 'tasks' && !w.moduleId) return { ...w, moduleId: modules.find((m) => m.system === 'tasks')?.id }
    return w
  }, [w, modules])
  const user = useCurrentUser()
  const { role } = usePerms()
  const actor = useMemo(() => ({ userId: user?.id ?? '', role }), [user, role])
  const data = useMemo(() => computeWidgetData(effective, modules, records, ctx, new Date(), actor), [effective, modules, records, ctx, actor])
  const module = modules.find((m) => m.id === effective.moduleId)
  const valueField = w.fieldId && module ? findField(module, w.fieldId) : undefined
  const currency = valueField?.type === 'currency' ? (valueField.currency ?? 'USD') : undefined

  if (w.type === 'recentActivities') {
    const list = activities.slice(0, w.limit ?? 8)
    if (!list.length) return <Empty text="No activity yet." />
    return (
      <ul className="scroll-thin h-full space-y-2.5 overflow-y-auto pr-1">
        {list.map((a) => <li key={a.id} className="flex gap-2 text-[13px]"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" /><div className="min-w-0"><div className="truncate">{a.description}</div><div className="text-[11px] text-muted">{formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}</div></div></li>)}
      </ul>
    )
  }
  if (data.kind === 'empty') return <Empty text={data.reason || 'Nothing to show.'} />

  switch (w.type) {
    case 'stat':
    case 'metric':
      return (
        <div className="flex h-full flex-col justify-center">
          <div className="text-3xl font-bold tracking-tight tabular-nums">{data.kind === 'value' ? formatNumber(data.value, currency) : '—'}</div>
          <div className="mt-1 text-xs text-muted">{data.kind === 'value' ? (w.agg === 'count' ? 'records' : `${w.agg} of ${valueField?.label ?? 'field'} · ${data.count} records`) : ''}</div>
        </div>
      )
    case 'progress': {
      if (data.kind !== 'value') return null
      const target = w.target ?? 0
      if (!target) return <Empty text="Set a target in the widget settings." />
      const pct = Math.min(100, Math.round((data.value / target) * 100))
      return (
        <div className="flex h-full flex-col justify-center gap-2">
          <div className="flex items-baseline justify-between"><span className="text-2xl font-bold tabular-nums">{formatNumber(data.value, currency)}</span><span className="text-xs text-muted">of {formatNumber(target, currency)}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="gradient-brand h-full rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-muted">{pct}% complete</div>
        </div>
      )
    }
    case 'bar':
    case 'line':
    case 'pie':
      return data.kind === 'series' ? <Charts w={w} points={data.points} currency={currency} /> : null
    case 'revenue':
      if (data.kind !== 'revenue') return null
      return (
        <div className="flex h-full flex-col">
          <div className="mb-1 flex items-baseline gap-3"><span className="text-2xl font-bold tabular-nums">{formatNumber(data.total, currency)}</span><span className="text-xs text-muted">avg {formatNumber(data.average, currency)} / period</span></div>
          <div className="min-h-0 flex-1"><Charts w={w} points={data.points} currency={currency} /></div>
        </div>
      )
    case 'pipeline': {
      if (data.kind !== 'series') return null
      const max = Math.max(1, ...data.points.map((p) => p.value))
      if (!data.points.length) return <Empty text="No records in the pipeline." />
      return (
        <div className="scroll-thin h-full space-y-2 overflow-y-auto pr-1">
          {data.points.map((p, i) => (
            <div key={p.key}>
              <div className="mb-0.5 flex justify-between text-xs"><span className="truncate font-medium">{p.name}</span><span className="text-muted tabular-nums">{p.count} · {formatNumber(p.value, currency)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (p.value / max) * 100)}%`, background: palette(i, p.color) }} /></div>
            </div>
          ))}
        </div>
      )
    }
    case 'table': {
      if (data.kind !== 'rows') return null
      const cols = data.module.fields.filter((f) => !['password', 'longText', 'signature', 'file', 'image', 'document'].includes(f.type)).slice(0, 4)
      if (!data.records.length) return <Empty text="No records yet." />
      return (
        <div className="scroll-thin h-full overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface text-left text-muted"><tr>{cols.map((c) => <th key={c.id} className="px-2 py-1.5 font-medium">{c.label}</th>)}</tr></thead>
            <tbody>{data.records.map((r) => <tr key={r.id} onClick={() => showRecord(data.module.id, r.id)} className="cursor-pointer border-t border-line hover:bg-subtle">{cols.map((c) => <td key={c.id} className="max-w-[140px] truncate px-2 py-1.5">{displayValue(c, valueOf(data.module, r, c, ctx), ctx) || '—'}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
    }
    case 'recentRecords': {
      if (data.kind !== 'rows') return null
      if (!data.records.length) return <Empty text="No records yet." />
      return (
        <ul className="scroll-thin h-full space-y-1 overflow-y-auto pr-1">
          {data.records.map((r) => <li key={r.id}><button type="button" onClick={() => showRecord(data.module.id, r.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"><span className="truncate font-medium">{recordTitle(data.module, r, ctx)}</span><span className="shrink-0 text-[11px] text-muted">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span></button></li>)}
        </ul>
      )
    }
    case 'tasks': {
      if (data.kind !== 'rows') return null
      const open = records.filter((r) => r.moduleId === data.module.id && !r.deletedAt && !r.archived && r.data.status !== 'done').sort((a, b) => String(a.data.due || '9999').localeCompare(String(b.data.due || '9999'))).slice(0, w.limit ?? 8)
      if (!open.length) return <Empty text="No open tasks. Nice work!" />
      return (
        <ul className="scroll-thin h-full space-y-1 overflow-y-auto pr-1">
          {open.map((r) => {
            const due = safeDate(r.data.due)
            const overdue = due && due < new Date(new Date().toDateString())
            return (
              <li key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle">
                <input type="checkbox" aria-label={`Mark ${recordTitle(data.module, r, ctx)} done`} className="size-4 accent-[var(--color-primary)]" onChange={() => { useRecordStore.getState().update(r.id, { status: 'done' }); toast.success('Task completed') }} />
                <button type="button" onClick={() => showRecord(data.module.id, r.id)} className="min-w-0 flex-1 truncate text-left text-[13px]">{recordTitle(data.module, r, ctx)}</button>
                {due && <span className={`shrink-0 text-[11px] ${overdue ? 'font-medium text-danger' : 'text-muted'}`}>{due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
              </li>
            )
          })}
        </ul>
      )
    }
    case 'calendar': {
      if (data.kind !== 'rows') return null
      const df = (w.dateField && findField(data.module, w.dateField)) || data.module.fields.find((f) => f.type === 'date' || f.type === 'datetime')
      if (!df) return <Empty text="This module has no date field to plot." />
      const items: CalItem[] = records.filter((r) => r.moduleId === data.module.id && !r.deletedAt && !r.archived).flatMap((r) => {
        const d = safeDate(valueOf(data.module, r, df, ctx))
        return d ? [{ id: r.id, date: d, label: recordTitle(data.module, r, ctx), color: data.module.color, onClick: () => showRecord(data.module.id, r.id) }] : []
      })
      return <div className="scroll-thin h-full overflow-auto"><MonthGrid items={items} /></div>
    }
  }
  return <Empty text="" />
}

export const WidgetView = memo(function WidgetView({ w }: { w: Widget }) {
  return <WidgetBody w={w} />
})
