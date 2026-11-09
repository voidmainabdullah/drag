import { useEffect, useState } from 'react'
import { useModules, usePerms, useViews, useWsId } from '#/hooks/useData'
import { useSelectionStore } from '#/stores/selectionStore'
import { useViewStore } from '#/stores/collections'
import { newView, emptyViewConfig } from '#/services/defaults'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { NameDialog } from '#/components/ui/Overlays'
import { EmptyState, PageHeader, Badge, Card } from '#/components/ui/misc'
import { Select, Textarea } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { NewViewDialog, RecordsView, ShareViewModal, VIEW_TYPES, viewShareSchema } from '#/components/records/RecordsView'
import { cn, nowIso, uid } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import type { ViewConfig } from '#/types'
import { z } from 'zod'

function ImportViewDialog({ open, onClose, onImport }: { open: boolean; onClose: () => void; onImport: (name: string, type: (typeof VIEW_TYPES)[number]['id'], config: ViewConfig) => void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { if (open) { setText(''); setErr('') } }, [open])
  const go = () => {
    try {
      const p = viewShareSchema.parse(JSON.parse(text))
      onImport(p.name ?? 'Imported view', p.type, { ...emptyViewConfig(), ...p.config } as ViewConfig)
      onClose()
    } catch (e) {
      setErr(e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Invalid view config') : 'That is not valid JSON')
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Import view from JSON" description="Paste a config copied from “Share JSON”." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!text.trim()} onClick={go}>Import</Button></>}>
      <Textarea aria-label="View JSON" className="min-h-[200px] font-mono text-xs" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setErr('') }} placeholder='{"xcrmView":1,"type":"table","config":{…}}' />
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </Modal>
  )
}

export function ViewsPage() {
  const modules = useModules()
  const perms = usePerms()
  const go = useGo()
  const ws = useWsId()
  const sel = useSelectionStore()
  const module = modules.find((m) => m.id === sel.moduleId) ?? modules[0]
  const views = useViews(module?.id)
  const view = views.find((v) => v.id === sel.viewId) ?? views[0]
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const canManage = perms.can('manageForms') || perms.can('manageFields')

  useEffect(() => { if (view && view.id !== sel.viewId) sel.set({ viewId: view.id }) }, [view?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page title="View Builder" wide skeleton="table">
      <PageHeader title="View Builder" icon="LayoutGrid" description="Create, tweak and share saved views. Use the toolbar to filter, sort, group and choose columns, then click “Save view”."
        actions={module && canManage && <><Button icon="Upload" onClick={() => setImporting(true)}>Import JSON</Button><Button variant="gradient" icon="Plus" onClick={() => setCreating(true)}>New view</Button></>} />
      {!module ? (
        <EmptyState icon="LayoutGrid" title="No modules yet" description="Views belong to modules. Create one first." action={<Button variant="primary" onClick={() => go('/module-builder')}>Open Module Builder</Button>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <aside className="space-y-3">
            <Select aria-label="Module" value={module.id} onChange={(e) => sel.set({ moduleId: e.target.value, viewId: null })}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            <div className="space-y-1.5">
              {views.map((v) => {
                const t = VIEW_TYPES.find((x) => x.id === v.type)
                return (
                  <button key={v.id} type="button" onClick={() => sel.set({ viewId: v.id })} className={cn('flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition', v.id === view?.id ? 'border-primary bg-primary/5' : 'border-line bg-surface hover:bg-subtle')}>
                    <Icon name={t?.icon} size={16} className="text-primary" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{v.name}</span><span className="text-[11px] text-muted">{t?.label}</span></span>
                    {v.config.filters.length > 0 && <Badge>{v.config.filters.length} filter</Badge>}
                  </button>
                )
              })}
            </div>
            {view && (
              <Card className="space-y-2 p-3">
                <div className="text-xs font-semibold tracking-wider text-muted uppercase">Selected view</div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" icon="Pencil" disabled={!canManage} onClick={() => setRenaming(true)}>Rename</Button>
                  <Button size="xs" icon="Copy" disabled={!canManage} onClick={() => { const t = nowIso(); const id = uid('view'); useViewStore.getState().add({ ...structuredClone(view), id, name: `${view.name} (copy)`, order: views.length, createdAt: t, updatedAt: t }); sel.set({ viewId: id }); toast.success('View duplicated') }}>Duplicate</Button>
                  <Button size="xs" icon="Share2" onClick={() => setSharing(true)}>Share JSON</Button>
                  <Button size="xs" variant="ghost" icon="Trash2" disabled={!canManage || views.length <= 1} onClick={async () => { if (await confirmDialog({ title: `Delete view “${view.name}”?`, confirmLabel: 'Delete', danger: true })) { useViewStore.getState().remove(view.id); sel.set({ viewId: null }) } }}>Delete</Button>
                </div>
              </Card>
            )}
          </aside>
          <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
            {view ? <RecordsView key={`${module.id}:${view.id}`} module={module} defaultViewId={view.id} /> : <EmptyState icon="LayoutGrid" title="No views" action={canManage && <Button variant="primary" onClick={() => setCreating(true)}>Create view</Button>} />}
          </div>
        </div>
      )}
      {module && <NewViewDialog open={creating} onClose={() => setCreating(false)} module={module} count={views.length} onCreated={(id) => sel.set({ viewId: id })} />}
      {module && <ImportViewDialog open={importing} onClose={() => setImporting(false)} onImport={(name, type, config) => { const v = newView(ws, module, name, type, config, views.length); useViewStore.getState().add(v); sel.set({ viewId: v.id }); toast.success('View imported') }} />}
      {view && <NameDialog open={renaming} title="Rename view" label="View name" initial={view.name} onClose={() => setRenaming(false)} onSubmit={(n) => useViewStore.getState().update(view.id, { name: n })} />}
      {view && sharing && <ShareViewModal view={view} config={view.config} onClose={() => setSharing(false)} onApply={(config, type) => { useViewStore.getState().update(view.id, { config, type }); setSharing(false); toast.success('View updated from JSON') }} />}
    </Page>
  )
}
