import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useCtx, useModules, usePerms, useRecords } from '#/hooks/useData'
import { useUiStore } from '#/stores/uiStore'
import { recordTitle, safeDate, valueOf } from '#/utils/records'
import { cn } from '#/utils/id'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { MonthGrid, type CalItem } from '#/components/records/MonthGrid'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { EmptyState, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'

export function CalendarPage() {
  const modules = useModules({ includeSystem: true })
  const records = useRecords()
  const ctx = useCtx()
  const perms = usePerms()
  const go = useGo()
  const showRecord = useUiStore((s) => s.showRecord)
  const startNew = useUiStore((s) => s.startNewRecord)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [addDate, setAddDate] = useState<Date | null>(null)

  const sources = useMemo(() => modules.map((m) => ({ m, f: m.fields.find((f) => f.type === 'date' || f.type === 'datetime') })).filter((s): s is { m: typeof s.m; f: NonNullable<typeof s.f> } => !!s.f), [modules])
  const items: CalItem[] = useMemo(() => sources.filter((s) => !off.has(s.m.id)).flatMap(({ m, f }) =>
    records.filter((r) => r.moduleId === m.id && !r.deletedAt && !r.archived).flatMap((r) => {
      const d = safeDate(valueOf(m, r, f, ctx))
      return d ? [{ id: r.id, date: d, label: recordTitle(m, r, ctx), color: m.color, sub: m.name, onClick: () => showRecord(m.id, r.id) }] : []
    })), [sources, off, records, ctx, showRecord])

  return (
    <Page title="Calendar" wide skeleton="table">
      <PageHeader title="Calendar" icon="CalendarDays" description="Every dated record across your modules, in one place. Click an item to open it, or a day’s + to add something." />
      {sources.length === 0 ? (
        <EmptyState icon="CalendarDays" title="No dated modules yet" description="Add a Date field to a module and its records will appear here." action={<Button variant="primary" onClick={() => go('/fields')}>Open Field Manager</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {sources.map(({ m, f }) => (
              <button key={m.id} type="button" aria-pressed={!off.has(m.id)} onClick={() => setOff((o) => { const n = new Set(o); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n })} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition', off.has(m.id) ? 'border-line text-muted line-through' : 'border-transparent text-white')} style={off.has(m.id) ? undefined : { background: m.color }} title={`Using “${f.label}”`}>
                <Icon name={m.icon} size={12} />{m.name}
              </button>
            ))}
          </div>
          <MonthGrid items={items} onAdd={(d) => setAddDate(d)} />
        </>
      )}
      <Modal open={!!addDate} onClose={() => setAddDate(null)} title={addDate ? `Add on ${format(addDate, 'EEE, MMM d')}` : ''} description="Choose which module the new record belongs to.">
        <div className="grid gap-2">
          {sources.filter((s) => perms.canModule(s.m, 'create')).map(({ m, f }) => (
            <button key={m.id} type="button" onClick={() => { if (addDate) startNew(m.id, { [f.id]: format(addDate, f.type === 'datetime' ? "yyyy-MM-dd'T'09:00" : 'yyyy-MM-dd') }); setAddDate(null) }} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:bg-subtle">
              <span className="flex size-8 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
              <span className="text-[13px] font-medium">{m.name}</span><span className="ml-auto text-xs text-muted">sets “{f.label}”</span>
            </button>
          ))}
          {sources.every((s) => !perms.canModule(s.m, 'create')) && <p className="text-[13px] text-muted">Your role can’t create records.</p>}
        </div>
      </Modal>
    </Page>
  )
}
