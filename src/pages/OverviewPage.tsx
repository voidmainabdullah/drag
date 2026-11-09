import { formatDistanceToNow } from 'date-fns'
import { useActivities, useAllModules, useCtx, useCurrentUser, useModules, useRecords, useWorkflows, useWorkspace, useWsId } from '#/hooks/useData'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUiStore } from '#/stores/uiStore'
import { Page } from '#/components/layout/Page'
import { AppLink, useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Card, EmptyState } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
export function OverviewPage() {
  const ws = useWorkspace()
  const wsId = useWsId()
  const user = useCurrentUser()
  const modules = useModules()
  const allModules = useAllModules()
  const records = useRecords()
  const workflows = useWorkflows()
  const acts = useActivities()
  const ctx = useCtx()
  const go = useGo()
  const showRecord = useUiStore((s) => s.showRecord)
  const startNew = useUiStore((s) => s.startNewRecord)
  const favs = useSettingsStore((s) => s.settings.favourites[wsId]) ?? []
  const recents = useSettingsStore((s) => s.settings.recents[wsId]) ?? []
  const tasksModule = allModules.find((m) => m.system === 'tasks')
  const openTasks = tasksModule ? records.filter((r) => r.moduleId === tasksModule.id && r.data.status !== 'done').length : 0
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const stats = [
    { label: 'Modules', value: modules.length, icon: 'Boxes', to: '/modules', color: '#7B68EE' },
    { label: 'Records', value: records.filter((r) => !tasksModule || r.moduleId !== tasksModule.id).length, icon: 'Database', to: '/modules', color: '#FD71AF' },
    { label: 'Open tasks', value: openTasks, icon: 'CheckSquare', to: '/tasks', color: '#2DB67D' },
    { label: 'Active workflows', value: workflows.filter((w) => w.enabled).length, icon: 'Workflow', to: '/workflows', color: '#F5A524' },
  ]

  return (
    <Page title="Overview">
      <div className="gradient-brand relative mb-6 overflow-hidden rounded-2xl p-6 text-white shadow-sm sm:p-8">
        <div className="absolute -top-10 -right-10 size-48 rounded-full bg-white/10" />
        <div className="absolute -right-4 -bottom-16 size-40 rounded-full bg-white/10" />
        <p className="text-sm text-white/80">{ws?.name}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{greeting}, {user?.name ?? 'there'} 👋</h1>
        <p className="mt-2 max-w-xl text-sm text-white/85">Everything here is stored privately in this browser. Build modules, capture records, and automate follow-ups — no backend needed.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" icon="Box" onClick={() => go('/module-builder')}>New module</Button>
          <Button variant="secondary" icon="LayoutTemplate" onClick={() => go('/templates')}>Browse templates</Button>
          <Button variant="secondary" icon="PieChart" onClick={() => go('/dashboards')}>Dashboards</Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} onClick={() => go(s.to)} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">{s.label}</span>
              <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${s.color} 15%, transparent)`, color: s.color }}><Icon name={s.icon} size={16} /></span>
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{s.value}</div>
          </Card>
        ))}
      </div>

      {modules.length === 0 && (
        <EmptyState icon="Boxes" title="Your workspace has no modules yet" description="Create a module from scratch, or install a ready-made template and edit it freely." action={<><Button variant="primary" icon="Plus" onClick={() => go('/module-builder')}>Create module</Button><Button icon="LayoutTemplate" onClick={() => go('/templates')}>Install template</Button></>} />
      )}

      {modules.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold">Quick add</h2>
          <div className="flex flex-wrap gap-2">
            {modules.slice(0, 10).map((m) => (
              <button key={m.id} type="button" onClick={() => startNew(m.id)} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium transition hover:border-primary/50 hover:bg-primary/5">
                <Icon name={m.icon} size={14} className="text-muted" /> New {m.name.replace(/s$/, '').toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent items</h2><AppLink to="/recent" className="text-xs text-primary hover:underline">View all</AppLink></div>
          {recents.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">Records you open will show up here.</p> : (
            <ul className="space-y-1">
              {recents.slice(0, 6).map((r) => (
                <li key={`${r.moduleId}${r.recordId}`}>
                  <button type="button" onClick={() => (r.recordId ? showRecord(r.moduleId, r.recordId) : go(`/m/${r.moduleId}`))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                    <Icon name={ctx.modules.get(r.moduleId)?.icon} size={14} className="text-muted" />
                    <span className="flex-1 truncate">{r.label}</span>
                    <span className="text-[11px] text-muted">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Favourites</h2><AppLink to="/favourites" className="text-xs text-primary hover:underline">View all</AppLink></div>
          {favs.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">Star a record or module to pin it here.</p> : (
            <ul className="space-y-1">
              {favs.slice(0, 6).map((f, i) => (
                <li key={i}>
                  <button type="button" onClick={() => (f.recordId && f.moduleId ? showRecord(f.moduleId, f.recordId) : go(`/m/${f.moduleId}`))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-subtle">
                    <Icon name="Star" size={14} className="text-warning" /><span className="truncate">{f.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent activity</h2><AppLink to="/recent" className="text-xs text-primary hover:underline">View all</AppLink></div>
          {acts.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">Activity appears as you work.</p> : (
            <ul className="space-y-2.5">
              {acts.slice(0, 6).map((a) => (
                <li key={a.id} className="text-[13px]">
                  <div className="line-clamp-2">{a.description}</div>
                  <div className="text-[11px] text-muted">{formatDistanceToNow(new Date(a.timestamp), { addSuffix: true })}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  )
}
