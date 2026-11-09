import { useMemo } from 'react'
import { format } from 'date-fns'
import { recordTitle, safeDate } from '#/utils/records'
import { EmptyState } from '#/components/ui/misc'
import { MonthGrid, type CalItem } from './MonthGrid'
import type { ViewProps } from './viewTypes'

export function CalendarView({ module, records, config, ctx, onOpen, onAdd, canCreate }: ViewProps) {
  const field = module.fields.find((f) => f.id === config.dateFieldId)
  const items = useMemo<CalItem[]>(() => {
    if (!field) return []
    return records.flatMap((r) => {
      const d = safeDate(r.data[field.id])
      return d ? [{ id: r.id, date: d, label: recordTitle(module, r, ctx), color: module.color, onClick: () => onOpen(r.id) }] : []
    })
  }, [records, field, module, ctx, onOpen])
  if (!field) return <EmptyState icon="CalendarDays" title="Choose a date field" description="Pick which Date field positions records on the calendar using the view settings (gear) menu." />
  return <MonthGrid items={items} onAdd={canCreate ? (d) => onAdd({ [field.id]: field.type === 'date' ? format(d, 'yyyy-MM-dd') : new Date(d.setHours(9, 0, 0, 0)).toISOString() }) : undefined} />
}
