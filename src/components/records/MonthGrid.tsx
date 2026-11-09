import { useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '#/components/ui/Button'
import { cn } from '#/utils/id'

export interface CalItem {
  id: string
  date: Date
  label: string
  color?: string
  sub?: string
  onClick: () => void
}

export function MonthGrid({ items, onAdd }: { items: CalItem[]; onAdd?: (d: Date) => void }) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor)), end: endOfWeek(endOfMonth(cursor)) })
  const today = new Date()
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h3 className="text-sm font-semibold">{format(cursor, 'MMMM yyyy')}</h3>
        <div className="flex items-center gap-1">
          <Button size="xs" onClick={() => setCursor(startOfMonth(new Date()))}>Today</Button>
          <button type="button" aria-label="Previous month" className="rounded-lg p-1.5 hover:bg-subtle" onClick={() => setCursor((c) => addMonths(c, -1))}><ChevronLeft size={16} /></button>
          <button type="button" aria-label="Next month" className="rounded-lg p-1.5 hover:bg-subtle" onClick={() => setCursor((c) => addMonths(c, 1))}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold text-muted">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="py-1.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = items.filter((i) => isSameDay(i.date, d))
          return (
            <div key={d.toISOString()} className={cn('group relative min-h-[96px] border-r border-b border-line/70 p-1 last:border-r-0 [&:nth-child(7n)]:border-r-0', !isSameMonth(d, cursor) && 'bg-subtle/40 text-muted')}>
              <div className="flex items-center justify-between">
                <span className={cn('flex size-6 items-center justify-center rounded-full text-xs', isSameDay(d, today) && 'gradient-brand font-bold text-white')}>{format(d, 'd')}</span>
                {onAdd && <button type="button" aria-label={`Add on ${format(d, 'MMM d')}`} onClick={() => onAdd(d)} className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-primary focus:opacity-100"><Plus size={13} /></button>}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {list.slice(0, 3).map((i) => (
                  <button key={i.id} type="button" onClick={i.onClick} title={i.sub ? `${i.label} — ${i.sub}` : i.label} className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${i.color ?? '#7B68EE'} 18%, transparent)`, color: i.color ?? '#7B68EE' }}>
                    {i.label}
                  </button>
                ))}
                {list.length > 3 && <div className="px-1 text-[10px] text-muted">+{list.length - 3} more</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
