import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useAllModules, useCtx, useCurrentUser, usePerms, useRecords, useUsers, useWsId } from '#/hooks/useData'
import { useRecordStore } from '#/stores/recordStore'
import { useUiStore } from '#/stores/uiStore'
import { ensureTasksModule } from '#/services/moduleService'
import { recordTitle, safeDate } from '#/utils/records'
import { cn } from '#/utils/id'
import { toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { RecordsView } from '#/components/records/RecordsView'
import { Button } from '#/components/ui/Button'
import { Avatar, Badge, EmptyState, PageHeader, Segmented, Skeleton } from '#/components/ui/misc'
import { Input } from '#/components/ui/controls'

type Mode = 'list' | 'board'
type Filter = 'mine' | 'all' | 'overdue' | 'today' | 'done'
const PRIORITY_COLOR: Record<string, string> = { low: '#64748B', medium: '#3B9DF8', high: '#F5A524', urgent: '#EF4444' }

export function TasksPage() {
  const ws = useWsId()
  const modules = useAllModules()
  const tasksModule = modules.find((m) => m.system === 'tasks')
  const records = useRecords(tasksModule?.id)
  const users = useUsers()
  const me = useCurrentUser()
  const perms = usePerms()
  const ctx = useCtx()
  const showRecord = useUiStore((s) => s.showRecord)
  const [mode, setMode] = useState<Mode>('list')
  const [filter, setFilter] = useState<Filter>('mine')
  const [title, setTitle] = useState('')

  useEffect(() => { if (!tasksModule && ws) ensureTasksModule(ws) }, [tasksModule, ws])

  const today = format(new Date(), 'yyyy-MM-dd')
  const isDone = (r: (typeof records)[number]) => r.data.status === 'done'
  const filters: { id: Filter; label: string; test: (r: (typeof records)[number]) => boolean }[] = useMemo(() => [
    { id: 'mine', label: 'My tasks', test: (r) => !isDone(r) && (!r.data.assignee || r.data.assignee === me?.id) },
    { id: 'all', label: 'All open', test: (r) => !isDone(r) },
    { id: 'overdue', label: 'Overdue', test: (r) => { const d = safeDate(r.data.due); return !isDone(r) && !!d && format(d, 'yyyy-MM-dd') < today } },
    { id: 'today', label: 'Due today', test: (r) => { const d = safeDate(r.data.due); return !isDone(r) && !!d && format(d, 'yyyy-MM-dd') === today } },
    { id: 'done', label: 'Completed', test: (r) => isDone(r) },
  ], [me?.id, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = filters.find((f) => f.id === filter)!
  const list = useMemo(() => records.filter(active.test).sort((a, b) => String(a.data.due || '9999').localeCompare(String(b.data.due || '9999'))), [records, active])

  const add = () => {
    if (!tasksModule || !title.trim()) return
    const res = useRecordStore.getState().create(tasksModule.id, { title: title.trim(), status: 'to_do', priority: 'medium', assignee: me?.id ?? '' })
    if ('errors' in res && res.errors) return toast.error('Could not add task', Object.values(res.errors)[0])
    setTitle('')
    toast.success('Task added')
  }
  const toggle = (id: string, done: boolean) => useRecordStore.getState().update(id, { status: done ? 'done' : 'to_do' })

  return (
    <Page title="Tasks" wide skeleton="table">
      <PageHeader title="Tasks" icon="CheckSquare" description="Your to-dos, including follow-ups created by workflows."
        actions={<Segmented<Mode> value={mode} onChange={setMode} options={[{ id: 'list', label: 'List', icon: 'ListChecks' }, { id: 'board', label: 'Board & table', icon: 'Columns3' }]} />} />
      {!tasksModule ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : mode === 'board' ? (
        <RecordsView module={tasksModule} />
      ) : (
        <div className="max-w-3xl">
          {perms.canModule(tasksModule, 'create') && (
            <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
              <Input aria-label="New task title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task and press Enter…" />
              <Button type="submit" variant="primary" icon="Plus" disabled={!title.trim()}>Add</Button>
            </form>
          )}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {filters.map((f) => <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === f.id ? 'border-primary bg-primary text-white' : 'border-line hover:bg-subtle')}>{f.label} <span className="opacity-70">{records.filter(f.test).length}</span></button>)}
          </div>
          {list.length === 0 ? (
            <EmptyState icon={filter === 'done' ? 'CheckCircle2' : 'PartyPopper'} title={filter === 'done' ? 'Nothing completed yet' : 'You’re all caught up'} description={filter === 'done' ? 'Completed tasks show up here.' : 'No tasks match this filter.'} />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {list.map((r) => {
                const d = safeDate(r.data.due)
                const overdue = !isDone(r) && d && format(d, 'yyyy-MM-dd') < today
                const u = users.find((x) => x.id === r.data.assignee)
                const pr = String(r.data.priority ?? '')
                return (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-subtle/60">
                    <input type="checkbox" aria-label={`Mark “${recordTitle(tasksModule, r, ctx)}” ${isDone(r) ? 'not done' : 'done'}`} checked={isDone(r)} disabled={!perms.canModule(tasksModule, 'edit')} onChange={(e) => toggle(r.id, e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
                    <button type="button" onClick={() => showRecord(tasksModule.id, r.id)} className={cn('min-w-0 flex-1 truncate text-left text-[14px]', isDone(r) && 'text-muted line-through')}>{recordTitle(tasksModule, r, ctx)}{typeof r.data.related === 'string' && r.data.related && <span className="ml-2 text-xs text-muted">{r.data.related}</span>}</button>
                    {pr && !isDone(r) && <Badge color={PRIORITY_COLOR[pr]}>{pr}</Badge>}
                    {d && <span className={cn('shrink-0 text-xs', overdue ? 'font-semibold text-danger' : 'text-muted')}>{format(d, 'MMM d')}</span>}
                    {u && <Avatar name={u.name} color={u.color} size={22} />}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </Page>
  )
}
