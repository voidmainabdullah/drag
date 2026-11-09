import { useMemo, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { Module } from '#/types'
import { useDataFlows, useModules, usePerms, useRecords, useWsId } from '#/hooks/useData'
import { deleteModule, duplicateModule, setModuleArchived, setModuleInSidebar } from '#/services/moduleService'
import { useSelectionStore } from '#/stores/selectionStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Menu } from '#/components/ui/Popover'
import { Badge, Card, EmptyState, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { SearchInput, Switch } from '#/components/ui/controls'
import { NewModuleDialog } from '#/builders/ModuleBuilder/NewModuleDialog'
import { confirmDialog, toast } from '#/utils/toast'

export function useModuleActions() {
  const go = useGo()
  return {
    open: (m: Module) => go(`/m/${m.id}`),
    edit: (m: Module) => { useSelectionStore.getState().set({ moduleId: m.id }); go('/module-builder') },
    duplicate: (m: Module) => {
      const c = duplicateModule(m.id, false)
      if (c) toast.success('Module duplicated', `“${c.name}” was created (without records).`)
    },
    archive: (m: Module) => { setModuleArchived(m.id, !m.archived); toast.success(m.archived ? 'Module restored' : 'Module archived') },
    remove: async (m: Module) => {
      const ok = await confirmDialog({ title: `Delete “${m.name}”?`, message: 'This permanently removes the module, its fields, records, forms, views and workflows. Export a backup first if unsure.', confirmLabel: 'Delete module', danger: true, requireText: m.name })
      if (ok) { deleteModule(m.id); toast.success('Module deleted') }
    },
  }
}

function ModuleCard({ m }: { m: Module }) {
  const records = useRecords(m.id)
  const perms = usePerms()
  const a = useModuleActions()
  const ws = useWsId()
  const inSidebar = (useSettingsStore((s) => s.settings.nav[ws]) ?? []).some((n) => n.moduleId === m.id)
  const flowCount = useDataFlows(m.id).length
  const toggleSidebar = () => {
    setModuleInSidebar(m.id, !inSidebar)
    toast.success(inSidebar ? 'Hidden from the sidebar' : 'Shown in the sidebar')
  }
  return (
    <Card onClick={() => a.open(m)} className="group relative p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.color }}><Icon name={m.icon} size={19} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h3 className="truncate text-[15px] font-semibold">{m.name}</h3>{m.archived && <Badge>Archived</Badge>}{!inSidebar && <Badge color="#F5A524"><Icon name="EyeOff" size={11} />Hidden from sidebar</Badge>}</div>
          <p className="mt-0.5 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{m.description || 'No description'}</p>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Menu
            items={[
              { label: 'Open records', icon: 'Table2', onClick: () => a.open(m) },
              ...(perms.can('manageFields') ? [
                { label: 'Edit in builder', icon: 'Pencil', onClick: () => a.edit(m) },
                { label: inSidebar ? 'Hide from sidebar' : 'Show in sidebar', icon: inSidebar ? 'EyeOff' : 'Eye', disabled: m.archived, onClick: toggleSidebar },
                { label: 'Duplicate', icon: 'Copy', onClick: () => a.duplicate(m) },
                { label: m.archived ? 'Restore' : 'Archive', icon: m.archived ? 'RotateCcw' : 'Archive', onClick: () => a.archive(m) },
                { divider: true },
                { label: 'Delete', icon: 'Trash2', danger: true, onClick: () => void a.remove(m) },
              ] : []),
            ]}
            trigger={({ toggle, ref }) => <button ref={ref} type="button" aria-label={`Actions for ${m.name}`} onClick={toggle} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg"><MoreHorizontal size={16} /></button>}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <span>{records.length} records</span><span>·</span><span>{m.fields.length} fields</span>
        {flowCount > 0 && <><span>·</span><span className="inline-flex items-center gap-1 text-primary"><Icon name="Network" size={11} />{flowCount} flow{flowCount === 1 ? '' : 's'}</span></>}
        {m.category && <Badge className="ml-auto">{m.category}</Badge>}
      </div>
    </Card>
  )
}

export function ModulesPage() {
  const [q, setQ] = useState('')
  const [archived, setArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const go = useGo()
  const perms = usePerms()
  const modules = useModules({ includeArchived: archived })
  const filtered = useMemo(() => modules.filter((m) => !q || `${m.name} ${m.description ?? ''} ${m.category ?? ''}`.toLowerCase().includes(q.toLowerCase())), [modules, q])
  const groups = useMemo(() => {
    const map = new Map<string, Module[]>()
    for (const m of filtered) { const k = m.category || 'General'; map.set(k, [...(map.get(k) ?? []), m]) }
    return [...map.entries()]
  }, [filtered])
  return (
    <Page title="All Modules">
      <PageHeader title="All Modules" icon="Boxes" description="Every table in this workspace. Open one to work with its records, or edit its structure in the builder."
        actions={perms.can('manageFields') && <><Button icon="LayoutTemplate" onClick={() => go('/templates')}>From template</Button><Button variant="gradient" icon="Plus" onClick={() => setCreating(true)}>New module</Button></>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search modules…" className="w-full max-w-xs" />
        <Switch checked={archived} onChange={setArchived} label="Show archived" />
      </div>
      {modules.length === 0 ? (
        <EmptyState icon="Boxes" title="No modules yet" description="Create a module or install a template to get started." action={<><Button variant="primary" icon="Plus" onClick={() => setCreating(true)}>New module</Button><Button onClick={() => go('/templates')}>Browse templates</Button></>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="SearchX" title="No matching modules" description={`Nothing matches “${q}”.`} action={<Button onClick={() => setQ('')}>Clear search</Button>} />
      ) : groups.map(([g, list]) => (
        <section key={g} className="mb-7">
          <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((m) => <ModuleCard key={m.id} m={m} />)}</div>
        </section>
      ))}
      <NewModuleDialog open={creating} onClose={() => setCreating(false)} onCreated={(m) => go(`/m/${m.id}`)} />
    </Page>
  )
}