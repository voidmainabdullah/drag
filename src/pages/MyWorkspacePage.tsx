import { useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { useAllModules, useCtx, useCurrentUser, useDashboards, useForms, usePerms, useRecords, useWorkflows, useWorkspace, useWsId } from '#/hooks/useData'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUiStore } from '#/stores/uiStore'
import { recordTitle, safeDate } from '#/utils/records'
import { Page } from '#/components/layout/Page'
import { AppLink } from '#/components/layout/AppLink'
import { WorkspaceDialog } from '#/components/layout/WorkspaceDialog'
import { Button } from '#/components/ui/Button'
import { Avatar, Card, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { useOpenTarget } from './RecentFavouritesPages'

function Panel({ title, to, toLabel, children }: { title: string; to?: string; toLabel?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>{to && <AppLink to={to} className="text-xs font-medium text-primary hover:underline">{toLabel ?? 'View all'}</AppLink>}</div>
      {children}
    </Card>
  )
}
const Empty = ({ text }: { text: string }) => <p className="py-6 text-center text-[13px] text-muted">{text}</p>

export function MyWorkspacePage() {
  const wsId = useWsId()
  const ws = useWorkspace()
  const me = useCurrentUser()
  const perms = usePerms()
  const modules = useAllModules()
  const records = useRecords()
  const forms = useForms()
  const workflows = useWorkflows()
  const dashboards = useDashboards()
  const ctx = useCtx()
  const showRecord = useUiStore((s) => s.showRecord)
  const open = useOpenTarget()
  const favs = useSettingsStore((s) => s.settings.favourites[wsId]) ?? []
  const recents = useSettingsStore((s) => s.settings.recents[wsId]) ?? []
  const [editing, setEditing] = useState(false)

  const assigned = useMemo(() => {
    if (!me) return []
    return records.filter((r) => !r.deletedAt && !r.archived).flatMap((r) => {
      const m = modules.find((x) => x.id === r.moduleId)
      if (!m || m.system === 'tasks') return []
      const f = m.fields.find((x) => x.type === 'user' && r.data[x.id] === me.id)
      return f ? [{ r, m, via: f.label }] : []
    }).slice(0, 8)
  }, [records, modules, me])
  const tasksModule = modules.find((m) => m.system === 'tasks')
  const myTasks = useMemo(() => (tasksModule ? records.filter((r) => r.moduleId === tasksModule.id && !r.deletedAt && r.data.status !== 'done' && (!r.data.assignee || r.data.assignee === me?.id)).sort((a, b) => String(a.data.due || '9999').localeCompare(String(b.data.due || '9999'))).slice(0, 6) : []), [records, tasksModule, me])

  if (!ws) return null
  const stats = [
    { label: 'Modules', value: modules.filter((m) => !m.system && !m.archived).length, icon: 'Boxes' },
    { label: 'Records', value: records.filter((r) => !r.deletedAt && (!tasksModule || r.moduleId !== tasksModule.id)).length, icon: 'Database' },
    { label: 'Forms', value: forms.length, icon: 'FormInput' },
    { label: 'Workflows', value: workflows.length, icon: 'Workflow' },
    { label: 'Dashboards', value: dashboards.length, icon: 'PieChart' },
  ]

  return (
    <Page title="My Workspace" skeleton="cards">
      <PageHeader title="My Workspace" icon="Briefcase" description={`${ws.name}${ws.description ? ` — ${ws.description}` : ''}`}
        actions={<>{perms.can('accessSettings') && <Button icon="Pencil" onClick={() => setEditing(true)}>Edit workspace</Button>}<AppLink to="/settings" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] hover:bg-subtle"><Icon name="Settings" size={14} />Workspaces</AppLink></>} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => <Card key={s.label} className="flex items-center gap-3 p-3.5"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={s.icon} size={16} /></span><div><div className="text-xl leading-none font-bold tabular-nums">{s.value}</div><div className="mt-0.5 text-xs text-muted">{s.label}</div></div></Card>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="My open tasks" to="/tasks">
          {myTasks.length === 0 || !tasksModule ? <Empty text="No open tasks." /> : (
            <ul className="space-y-1">{myTasks.map((r) => { const d = safeDate(r.data.due); return <li key={r.id}><button type="button" onClick={() => showRecord(tasksModule.id, r.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"><span className="truncate">{recordTitle(tasksModule, r, ctx)}</span>{d && <span className="shrink-0 text-xs text-muted">{format(d, 'MMM d')}</span>}</button></li> })}</ul>
          )}
        </Panel>
        <Panel title="Assigned to me">
          {assigned.length === 0 ? <Empty text="Nothing is assigned to you in any User field." /> : (
            <ul className="space-y-1">{assigned.map(({ r, m, via }) => <li key={r.id}><button type="button" onClick={() => showRecord(m.id, r.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"><span className="size-2 shrink-0 rounded-full" style={{ background: m.color }} /><span className="min-w-0 flex-1 truncate">{recordTitle(m, r, ctx)}</span><span className="shrink-0 text-xs text-muted">{m.name} · {via}</span></button></li>)}</ul>
          )}
        </Panel>
        <Panel title="Favourites" to="/favourites">
          {favs.length === 0 ? <Empty text="Star records to pin them here." /> : <ul className="space-y-1">{favs.slice(0, 6).map((f) => <li key={`${f.moduleId}:${f.recordId ?? ''}`}><button type="button" onClick={() => open(f)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"><Icon name="Star" size={13} className="text-warning" /><span className="truncate">{f.label}</span></button></li>)}</ul>}
        </Panel>
        <Panel title="Recently viewed" to="/recent">
          {recents.length === 0 ? <Empty text="Nothing viewed yet." /> : <ul className="space-y-1">{recents.slice(0, 6).map((r) => <li key={`${r.moduleId}:${r.recordId ?? ''}`}><button type="button" onClick={() => open(r)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle"><span className="truncate">{r.label}</span><span className="shrink-0 text-xs text-muted">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span></button></li>)}</ul>}
        </Panel>
      </div>
      {me && <div className="mt-5 flex items-center gap-2 text-xs text-muted"><Avatar name={me.name} color={me.color} size={20} /> Signed in locally as {me.name} ({me.email})</div>}
      {editing && <WorkspaceDialog open onClose={() => setEditing(false)} workspace={ws} />}
    </Page>
  )
}
