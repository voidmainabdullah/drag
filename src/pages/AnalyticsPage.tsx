import { useMemo, useState } from 'react'
import { addDays, format, startOfDay, subDays } from 'date-fns'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { useActivities, useAllModules, useRecords, useWorkflows, useWsId } from '#/hooks/useData'
import { useRunStore } from '#/stores/collections'
import { storageUsage } from '#/services/storage/storageService'
import { isEmpty, formatBytes, OPTION_COLORS } from '#/utils/fieldTypes'
import { safeDate } from '#/utils/records'
import { Page } from '#/components/layout/Page'
import { Card, EmptyState, PageHeader, Segmented } from '#/components/ui/misc'
import { Select } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'

const tick = { fontSize: 11, fill: 'var(--muted)' }
const tip = { contentStyle: { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 } }

function Kpi({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: string; color: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between"><span className="text-[13px] text-muted">{label}</span><span className="flex size-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}><Icon name={icon} size={16} /></span></div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  )
}

export function AnalyticsPage() {
  const ws = useWsId()
  const modules = useAllModules().filter((m) => !m.archived)
  const records = useRecords()
  const acts = useActivities()
  const workflows = useWorkflows()
  const runs = useRunStore((s) => s.runs)
  const [days, setDays] = useState<'14' | '30' | '90'>('30')
  const [qualityId, setQualityId] = useState('')

  const real = modules.filter((m) => !m.system)
  const tasksMod = modules.find((m) => m.system === 'tasks')
  const mine = useMemo(() => records.filter((r) => modules.some((m) => m.id === r.moduleId)), [records, modules])

  const perModule = useMemo(() => real.map((m) => ({ name: m.name, value: mine.filter((r) => r.moduleId === m.id).length, color: m.color })).sort((a, b) => b.value - a.value), [real, mine])
  const n = Number(days)
  const timeline = useMemo(() => {
    const start = startOfDay(subDays(new Date(), n - 1))
    const buckets = Array.from({ length: n }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
    const map = new Map(buckets.map((b) => [b, 0]))
    for (const r of mine) {
      if (tasksMod && r.moduleId === tasksMod.id) continue
      const k = format(new Date(r.createdAt), 'yyyy-MM-dd')
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1)
    }
    return buckets.map((b) => ({ name: format(new Date(`${b}T00:00:00`), 'MMM d'), value: map.get(b) ?? 0 }))
  }, [mine, n, tasksMod])
  const createdInRange = timeline.reduce((a, b) => a + b.value, 0)

  const tasks = tasksMod ? mine.filter((r) => r.moduleId === tasksMod.id) : []
  const openTasks = tasks.filter((t) => t.data.status !== 'done')
  const today = startOfDay(new Date())
  const overdue = openTasks.filter((t) => { const d = safeDate(t.data.due); return d && d < today }).length

  const wsRuns = runs.filter((r) => r.workspaceId === ws)
  const success = wsRuns.filter((r) => r.status === 'success').length
  const actByAction = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of acts) m.set(a.entity, (m.get(a.entity) ?? 0) + 1)
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [acts])

  const qm = real.find((m) => m.id === qualityId) ?? real[0]
  const quality = useMemo(() => {
    if (!qm) return []
    const rs = mine.filter((r) => r.moduleId === qm.id && !r.deletedAt)
    return qm.fields.filter((f) => f.type !== 'formula' && f.type !== 'autoId').map((f) => ({ label: f.label, required: !!f.required, pct: rs.length ? Math.round((rs.filter((r) => !isEmpty(r.data[f.id]) && r.data[f.id] !== false).length / rs.length) * 100) : 0 }))
  }, [qm, mine])
  const usage = storageUsage()

  return (
    <Page title="Data Analytics" skeleton="cards">
      <PageHeader title="Data Analytics" icon="LineChart" description="A live health check of your workspace: growth, activity, data completeness and storage." />
      {real.length === 0 ? <EmptyState icon="LineChart" title="Nothing to analyse yet" description="Create modules and records, then come back for insights." /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Total records" value={mine.filter((r) => !r.deletedAt && (!tasksMod || r.moduleId !== tasksMod.id)).length} sub={`${createdInRange} created in last ${days} days`} icon="Database" color="#7B68EE" />
            <Kpi label="Open tasks" value={openTasks.length} sub={overdue ? `${overdue} overdue` : 'None overdue'} icon="CheckSquare" color={overdue ? '#EF4444' : '#2DB67D'} />
            <Kpi label="Workflow success" value={wsRuns.length ? `${Math.round((success / wsRuns.length) * 100)}%` : '—'} sub={`${wsRuns.length} runs · ${workflows.filter((w) => w.enabled).length} active`} icon="Workflow" color="#FD71AF" />
            <Kpi label="Local storage" value={formatBytes(usage.bytes)} sub="of ~5 MB browser limit (files separate)" icon="HardDrive" color="#F5A524" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Records created</h3><Segmented<'14' | '30' | '90'> value={days} onChange={setDays} options={[{ id: '14', label: '14d' }, { id: '30', label: '30d' }, { id: '90', label: '90d' }]} /></div>
              <div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={timeline} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} /><RTooltip {...tip} /><Line type="monotone" dataKey="value" name="Records" stroke="var(--primary)" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div>
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Records by module</h3>
              <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={perModule} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" horizontal={false} /><XAxis type="number" tick={tick} tickLine={false} axisLine={false} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={false} width={92} /><RTooltip {...tip} cursor={{ fill: 'var(--subtle)' }} /><Bar dataKey="value" name="Records" radius={[0, 6, 6, 0]}>{perModule.map((p, i) => <Cell key={p.name} fill={p.color || OPTION_COLORS[i % OPTION_COLORS.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
            </Card>
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Data completeness</h3><Select aria-label="Module" className="h-8 w-44" value={qm?.id ?? ''} onChange={(e) => setQualityId(e.target.value)}>{real.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
              {quality.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No fields to measure.</p> : (
                <ul className="space-y-2.5">{quality.map((q) => (
                  <li key={q.label}>
                    <div className="mb-0.5 flex justify-between text-xs"><span className="font-medium">{q.label}{q.required && <span className="ml-1 text-danger">*</span>}</span><span className="text-muted tabular-nums">{q.pct}% filled</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full" style={{ width: `${q.pct}%`, background: q.pct >= 80 ? '#2DB67D' : q.pct >= 40 ? '#F5A524' : '#EF4444' }} /></div>
                  </li>
                ))}</ul>
              )}
            </Card>
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Activity by type</h3>
              {actByAction.length === 0 ? <p className="py-8 text-center text-[13px] text-muted">No activity logged yet.</p> : (
                <div className="h-60"><ResponsiveContainer width="100%" height="100%"><BarChart data={actByAction} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={tick} tickLine={false} axisLine={false} /><YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} /><RTooltip {...tip} cursor={{ fill: 'var(--subtle)' }} /><Bar dataKey="value" name="Events" fill="var(--accent)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
              )}
            </Card>
          </div>
        </div>
      )}
    </Page>
  )
}
