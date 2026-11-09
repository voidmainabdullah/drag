import { useEffect, useState } from 'react'
import { useModules, usePerms } from '#/hooks/useData'
import { useSelectionStore } from '#/stores/selectionStore'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { EmptyState, PageHeader, Tabs } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { Notice } from '#/components/ui/misc'
import { cn } from '#/utils/id'
import { FieldManager } from '#/builders/ModuleBuilder/FieldManager'
import { ModuleSettings } from '#/builders/ModuleBuilder/ModuleSettings'
import { DataFlowWorkspace } from '#/builders/DataFlow/DataFlowWorkspace'
import { NewModuleDialog } from '#/builders/ModuleBuilder/NewModuleDialog'
import { FormsPanel, RelationshipsPanel } from '#/builders/ModuleBuilder/ModulePanels'
import { useModuleActions } from './ModulesPage'

type Tab = 'fields' | 'settings' | 'relationships' | 'forms' | 'dataflow'

export function ModuleBuilderPage() {
  const modules = useModules({ includeArchived: true })
  const perms = usePerms()
  const go = useGo()
  const a = useModuleActions()
  const selId = useSelectionStore((s) => s.moduleId)
  const [tab, setTab] = useState<Tab>('fields')
  const [creating, setCreating] = useState(false)
  const current = modules.find((m) => m.id === selId) ?? modules[0]

  useEffect(() => { if (current && current.id !== selId) useSelectionStore.getState().set({ moduleId: current.id }) }, [current, selId])

  return (
    <Page title="Module Builder" skeleton="cards" wide>
      <PageHeader title="Module Builder" icon="Wand2" description="Design the structure of your CRM: modules, their fields and the links between them."
        actions={perms.can('manageFields') && <Button variant="gradient" icon="Plus" onClick={() => setCreating(true)}>New module</Button>} />
      {!perms.can('manageFields') && !perms.can('manageFields') && <div className="mb-4"><Notice tone="warning">Your role can’t change module structure. You can browse but not edit.</Notice></div>}
      {modules.length === 0 ? (
        <EmptyState icon="Wand2" title="No modules to build yet" description="Create your first module, or install a ready-made template." action={<><Button variant="primary" icon="Plus" onClick={() => setCreating(true)}>New module</Button><Button onClick={() => go('/templates')}>Browse templates</Button></>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
          <nav aria-label="Modules" className="scroll-thin max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-2">
            {modules.map((m) => (
              <button key={m.id} type="button" onClick={() => useSelectionStore.getState().set({ moduleId: m.id })} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition', current?.id === m.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-subtle')}>
                <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: m.color }}><Icon name={m.icon} size={13} /></span>
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.archived && <span className="text-[10px] text-muted">archived</span>}
              </button>
            ))}
          </nav>
          {current && (
            <div className="min-w-0 rounded-xl border border-line bg-surface p-5">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl text-white" style={{ background: current.color }}><Icon name={current.icon} size={19} /></span>
                <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{current.name}</h2><p className="text-xs text-muted">{current.fields.length} fields</p></div>
                <Button size="sm" icon="Table2" onClick={() => a.open(current)}>Open records</Button>
                {perms.can('manageFields') && <Button size="sm" icon="Copy" onClick={() => a.duplicate(current)}>Duplicate</Button>}
                {perms.can('manageFields') && <Button size="sm" icon={current.archived ? 'RotateCcw' : 'Archive'} onClick={() => a.archive(current)}>{current.archived ? 'Restore' : 'Archive'}</Button>}
                {perms.can('manageFields') && <Button size="sm" variant="danger" icon="Trash2" onClick={() => void a.remove(current)}>Delete</Button>}
              </div>
              <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'fields', label: 'Fields', icon: 'Columns3' }, { id: 'settings', label: 'Settings & access', icon: 'Settings' }, { id: 'relationships', label: 'Relationships', icon: 'Link2' }, { id: 'forms', label: 'Forms', icon: 'FormInput' }, { id: 'dataflow', label: 'Data flow', icon: 'Network' }]} />
              {tab === 'fields' && <FieldManager module={current} />}
              {tab === 'settings' && <ModuleSettings module={current} />}
              {tab === 'relationships' && <RelationshipsPanel module={current} />}
              {tab === 'forms' && <FormsPanel module={current} />}
              {tab === 'dataflow' && <DataFlowWorkspace focusModuleId={current.id} />}
            </div>
          )}
        </div>
      )}
      <NewModuleDialog open={creating} onClose={() => setCreating(false)} onCreated={(m) => { useSelectionStore.getState().set({ moduleId: m.id }); setTab('fields') }} />
    </Page>
  )
}
