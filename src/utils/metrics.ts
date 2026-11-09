import { format, startOfDay, subDays, startOfYear } from 'date-fns'
import type { Agg, CrmRecord, DateRange, Module, Widget } from '#/types'
import { applyFilters, findField, groupRecords, safeDate, valueOf, type Ctx } from './records'
import { D } from '#/genius/formula/decimal'
import { canModule, canSeeRecord, fieldAccess, type Actor } from '#/genius/permissions/policy'
export const AGG_LABELS: Record<Agg, string> = { count: 'Count', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }
export const RANGE_LABELS: Record<DateRange, string> = { all: 'All time', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', year: 'This year' }

export function rangeStart(range: DateRange, now = new Date()): Date | null {
  switch (range) {
    case '7d': return startOfDay(subDays(now, 6))
    case '30d': return startOfDay(subDays(now, 29))
    case '90d': return startOfDay(subDays(now, 89))
    case 'year': return startOfYear(now)
    default: return null
  }
}

/** Active records of the widget's module after filters and date range. */
export function scopedRecords(w: Widget, modules: Module[], records: CrmRecord[], ctx: Ctx, now = new Date()): { module?: Module; records: CrmRecord[] } {
  const module = modules.find((m) => m.id === w.moduleId)
  if (!module) return { records: [] }
  let list = records.filter((r) => r.moduleId === module.id && !r.deletedAt && !r.archived)
  list = applyFilters(module, list, (w.filters ?? []).filter((f) => f.fieldId), ctx)
  const start = rangeStart(w.dateRange, now)
  if (start) {
    const df = findField(module, w.dateField || '__createdAt')
    list = list.filter((r) => {
      const d = df ? safeDate(valueOf(module, r, df, ctx)) : null
      return d ? d >= start : false
    })
  }
  return { module, records: list }
}

export function numberOf(module: Module, r: CrmRecord, fieldId: string | undefined, ctx: Ctx): number | null {
  if (!fieldId) return null
  const f = findField(module, fieldId)
  if (!f) return null
  const v = valueOf(module, r, f, ctx)
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const exactSum = (nums: number[]) => nums.reduce((a, n) => a.add(D(n)), D(0))

export function aggregate(module: Module, records: CrmRecord[], agg: Agg, fieldId: string | undefined, ctx: Ctx): number {
  if (agg === 'count' || !fieldId) return records.length
  const nums = records.map((r) => numberOf(module, r, fieldId, ctx)).filter((n): n is number => n !== null)
  if (!nums.length) return 0
  switch (agg) {
    // exact decimal arithmetic: 0.1 + 0.2 is 0.3 on a money dashboard, not 0.30000000000000004
    case 'sum': return exactSum(nums).toNumber()
    case 'avg': return exactSum(nums).div(D(nums.length), 12).toNumber()
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
  return 0
}

export interface Point { key: string; name: string; value: number; color?: string; count: number }

const DATE_TYPES = new Set(['date', 'datetime'])

/** Group records by a field and aggregate each group. Date fields bucket by day (short ranges) or month. */
export function series(w: Widget, module: Module, records: CrmRecord[], ctx: Ctx): Point[] {
  const gid = w.groupBy
  const field = gid ? findField(module, gid) : undefined
  const agg = w.agg
  if (!field) return [{ key: 'all', name: 'All', value: aggregate(module, records, agg, w.fieldId, ctx), count: records.length }]
  if (DATE_TYPES.has(field.type)) {
    const byDay = w.dateRange === '7d' || w.dateRange === '30d'
    const fmt = byDay ? 'yyyy-MM-dd' : 'yyyy-MM'
    const map = new Map<string, CrmRecord[]>()
    for (const r of records) {
      const d = safeDate(valueOf(module, r, field, ctx))
      if (!d) continue
      const k = format(d, fmt)
      map.set(k, [...(map.get(k) ?? []), r])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({ key: k, name: byDay ? format(new Date(`${k}T00:00:00`), 'MMM d') : format(new Date(`${k}-01T00:00:00`), 'MMM yyyy'), value: aggregate(module, rs, agg, w.fieldId, ctx), count: rs.length }))
  }
  let groups = groupRecords(module, records, gid, ctx)
  groups = groups.filter((g) => g.records.length > 0)
  const out = groups.map((g) => ({ key: g.key, name: g.label, color: g.color, value: aggregate(module, g.records, agg, w.fieldId, ctx), count: g.records.length }))
  if (!field.options?.length) out.sort((a, b) => b.value - a.value)
  return out.slice(0, 24)
}

export function monthlyTotals(w: Widget, module: Module, records: CrmRecord[], ctx: Ctx): Point[] {
  return series({ ...w, groupBy: w.dateField || '__createdAt' }, module, records, ctx)
}

export type WidgetData =
  | { kind: 'empty'; reason: string }
  | { kind: 'value'; value: number; count: number; target?: number }
  | { kind: 'series'; points: Point[] }
  | { kind: 'revenue'; total: number; points: Point[]; average: number }
  | { kind: 'rows'; module: Module; records: CrmRecord[]; total: number }

export function needsModule(t: Widget['type']): boolean {
  return t !== 'recentActivities'
}

/** Compute the data for data-driven widgets. Activities/tasks/calendar render from live stores directly. */
export function computeWidgetData(w: Widget, modules: Module[], records: CrmRecord[], ctx: Ctx, now = new Date(), actor?: Actor): WidgetData {
  if (!needsModule(w.type)) return { kind: 'empty', reason: '' }
  const { module, records: scoped } = scopedRecords(w, modules, records, ctx, now)
  let list = scoped
  if (actor && module) {
    // permissions first: a chart can never reveal what the viewer may not open
    if (!canModule(actor.role, module, 'view')) return { kind: 'empty', reason: 'You do not have access to the data behind this component.' }
    const used = [w.fieldId, w.groupBy, w.dateField, ...(w.filters ?? []).map((f) => f.fieldId)].filter((x): x is string => !!x)
    const hidden = used.filter((id) => { const f = module.fields.find((x) => x.id === id); return f && fieldAccess(actor.role, f) === 'hidden' })
    if (hidden.length) return { kind: 'empty', reason: 'This component uses a field you are not allowed to see.' }
    list = scoped.filter((r) => canSeeRecord(actor, module, r))
  }
  if (!module) return { kind: 'empty', reason: w.moduleId ? 'The source module no longer exists.' : 'Choose a source module.' }
  if ((w.agg !== 'count') && w.fieldId && !findField(module, w.fieldId)) return { kind: 'empty', reason: 'The chosen field no longer exists.' }
  switch (w.type) {
    case 'stat':
    case 'metric':
    case 'progress':
      return { kind: 'value', value: aggregate(module, list, w.agg, w.fieldId, ctx), count: list.length, target: w.target }
    case 'bar':
    case 'line':
    case 'pie':
    case 'pipeline': {
      let gb = w.groupBy
      if (!gb && w.type === 'pipeline') gb = module.fields.find((f) => f.type === 'dropdown' || f.type === 'radio')?.id
      return { kind: 'series', points: series({ ...w, groupBy: gb }, module, list, ctx) }
    }
    case 'revenue': {
      const fieldId = w.fieldId ?? module.fields.find((f) => f.type === 'currency')?.id
      const agg: Agg = w.agg === 'count' ? 'sum' : w.agg
      const points = monthlyTotals({ ...w, fieldId, agg }, module, list, ctx)
      const total = aggregate(module, list, agg, fieldId, ctx)
      return { kind: 'revenue', total, points, average: points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : 0 }
    }
    case 'table':
    case 'recentRecords':
    case 'tasks':
    case 'calendar': {
      const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return { kind: 'rows', module, records: sorted.slice(0, w.limit ?? 8), total: list.length }
    }
    default:
      return { kind: 'empty', reason: '' }
  }
}

export function formatNumber(n: number, currency?: string): string {
  if (!Number.isFinite(n)) return '—'
  if (currency) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n) } catch { /* fall through */ }
  }
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export function defaultWidget(type: Widget['type'], moduleId: string | undefined, id: string): Widget {
  const base: Widget = { id, type, title: WIDGET_TYPES.find((t) => t.type === type)?.label ?? 'Widget', moduleId, agg: 'count', dateRange: 'all', filters: [], w: 1, h: 1 }
  switch (type) {
    case 'stat': return { ...base, w: 1, h: 1 }
    case 'metric': return { ...base, w: 1, h: 1, agg: 'sum' }
    case 'progress': return { ...base, w: 2, h: 1, target: 100 }
    case 'bar': case 'line': case 'pie': case 'pipeline': case 'revenue': return { ...base, w: 2, h: 2 }
    case 'recentActivities': return { ...base, moduleId: undefined, w: 2, h: 2, limit: 8 }
    default: return { ...base, w: 2, h: 2, limit: 6 }
  }
}

export const WIDGET_TYPES: { type: Widget['type']; label: string; icon: string; hint: string }[] = [
  { type: 'stat', label: 'Stat', icon: 'Hash', hint: 'One big number' },
  { type: 'metric', label: 'Custom metric', icon: 'Calculator', hint: 'Sum, average, min or max of a field' },
  { type: 'progress', label: 'Progress', icon: 'Target', hint: 'Value against a target' },
  { type: 'bar', label: 'Bar chart', icon: 'BarChart3', hint: 'Compare groups' },
  { type: 'line', label: 'Line chart', icon: 'LineChart', hint: 'Trend over time' },
  { type: 'pie', label: 'Pie chart', icon: 'PieChart', hint: 'Share of total' },
  { type: 'pipeline', label: 'Pipeline', icon: 'Filter', hint: 'Stage funnel' },
  { type: 'revenue', label: 'Revenue', icon: 'DollarSign', hint: 'Totals by month' },
  { type: 'table', label: 'Table', icon: 'Table2', hint: 'Latest records in a grid' },
  { type: 'recentRecords', label: 'Recent records', icon: 'Clock', hint: 'Newest records list' },
  { type: 'recentActivities', label: 'Recent activities', icon: 'Activity', hint: 'Workspace activity feed' },
  { type: 'tasks', label: 'Tasks', icon: 'CheckSquare', hint: 'Open tasks to tick off' },
  { type: 'calendar', label: 'Calendar', icon: 'CalendarDays', hint: 'Month view of dated records' },
]
