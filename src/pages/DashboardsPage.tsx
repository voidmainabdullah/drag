import { useEffect, useState } from 'react'
import { useAllModules, useDashboards, usePerms, useWsId } from '#/hooks/useData'
import { useDashboardStore } from '#/stores/collections'
import { useSelectionStore } from '#/stores/selectionStore'
import { defaultWidget, WIDGET_TYPES } from '#/utils/metrics'
import { cn, nowIso, uid } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import type { Dashboard, Widget } from '#/types'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { NameDialog } from '#/components/ui/Overlays'
import { EmptyState, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { Menu } from '#/components/ui/Popover'
import { DashboardGrid } from '#/builders/DashboardBuilder/DashboardGrid'
import { WidgetConfigModal } from '#/builders/DashboardBuilder/WidgetConfigModal'
import { MoreHorizontal } from 'lucide-react'

export function DashboardsPage() {
  const ws = useWsId()
  const dashboards = useDashboards()
  const modules = useAllModules().filter((m) => !m.archived)
  const perms = usePerms()
  const sel = useSelectionStore()
  const store = useDashboardStore.getState()
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState(false)
  const [configuring, setConfiguring] = useState<Widget | null>(null)
  const canManage = perms.can('manageDashboards')
  const dash = dashboards.find((d) => d.id === sel.dashboardId) ?? dashboards[0]

  useEffect(() => { if (dash && dash.id !== sel.dashboardId) sel.set({ dashboardId: dash.id }) }, [dash?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setEditing(false) }, [dash?.id])

  const setWidgets = (widgets: Widget[]) => dash && store.update(dash.id, { widgets })
  const create = (name: string) => {
    const t = nowIso()
    const d: Dashboard = { id: uid('dash'), workspaceId: ws, name, widgets: [], createdAt: t, updatedAt: t }
    store.add(d)
    sel.set({ dashboardId: d.id })
    setEditing(true)
    toast.success('Dashboard created', 'Add your first widget.')
  }
  const addWidget = (type: Widget['type']) => {
    if (!dash) return
    const tasks = modules.find((m) => m.system === 'tasks')
    const moduleId = type === 'tasks' ? tasks?.id : type === 'recentActivities' ? undefined : (modules.find((m) => !m.system) ?? modules[0])?.id
    const w = defaultWidget(type, moduleId, uid('w'))
    setWidgets([...dash.widgets, w])
    setPicking(false)
    if (type !== 'recentActivities') setConfiguring(w)
  }

  return (
    <Page title="Dashboards" wide skeleton="cards">
      <PageHeader title="Dashboards" icon="PieChart" description="Live widgets computed from your records. Everything updates the moment data changes."
        actions={canManage && <>
          {dash && <Button icon={editing ? 'Check' : 'Pencil'} variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((e) => !e)}>{editing ? 'Done editing' : 'Edit dashboard'}</Button>}
          {dash && editing && <Button icon="Plus" variant="gradient" onClick={() => setPicking(true)}>Add widget</Button>}
          <Button icon="Plus" onClick={() => setCreating(true)}>New dashboard</Button>
        </>} />
      {dashboards.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          {dashboards.map((d) => <button key={d.id} type="button" onClick={() => sel.set({ dashboardId: d.id })} className={cn('rounded-lg border px-3 py-1.5 text-[13px] font-medium transition', d.id === dash?.id ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-subtle')}>{d.name}</button>)}
          {dash && canManage && (
            <Menu items={[
              { label: 'Rename', icon: 'Pencil', onClick: () => setRenaming(true) },
              { label: 'Duplicate', icon: 'Copy', onClick: () => { const t = nowIso(); const c: Dashboard = { ...structuredClone(dash), id: uid('dash'), name: `${dash.name} (copy)`, widgets: dash.widgets.map((w) => ({ ...w, id: uid('w') })), createdAt: t, updatedAt: t }; store.add(c); sel.set({ dashboardId: c.id }); toast.success('Dashboard duplicated') } },
              { divider: true },
              { label: 'Delete', icon: 'Trash2', danger: true, disabled: dashboards.length <= 1, onClick: async () => { if (await confirmDialog({ title: `Delete “${dash.name}”?`, confirmLabel: 'Delete', danger: true })) { store.remove(dash.id); sel.set({ dashboardId: null }) } } },
            ]} trigger={({ toggle, ref }) => <button ref={ref} type="button" aria-label="Dashboard options" onClick={toggle} className="rounded-lg p-1.5 text-muted hover:bg-subtle"><MoreHorizontal size={16} /></button>} />
          )}
        </div>
      )}
      {!dash ? (
        <EmptyState icon="PieChart" title="No dashboards yet" description="Create a dashboard and add widgets that summarise your data." action={canManage && <Button variant="primary" icon="Plus" onClick={() => setCreating(true)}>New dashboard</Button>} />
      ) : dash.widgets.length === 0 ? (
        <EmptyState icon="LayoutDashboard" title="This dashboard is empty" description={canManage ? 'Add widgets to start tracking your numbers.' : 'Ask an admin to add widgets.'} action={canManage && <Button variant="primary" icon="Plus" onClick={() => { setEditing(true); setPicking(true) }}>Add widget</Button>} />
      ) : (
        <DashboardGrid widgets={dash.widgets} editing={editing && canManage} onChange={setWidgets} onConfigure={setConfiguring} />
      )}

      <Modal open={picking} onClose={() => setPicking(false)} size="lg" title="Add a widget" description="Pick what to visualise. You can tweak the source and calculation next.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {WIDGET_TYPES.map((t) => (
            <button key={t.type} type="button" onClick={() => addWidget(t.type)} className="rounded-xl border border-line p-3 text-left transition hover:border-primary hover:bg-primary/5">
              <Icon name={t.icon} size={18} className="text-primary" />
              <div className="mt-1.5 text-[13px] font-semibold">{t.label}</div>
              <div className="text-[11px] text-muted">{t.hint}</div>
            </button>
          ))}
        </div>
      </Modal>
      {configuring && <WidgetConfigModal widget={configuring} onClose={() => setConfiguring(null)} onSave={(w) => { dash && setWidgets(dash.widgets.map((x) => (x.id === w.id ? w : x))); setConfiguring(null) }} />}
      <NameDialog open={creating} title="New dashboard" label="Dashboard name" initial="New dashboard" confirmLabel="Create" onClose={() => setCreating(false)} onSubmit={create} />
      {dash && <NameDialog open={renaming} title="Rename dashboard" label="Dashboard name" initial={dash.name} onClose={() => setRenaming(false)} onSubmit={(n) => store.update(dash.id, { name: n })} />}
    </Page>
  )
}
