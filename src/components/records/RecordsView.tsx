import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { z } from 'zod'
import { Download, Filter as FilterIcon, ListFilter, Plus, Settings2, Share2, Upload, X, ArrowUpDown, Columns3, Layers } from 'lucide-react'
import type { Field, ID, Module, View, ViewConfig, ViewType } from '#/types'
import { useCtx, usePerms, useRecords, useViews, useWsId } from '#/hooks/useData'
import { useRecordStore } from '#/stores/recordStore'
import { useViewStore } from '#/stores/collections'
import { useUiStore } from '#/stores/uiStore'
import { applyFilters, applySorts, searchRecords } from '#/utils/records'
import { recordsToTable, toCsv, tableToXlsxBlob } from '#/utils/csv'
import { copyText, downloadBlob, downloadText, safeFileName } from '#/utils/download'
import { confirmDialog, toast } from '#/utils/toast'
import { uid } from '#/utils/id'
import { cn } from '#/utils/id'
import { emptyViewConfig, newView } from '#/services/defaults'
import { Button } from '#/components/ui/Button'
import { Menu, Popover } from '#/components/ui/Popover'
import { Modal } from '#/components/ui/Modal'
import { Checkbox, Field as FormField, Input, Select, SearchInput, Textarea } from '#/components/ui/controls'
import { EmptyState, Segmented } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { NameDialog } from '#/components/ui/Overlays'
import { FieldInput } from '#/components/fields/FieldInput'
import { FilterEditor, SortEditor } from './FilterEditor'
import { TableView } from './TableView'
import { KanbanView } from './KanbanView'
import { CalendarView } from './CalendarView'
import { TimelineView } from './TimelineView'
import { CardView, GalleryView, ListView } from './SimpleViews'
import { ImportWizard } from './ImportWizard'
import type { ViewProps } from './viewTypes'

export const VIEW_TYPES: { id: ViewType; label: string; icon: string; hint: string }[] = [
  { id: 'table', label: 'Table', icon: 'Table2', hint: 'Rows & resizable columns' },
  { id: 'kanban', label: 'Kanban', icon: 'KanbanSquare', hint: 'Drag cards between columns' },
  { id: 'list', label: 'List', icon: 'LayoutList', hint: 'Compact list' },
  { id: 'calendar', label: 'Calendar', icon: 'CalendarDays', hint: 'By a date field' },
  { id: 'timeline', label: 'Timeline', icon: 'GanttChart', hint: 'Start → end bars' },
  { id: 'gallery', label: 'Gallery', icon: 'GalleryHorizontal', hint: 'Image cards' },
  { id: 'card', label: 'Cards', icon: 'Grid2x2', hint: 'Detail cards' },
]

export const viewConfigSchema = z.object({
  filters: z.array(z.object({ id: z.string(), fieldId: z.string(), op: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater', 'less', 'empty', 'not_empty']), value: z.unknown().optional() })).default([]),
  sorts: z.array(z.object({ id: z.string(), fieldId: z.string(), dir: z.enum(['asc', 'desc']) })).default([]),
  groupBy: z.string().optional(),
  hiddenFieldIds: z.array(z.string()).default([]),
  fieldOrder: z.array(z.string()).default([]),
  columnWidths: z.record(z.string(), z.number()).default({}),
  dateFieldId: z.string().optional(),
  endDateFieldId: z.string().optional(),
  imageFieldId: z.string().optional(),
})

export const viewShareSchema = z.object({ xcrmView: z.literal(1), name: z.string().optional(), type: z.enum(['table', 'kanban', 'list', 'calendar', 'timeline', 'gallery', 'card']), config: viewConfigSchema })

export function orderedFields(module: Module, config: ViewConfig, canSee: (f: Field) => boolean): Field[] {
  const byId = new Map(module.fields.map((f) => [f.id, f]))
  const ordered = [...config.fieldOrder.map((id) => byId.get(id)).filter((f): f is Field => !!f), ...module.fields.filter((f) => !config.fieldOrder.includes(f.id))]
  return ordered.filter((f) => !config.hiddenFieldIds.includes(f.id) && canSee(f) && f.type !== 'password')
}

type Scope = 'active' | 'archived' | 'trash'

export function RecordsView({ module, defaultViewId, hideHeader }: { module: Module; defaultViewId?: ID; hideHeader?: boolean }) {
  const perms = usePerms()
  const ctx = useCtx()
  const ws = useWsId()
  const views = useViews(module.id)
  const [viewId, setViewId] = useState<ID | null>(defaultViewId ?? null)
  const [draft, setDraft] = useState<ViewConfig | null>(null)
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<Scope>('active')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importOpen, setImportOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [addView, setAddView] = useState(false)
  const [renameView, setRenameView] = useState<View | null>(null)
  const [share, setShare] = useState<View | null>(null)
  const showRecord = useUiStore((s) => s.showRecord)
  const startNew = useUiStore((s) => s.startNewRecord)
  const all = useRecords(module.id)
  const trashed = useRecords(module.id, { deleted: true })

  const active: View | undefined = views.find((v) => v.id === viewId) ?? views[0]
  const virtual = !active
  const baseConfig = active?.config ?? emptyViewConfig()
  const config = draft ?? baseConfig
  const viewType: ViewType = active?.type ?? 'table'
  const dirty = draft !== null

  useEffect(() => {
    setDraft(null)
    setSelected(new Set())
  }, [active?.id, module.id])
  useEffect(() => setSelected(new Set()), [scope, search])

  const canSee = useCallback((f: Field) => perms.fieldAccess(f) !== 'hidden', [perms])
  const fields = useMemo(() => orderedFields(module, config, canSee), [module, config, canSee])

  const pool = scope === 'trash' ? trashed : scope === 'archived' ? all.filter((r) => r.archived) : all.filter((r) => !r.archived)
  const records = useMemo(() => {
    let r = searchRecords(module, pool, search, ctx)
    r = applyFilters(module, r, config.filters, ctx)
    return applySorts(module, r, config.sorts, ctx)
  }, [module, pool, search, config.filters, config.sorts, ctx])

  const patchConfig = useCallback((p: Partial<ViewConfig>) => setDraft((d) => ({ ...(d ?? baseConfig), ...p })), [baseConfig])

  const saveView = () => {
    if (!draft) return
    if (active) useViewStore.getState().update(active.id, { config: draft })
    else {
      const v = newView(ws, module, 'All records', 'table', draft)
      useViewStore.getState().add(v)
      setViewId(v.id)
    }
    setDraft(null)
    toast.success('View saved')
  }

  const canEdit = perms.canModule(module, 'edit')
  const canCreate = perms.canModule(module, 'create')
  const canDelete = perms.canModule(module, 'delete')
  const canExport = perms.can('exportData')
  const canManageViews = perms.can('manageForms') || perms.can('manageFields')

  const rs = useRecordStore.getState()
  const onUpdateRecord = (id: string, patch: Record<string, unknown>) => {
    const res = rs.update(id, patch, { validate: true })
    if (res?.errors) toast.error('Could not update', Object.values(res.errors)[0])
  }

  const viewProps: ViewProps = {
    module, records, config, ctx, fields, selected, onSelect: setSelected, onOpen: (id) => showRecord(module.id, id), onConfig: patchConfig, canEdit, canCreate,
    onUpdateRecord, onAdd: (initial) => startNew(module.id, initial),
  }

  const exportRows = async (kind: 'csv' | 'xlsx', which: 'view' | 'all') => {
    const recs = which === 'view' ? records : all
    const rows = recordsToTable(module, recs, ctx, which === 'view' ? fields : module.fields.filter(canSee))
    const base = `${safeFileName(module.name)}-${format(new Date(), 'yyyyMMdd')}`
    if (kind === 'csv') downloadText(toCsv(rows), `${base}.csv`, 'text/csv')
    else downloadBlob(await tableToXlsxBlob([{ name: module.name, rows }]), `${base}.xlsx`)
    toast.success(`Exported ${recs.length} record${recs.length === 1 ? '' : 's'}`)
  }

  const selIds = [...selected]
  const bulkDelete = async () => {
    const ok = await confirmDialog({ title: `Move ${selIds.length} record${selIds.length === 1 ? '' : 's'} to trash?`, message: 'You can restore them from the Trash view.', confirmLabel: 'Move to trash', danger: true })
    if (ok) {
      const r = rs.softDelete(selIds)
      if (!r.ok) return void toast.warning('Not deleted', r.message)
      setSelected(new Set())
      toast.success(r.removed > selIds.length ? `Moved ${r.removed} records to trash (linked records followed)` : 'Moved to trash')
    }
  }
  const bulkPurge = async () => {
    const ok = await confirmDialog({ title: `Permanently delete ${selIds.length} record${selIds.length === 1 ? '' : 's'}?`, message: 'This cannot be undone. Attachments are removed too.', confirmLabel: 'Delete forever', danger: true, requireText: selIds.length > 5 ? 'DELETE' : undefined })
    if (ok) { rs.purge(selIds); setSelected(new Set()); toast.success('Deleted permanently') }
  }

  const groupable = module.fields.filter((f) => !['password', 'file', 'image', 'document', 'signature', 'longText', 'address'].includes(f.type))
  const kanbanGroupable = module.fields.filter((f) => f.type === 'dropdown' || f.type === 'radio')
  const dateFields = module.fields.filter((f) => f.type === 'date' || f.type === 'datetime')
  const activeFilters = config.filters.filter((f) => f.fieldId).length

  const View = { table: TableView, kanban: KanbanView, list: ListView, calendar: CalendarView, timeline: TimelineView, gallery: GalleryView, card: CardView }[viewType]

  return (
    <div className="space-y-3">
      {/* view tabs */}
      <div className="scroll-thin flex items-center gap-1 overflow-x-auto border-b border-line">
        {views.map((v) => {
          const t = VIEW_TYPES.find((x) => x.id === v.type)
          const on = v.id === active?.id
          return (
            <div key={v.id} className={cn('-mb-px flex shrink-0 items-center rounded-t-lg border-b-2', on ? 'border-primary' : 'border-transparent')}>
              <button type="button" onClick={() => setViewId(v.id)} className={cn('flex items-center gap-1.5 px-2.5 py-2 text-[13px] font-medium', on ? 'text-primary' : 'text-muted hover:text-fg')}>
                <Icon name={t?.icon} size={14} /> {v.name}
              </button>
              {on && (
                <Menu
                  items={[
                    { label: 'Rename', icon: 'Pencil', disabled: !canManageViews, onClick: () => setRenameView(v) },
                    { label: 'Duplicate', icon: 'Copy', disabled: !canManageViews, onClick: () => { const c = { ...structuredClone(v), id: uid('view'), name: `${v.name} (copy)`, order: views.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; useViewStore.getState().add(c); setViewId(c.id); toast.success('View duplicated') } },
                    { label: 'Share config (JSON)', icon: 'Share2', onClick: () => setShare(v) },
                    { divider: true },
                    { label: 'Delete view', icon: 'Trash2', danger: true, disabled: !canManageViews || views.length <= 1, onClick: async () => { if (await confirmDialog({ title: `Delete view "${v.name}"?`, message: 'Records are not affected.', confirmLabel: 'Delete', danger: true })) { useViewStore.getState().remove(v.id); setViewId(null) } } },
                  ]}
                  trigger={({ toggle, ref }) => <button ref={ref} type="button" aria-label="View options" onClick={toggle} className="mr-1 rounded p-1 text-muted hover:bg-subtle"><Icon name="ChevronDownSquare" size={12} /></button>}
                />
              )}
            </div>
          )
        })}
        {canManageViews && <Button size="xs" variant="ghost" className="shrink-0" onClick={() => setAddView(true)}><Plus size={13} /> View</Button>}
        {virtual && <span className="px-2 text-xs text-muted">Default view</span>}
      </div>

      {/* toolbar */}
      {!hideHeader && (
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder={`Search ${module.name.toLowerCase()}…`} className="w-full sm:w-60" />
          <Popover
            trigger={({ toggle, ref }) => <Button ref={ref} size="sm" variant={activeFilters ? 'soft' : 'secondary'} onClick={toggle}><FilterIcon size={14} /> Filter{activeFilters ? ` · ${activeFilters}` : ''}</Button>}
          >
            {() => <FilterEditor module={module} filters={config.filters} onChange={(filters) => patchConfig({ filters })} />}
          </Popover>
          <Popover trigger={({ toggle, ref }) => <Button ref={ref} size="sm" variant={config.sorts.length ? 'soft' : 'secondary'} onClick={toggle}><ArrowUpDown size={14} /> Sort{config.sorts.length ? ` · ${config.sorts.length}` : ''}</Button>}>
            {() => <SortEditor module={module} sorts={config.sorts} onChange={(sorts) => patchConfig({ sorts })} />}
          </Popover>
          <Popover width={240} trigger={({ toggle, ref }) => <Button ref={ref} size="sm" variant={config.groupBy ? 'soft' : 'secondary'} onClick={toggle}><Layers size={14} /> Group{config.groupBy ? `: ${module.fields.find((f) => f.id === config.groupBy)?.label ?? ''}` : ''}</Button>}>
            {(close) => (
              <div>
                <button type="button" onClick={() => { patchConfig({ groupBy: undefined }); close() }} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle">No grouping</button>
                {(viewType === 'kanban' ? kanbanGroupable : groupable).map((f) => (
                  <button key={f.id} type="button" onClick={() => { patchConfig({ groupBy: f.id }); close() }} className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle', config.groupBy === f.id && 'text-primary')}>
                    {f.label} {config.groupBy === f.id && <Icon name="Check" size={13} className="ml-auto" />}
                  </button>
                ))}
                {viewType === 'kanban' && kanbanGroupable.length === 0 && <p className="px-2.5 py-2 text-xs text-muted">Add a Dropdown field to group a board.</p>}
              </div>
            )}
          </Popover>
          <Popover width={240} trigger={({ toggle, ref }) => <Button ref={ref} size="sm" variant={config.hiddenFieldIds.length ? 'soft' : 'secondary'} onClick={toggle}><Columns3 size={14} /> Fields{config.hiddenFieldIds.length ? ` · ${module.fields.length - config.hiddenFieldIds.length}/${module.fields.length}` : ''}</Button>}>
            {() => (
              <div className="space-y-0.5 p-1">
                {module.fields.filter((f) => f.type !== 'password' && canSee(f)).map((f) => (
                  <div key={f.id} className="rounded-lg px-1.5 py-1 hover:bg-subtle">
                    <Checkbox checked={!config.hiddenFieldIds.includes(f.id)} onChange={(v) => patchConfig({ hiddenFieldIds: v ? config.hiddenFieldIds.filter((x) => x !== f.id) : [...config.hiddenFieldIds, f.id] })} label={f.label} />
                  </div>
                ))}
                <div className="flex justify-between pt-1"><Button size="xs" variant="ghost" onClick={() => patchConfig({ hiddenFieldIds: [] })}>Show all</Button><Button size="xs" variant="ghost" onClick={() => patchConfig({ hiddenFieldIds: module.fields.slice(1).map((f) => f.id) })}>Hide all</Button></div>
              </div>
            )}
          </Popover>
          {(viewType === 'calendar' || viewType === 'timeline' || viewType === 'gallery') && (
            <Popover width={260} trigger={({ toggle, ref }) => <Button ref={ref} size="sm" onClick={toggle}><Settings2 size={14} /> View settings</Button>}>
              {() => (
                <div className="space-y-3 p-2">
                  {(viewType === 'calendar' || viewType === 'timeline') && (
                    <FormField label={viewType === 'timeline' ? 'Start date field' : 'Date field'}>
                      <Select value={config.dateFieldId ?? ''} onChange={(e) => patchConfig({ dateFieldId: e.target.value || undefined })}><option value="">Choose…</option>{dateFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
                    </FormField>
                  )}
                  {viewType === 'timeline' && (
                    <FormField label="End date field">
                      <Select value={config.endDateFieldId ?? ''} onChange={(e) => patchConfig({ endDateFieldId: e.target.value || undefined })}><option value="">Same as start</option>{dateFields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
                    </FormField>
                  )}
                  {viewType === 'gallery' && (
                    <FormField label="Cover image field">
                      <Select value={config.imageFieldId ?? ''} onChange={(e) => patchConfig({ imageFieldId: e.target.value || undefined })}><option value="">Choose…</option>{module.fields.filter((f) => f.type === 'image').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select>
                    </FormField>
                  )}
                </div>
              )}
            </Popover>
          )}
          {dirty && (
            <>
              <Button size="sm" variant="primary" onClick={saveView} disabled={!canManageViews && !virtual} title={!canManageViews ? 'Your role cannot save views' : undefined}>Save view</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}><X size={13} /> Reset</Button>
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Segmented<Scope> value={scope} onChange={setScope} options={[{ id: 'active', label: 'Active' }, { id: 'archived', label: 'Archived' }, { id: 'trash', label: `Trash${trashed.length ? ` (${trashed.length})` : ''}` }]} />
            {canCreate && <Button size="sm" icon="Upload" onClick={() => setImportOpen(true)}>Import</Button>}
            {canExport && (
              <Menu
                items={[
                  { label: 'CSV — current view', icon: 'Download', onClick: () => void exportRows('csv', 'view') },
                  { label: 'Excel — current view', icon: 'Download', onClick: () => void exportRows('xlsx', 'view') },
                  { divider: true },
                  { label: 'CSV — all records', icon: 'Download', onClick: () => void exportRows('csv', 'all') },
                  { label: 'Excel — all records', icon: 'Download', onClick: () => void exportRows('xlsx', 'all') },
                ]}
                width={230}
                trigger={({ toggle, ref }) => <Button ref={ref} size="sm" onClick={toggle}><Download size={14} /> Export</Button>}
              />
            )}
            {canCreate && <Button size="sm" variant="gradient" icon="Plus" onClick={() => startNew(module.id)}>Add record</Button>}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[13px]">
          <strong>{selected.size} selected</strong>
          {scope === 'trash' ? (
            <>
              <Button size="xs" icon="RotateCcw" onClick={() => { rs.restore(selIds); setSelected(new Set()); toast.success('Restored') }}>Restore</Button>
              <Button size="xs" variant="danger" disabled={!canDelete} onClick={() => void bulkPurge()}>Delete forever</Button>
            </>
          ) : (
            <>
              <Button size="xs" disabled={!canEdit} onClick={() => setBulkOpen(true)}><ListFilter size={12} /> Bulk edit</Button>
              <Button size="xs" disabled={!canEdit} onClick={() => { rs.archive(selIds, scope !== 'archived'); setSelected(new Set()); toast.success(scope === 'archived' ? 'Unarchived' : 'Archived') }}>{scope === 'archived' ? 'Unarchive' : 'Archive'}</Button>
              <Button size="xs" variant="danger" disabled={!canDelete} onClick={() => void bulkDelete()}>Delete</Button>
            </>
          )}
          <button type="button" className="ml-auto text-xs text-muted hover:text-fg" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      )}

      {records.length === 0 ? (
        scope === 'trash' ? <EmptyState icon="Trash2" title="Trash is empty" description="Deleted records wait here until you restore or permanently delete them." />
        : scope === 'archived' ? <EmptyState icon="Archive" title="No archived records" description="Archive records you no longer need day-to-day. They stay searchable here." />
        : all.length === 0 ? <EmptyState icon={module.icon} title={`No ${module.name.toLowerCase()} yet`} description="Add your first record, import a spreadsheet, or collect entries with a form." action={canCreate ? <><Button variant="primary" icon="Plus" onClick={() => startNew(module.id)}>Add record</Button><Button icon="Upload" onClick={() => setImportOpen(true)}>Import CSV / Excel</Button></> : undefined} />
        : <EmptyState icon="SearchX" title="No records match" description="Try clearing the search or filters." action={<Button onClick={() => { setSearch(''); patchConfig({ filters: [] }) }}>Clear search & filters</Button>} />
      ) : (
        <View {...viewProps} />
      )}
      <div className="text-xs text-muted">{records.length} record{records.length === 1 ? '' : 's'}{records.length !== pool.length ? ` of ${pool.length}` : ''}</div>

      <ImportWizard module={module} open={importOpen} onClose={() => setImportOpen(false)} />
      <BulkEditModal module={module} open={bulkOpen} ids={selIds} onClose={() => setBulkOpen(false)} onDone={() => setSelected(new Set())} />
      <NewViewDialog open={addView} onClose={() => setAddView(false)} module={module} count={views.length} onCreated={(id) => setViewId(id)} />
      <NameDialog open={!!renameView} title="Rename view" label="View name" initial={renameView?.name} onClose={() => setRenameView(null)} onSubmit={(name) => renameView && useViewStore.getState().update(renameView.id, { name })} />
      {share && <ShareViewModal view={share} onClose={() => setShare(null)} config={share.id === active?.id ? config : share.config} onApply={(cfg, type) => { useViewStore.getState().update(share.id, { config: cfg, type }); setDraft(null); setShare(null); toast.success('View config applied') }} />}
    </div>
  )
}

export function NewViewDialog({ open, onClose, module, count, onCreated }: { open: boolean; onClose: () => void; module: Module; count: number; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ViewType>('kanban')
  const ws = useWsId()
  useEffect(() => { if (open) { setName(''); setType('kanban') } }, [open])
  const create = () => {
    const label = name.trim() || VIEW_TYPES.find((t) => t.id === type)?.label || 'View'
    const v = newView(ws, module, label, type, undefined, count)
    useViewStore.getState().add(v)
    onCreated(v.id)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="New view" description="Views show the same records in different ways." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create}>Create view</Button></>}>
      <div className="space-y-4">
        <FormField label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pipeline board" onKeyDown={(e) => e.key === 'Enter' && create()} /></FormField>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {VIEW_TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => setType(t.id)} className={cn('rounded-xl border p-3 text-left transition hover:bg-subtle', type === t.id ? 'border-primary bg-primary/5' : 'border-line')}>
              <Icon name={t.icon} size={18} className={type === t.id ? 'text-primary' : 'text-muted'} />
              <div className="mt-1.5 text-[13px] font-semibold">{t.label}</div>
              <div className="text-[11px] text-muted">{t.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export function ShareViewModal({ view, config, onClose, onApply }: { view: View; config: ViewConfig; onClose: () => void; onApply: (c: ViewConfig, t: ViewType) => void }) {
  const json = JSON.stringify({ xcrmView: 1, name: view.name, type: view.type, config }, null, 2)
  const [text, setText] = useState(json)
  const [err, setErr] = useState('')
  const apply = () => {
    try {
      const parsed = viewShareSchema.parse(JSON.parse(text))
      onApply({ ...emptyViewConfig(), ...parsed.config } as ViewConfig, parsed.type)
    } catch (e) {
      setErr(e instanceof z.ZodError ? (e.issues[0]?.message ?? 'Invalid view config') : 'That is not valid JSON')
    }
  }
  return (
    <Modal open onClose={onClose} title={`Share “${view.name}”`} description="Copy this JSON to share the view setup. Paste JSON from another view and apply it here." size="lg" footer={<><Button onClick={() => void copyText(text).then((ok) => (ok ? toast.success('Copied to clipboard') : toast.error('Could not copy', 'Select the text and copy it manually.')))}><Share2 size={14} /> Copy JSON</Button><Button variant="primary" onClick={apply}><Upload size={14} /> Apply to this view</Button></>}>
      <Textarea value={text} onChange={(e) => { setText(e.target.value); setErr('') }} className="min-h-[300px] font-mono text-xs" spellCheck={false} aria-label="View config JSON" />
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      <p className="mt-2 text-xs text-muted">Field ids are module-specific, so shared configs work best between views of the same module or duplicated modules.</p>
    </Modal>
  )
}

function BulkEditModal({ module, open, ids, onClose, onDone }: { module: Module; open: boolean; ids: string[]; onClose: () => void; onDone: () => void }) {
  const editable = module.fields.filter((f) => !['formula', 'autoId', 'password', 'signature', 'file', 'image', 'document'].includes(f.type) && !f.unique)
  const [fieldId, setFieldId] = useState('')
  const [value, setValue] = useState<unknown>('')
  useEffect(() => { if (open) { setFieldId(editable[0]?.id ?? ''); setValue('') } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const field = editable.find((f) => f.id === fieldId)
  const apply = () => {
    if (!field) return
    let errors = 0
    for (const id of ids) {
      const res = useRecordStore.getState().update(id, { [field.id]: value }, { validate: true })
      if (res?.errors) errors++
    }
    if (errors) toast.warning(`${ids.length - errors} updated, ${errors} skipped`, 'Some records failed validation for this value.')
    else toast.success(`Updated ${ids.length} record${ids.length === 1 ? '' : 's'}`)
    onDone()
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={`Bulk edit ${ids.length} record${ids.length === 1 ? '' : 's'}`} size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={apply} disabled={!field}>Apply to {ids.length}</Button></>}>
      <div className="space-y-4">
        <FormField label="Field to change"><Select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setValue('') }}>{editable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></FormField>
        {field && <FormField label="New value" hint="Leave empty to clear the field."><FieldInput field={{ ...field, readOnly: false }} value={value} onChange={setValue} ownerModuleId={module.id} /></FormField>}
      </div>
    </Modal>
  )
}
