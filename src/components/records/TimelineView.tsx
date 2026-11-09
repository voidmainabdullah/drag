import { useMemo } from 'react'
import { addDays, differenceInCalendarDays, eachDayOfInterval, format, startOfDay } from 'date-fns'
import { recordTitle, safeDate } from '#/utils/records'
import { EmptyState } from '#/components/ui/misc'
import type { ViewProps } from './viewTypes'

const DAY = 30

export function TimelineView({ module, records, config, ctx, onOpen }: ViewProps) {
  const start = module.fields.find((f) => f.id === config.dateFieldId)
  const end = module.fields.find((f) => f.id === config.endDateFieldId)

  const model = useMemo(() => {
    if (!start) return null
    const rows = records.flatMap((r) => {
      const s = safeDate(r.data[start.id])
      if (!s) return []
      let e = end ? safeDate(r.data[end.id]) : null
      if (!e || e < s) e = s
      return [{ r, s: startOfDay(s), e: startOfDay(e) }]
    })
    const unscheduled = records.filter((r) => !safeDate(r.data[start.id]))
    if (!rows.length) return { rows, unscheduled, days: [] as Date[] }
    const min = addDays(rows.reduce((m, x) => (x.s < m ? x.s : m), rows[0].s), -3)
    const max = addDays(rows.reduce((m, x) => (x.e > m ? x.e : m), rows[0].e), 7)
    return { rows: rows.sort((a, b) => a.s.getTime() - b.s.getTime()), unscheduled, days: eachDayOfInterval({ start: min, end: max }) }
  }, [records, start, end])

  if (!start) return <EmptyState icon="GanttChart" title="Choose a start date field" description="Open the view settings (gear) menu and pick the Date field that starts each item. Optionally pick an end date." />
  if (!model || (!model.rows.length && !model.unscheduled.length)) return <EmptyState icon="GanttChart" title="Nothing to show" description="Add records with dates to see them on the timeline." />
  const first = model.days[0]
  const today = startOfDay(new Date())
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="scroll-thin overflow-x-auto">
        <div style={{ width: Math.max(model.days.length * DAY + 200, 600) }}>
          <div className="sticky top-0 flex border-b border-line bg-subtle/60 text-[10px] text-muted">
            <div className="sticky left-0 z-10 w-[200px] shrink-0 border-r border-line bg-subtle px-3 py-2 text-xs font-semibold">Record</div>
            <div className="flex">
              {model.days.map((d) => (
                <div key={d.toISOString()} style={{ width: DAY }} className={`shrink-0 border-r border-line/50 py-1 text-center ${d.getDay() === 0 || d.getDay() === 6 ? 'bg-subtle' : ''} ${d.getTime() === today.getTime() ? 'font-bold text-primary' : ''}`}>
                  <div>{format(d, 'd')}</div>
                  {(d.getDate() === 1 || d === first) && <div className="font-semibold">{format(d, 'MMM')}</div>}
                </div>
              ))}
            </div>
          </div>
          {model.rows.map(({ r, s, e }) => {
            const left = differenceInCalendarDays(s, first) * DAY
            const width = (differenceInCalendarDays(e, s) + 1) * DAY
            return (
              <div key={r.id} className="flex items-center border-b border-line/60 hover:bg-primary/5">
                <button type="button" onClick={() => onOpen(r.id)} className="sticky left-0 z-10 w-[200px] shrink-0 truncate border-r border-line bg-surface px-3 py-2 text-left text-[13px] font-medium hover:text-primary">{recordTitle(module, r, ctx)}</button>
                <div className="relative h-9 flex-1">
                  <button type="button" onClick={() => onOpen(r.id)} title={`${format(s, 'MMM d')} – ${format(e, 'MMM d')}`} className="gradient-brand absolute top-1.5 h-6 truncate rounded-md px-2 text-left text-[11px] font-medium text-white shadow-sm" style={{ left, width: Math.max(width - 4, 18) }}>
                    {format(s, 'MMM d')}{width > DAY * 2 ? ` – ${format(e, 'MMM d')}` : ''}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {model.unscheduled.length > 0 && (
        <div className="border-t border-line p-3">
          <div className="mb-1.5 text-xs font-semibold text-muted">Unscheduled ({model.unscheduled.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {model.unscheduled.slice(0, 30).map((r) => <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="rounded-md bg-subtle px-2 py-1 text-xs hover:bg-primary/10">{recordTitle(module, r, ctx)}</button>)}
          </div>
        </div>
      )}
    </div>
  )
}
