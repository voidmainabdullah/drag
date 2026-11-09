import { useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { Download, MoreHorizontal, Star, Trash2 } from 'lucide-react'
import { useUiStore } from '#/stores/uiStore'
import { useRecordStore } from '#/stores/recordStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useActivities, useCtx, useModule, usePerms, useWorkflows, useWsId, useAllModules } from '#/hooks/useData'
import { Drawer } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Menu } from '#/components/ui/Popover'
import { Badge, EmptyState, Notice, Tabs } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { FormRenderer } from '#/components/fields/FormRenderer'
import { FieldValue } from '#/components/fields/FieldValue'
import { Thumb } from '#/components/fields/FileInput'
import { recordTitle, toIds, valueOf } from '#/utils/records'
import { confirmDialog, toast } from '#/utils/toast'
import { formatBytes } from '#/utils/fieldTypes'
import { saveFile } from '#/services/storage/fileStorage'
import { openStoredFile } from '#/hooks/useFileUrl'
import { runWorkflowNow } from '#/services/workflowEngine'

type Tab = 'details' | 'activity' | 'related' | 'files'

export function RecordDrawer() {
  const open = useUiStore((s) => s.openRecord)
  const close = useUiStore((s) => s.closeRecord)
  const module = useModule(open?.moduleId)
  const record = useRecordStore((s) => s.records.find((r) => r.id === open?.recordId))
  const ctx = useCtx()
  const perms = usePerms()
  const ws = useWsId()
  const acts = useActivities()
  const workflows = useWorkflows(open?.moduleId)
  const allModules = useAllModules()
  const favs = useSettingsStore((s) => s.settings.favourites[ws])
  const [tab, setTab] = useState<Tab>('details')
  const [editing, setEditing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setTab('details')
    setEditing(false)
    if (open && module && record) useSettingsStore.getState().addRecent(ws, { moduleId: module.id, recordId: record.id, label: recordTitle(module, record) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.recordId])

  const recActs = useMemo(() => acts.filter((a) => a.recordId === open?.recordId).slice(0, 80), [acts, open?.recordId])
  const incoming = useMemo(() => {
    if (!record) return []
    const out: { moduleName: string; icon: string; moduleId: string; field: string; ids: string[] }[] = []
    for (const m of allModules) {
      for (const f of m.fields) {
        if (f.type !== 'relationship' || f.relation?.moduleId !== record.moduleId) continue
        const ids = [...ctx.records.values()].filter((r) => r.moduleId === m.id && !r.deletedAt && toIds(r.data[f.id]).includes(record.id)).map((r) => r.id)
        if (ids.length) out.push({ moduleName: m.name, icon: m.icon, moduleId: m.id, field: f.label, ids })
      }
    }
    return out
  }, [allModules, record, ctx])

  if (!open) return null
  if (!module || !record) {
    return (
      <Drawer open onClose={close} title="Record not found">
        <div className="p-5"><EmptyState icon="SearchX" title="This record no longer exists" description="It may have been permanently deleted." action={<Button onClick={close}>Close</Button>} /></div>
      </Drawer>
    )
  }

  const rs = useRecordStore.getState()
  const canEdit = perms.canModule(module, 'edit')
  const canDelete = perms.canModule(module, 'delete')
  const isFav = (favs ?? []).some((f) => f.recordId === record.id)
  const title = recordTitle(module, record, ctx)
  const trashed = !!record.deletedAt
  const manual = workflows.filter((w) => w.trigger.type === 'manual' && w.enabled)
  const visibleFields = module.fields.filter((f) => perms.fieldAccess(f) !== 'hidden')

  const del = async () => {
    const ok = await confirmDialog({ title: 'Move to trash?', message: `"${title}" will be moved to the trash. You can restore it from the module's Trash view.`, confirmLabel: 'Move to trash', danger: true })
    if (ok) {
      const r = rs.softDelete([record.id])
      if (!r.ok) return void toast.warning('Not deleted', r.message)
      toast.success(r.removed > 1 ? `Moved ${r.removed} records to trash` : 'Moved to trash')
      close()
    }
  }

  const upload = async (list: FileList | null) => {
    if (!list) return
    for (const f of Array.from(list)) {
      if (f.size > 25 * 1024 * 1024) {
        toast.error('File too large', `${f.name} is over 25 MB.`)
        continue
      }
      const meta = await saveFile(f)
      if (meta) rs.addAttachment(record.id, meta)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Drawer
      open
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${module.color} 16%, transparent)`, color: module.color }}><Icon name={module.icon} size={15} /></span>
          <span className="truncate">{title}</span>
          {record.archived && <Badge>Archived</Badge>}
          {trashed && <Badge color="#EF4444">In trash</Badge>}
        </span>
      }
      subtitle={`${module.name} · created ${format(new Date(record.createdAt), 'MMM d, yyyy')} · updated ${formatDistanceToNow(new Date(record.updatedAt), { addSuffix: true })}`}
      actions={
        <>
          <button type="button" aria-label={isFav ? 'Remove from favourites' : 'Add to favourites'} onClick={() => useSettingsStore.getState().toggleFavourite(ws, { moduleId: module.id, recordId: record.id, label: title })} className="rounded-lg p-1.5 text-muted hover:bg-subtle">
            <Star size={16} className={isFav ? 'fill-warning text-warning' : ''} />
          </button>
          <Menu
            items={[
              { label: 'Edit', icon: 'Pencil', disabled: !canEdit || trashed, onClick: () => { setTab('details'); setEditing(true) } },
              { label: 'Duplicate', icon: 'Copy', disabled: !perms.canModule(module, 'create'), onClick: () => { const c = rs.duplicate(record.id); if (c) { toast.success('Record duplicated'); useUiStore.getState().showRecord(module.id, c.id) } } },
              { label: record.archived ? 'Unarchive' : 'Archive', icon: 'Archive', disabled: !canEdit, onClick: () => { rs.archive([record.id], !record.archived); toast.success(record.archived ? 'Unarchived' : 'Archived') } },
              ...(manual.length ? [{ divider: true }, ...manual.map((w) => ({ label: `Run: ${w.name}`, icon: 'Play', onClick: () => { const r = runWorkflowNow(w, [record.id]); r.ran ? toast.success('Workflow ran', w.name) : toast.info('Workflow did not run', 'Conditions not met — see the run log.') } }))] : []),
              { divider: true },
              { label: 'Move to trash', icon: 'Trash2', danger: true, disabled: !canDelete || trashed, onClick: () => void del() },
            ]}
            trigger={({ toggle, ref }) => (
              <button ref={ref} type="button" aria-label="Record actions" onClick={toggle} className="rounded-lg p-1.5 text-muted hover:bg-subtle"><MoreHorizontal size={16} /></button>
            )}
          />
        </>
      }
    >
      {trashed && (
        <div className="m-4"><Notice tone="warning"><div className="flex items-center justify-between gap-2"><span>This record is in the trash.</span><span className="flex gap-2"><Button size="xs" icon="RotateCcw" onClick={() => { rs.restore([record.id]); toast.success('Restored') }}>Restore</Button><Button size="xs" variant="danger" disabled={!canDelete} onClick={async () => { if (await confirmDialog({ title: 'Delete permanently?', message: 'This cannot be undone.', confirmLabel: 'Delete forever', danger: true })) { rs.purge([record.id]); close() } }}>Delete forever</Button></span></div></Notice></div>
      )}
      <Tabs<Tab> className="px-4" value={tab} onChange={setTab} tabs={[
        { id: 'details', label: 'Details', icon: 'FileText' },
        { id: 'related', label: 'Related', icon: 'Link2', count: incoming.reduce((n, i) => n + i.ids.length, 0) + module.fields.filter((f) => f.type === 'relationship').reduce((n, f) => n + toIds(record.data[f.id]).length, 0) },
        { id: 'files', label: 'Attachments', icon: 'Paperclip', count: (record.attachments ?? []).length },
        { id: 'activity', label: 'History', icon: 'History', count: recActs.length },
      ]} />
      <div className="p-5">
        {tab === 'details' &&
          (editing ? (
            <FormRenderer
              module={module}
              recordId={record.id}
              initial={record.data}
              submitLabel="Save changes"
              onCancel={() => setEditing(false)}
              onSubmit={(data) => {
                const res = rs.update(record.id, data, { validate: true })
                if (res?.record) { toast.success('Changes saved'); setEditing(false) } else if (res?.errors) toast.error('Could not save', Object.values(res.errors)[0])
              }}
            />
          ) : (
            <div className="space-y-4">
              {canEdit && !trashed && <div className="flex justify-end"><Button size="sm" icon="Pencil" onClick={() => setEditing(true)}>Edit record</Button></div>}
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {visibleFields.map((f) => (
                  <div key={f.id} className={f.width === 'full' || f.type === 'longText' || f.type === 'address' || f.type === 'signature' ? 'sm:col-span-2' : ''}>
                    <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">{f.label}</dt>
                    <dd className="text-sm break-words"><FieldValue field={f} value={valueOf(module, record, f, ctx)} ctx={ctx} /></dd>
                  </div>
                ))}
              </dl>
              {record.source && <p className="text-xs text-muted">Submitted through a form.</p>}
            </div>
          ))}

        {tab === 'related' && (
          <div className="space-y-5">
            {module.fields.filter((f) => f.type === 'relationship').map((f) => {
              const target = f.relation ? ctx.modules.get(f.relation.moduleId) : undefined
              const ids = toIds(record.data[f.id])
              return (
                <section key={f.id}>
                  <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{f.label} → {target?.name ?? 'Missing module'}</h4>
                  {ids.length === 0 ? <p className="text-sm text-muted">No linked records. Edit this record to link some.</p> : <LinkedList ids={ids} />}
                </section>
              )
            })}
            {incoming.map((g) => (
              <section key={g.moduleId + g.field}>
                <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{g.moduleName} referencing this record ({g.field})</h4>
                <LinkedList ids={g.ids} />
              </section>
            ))}
            {!module.fields.some((f) => f.type === 'relationship') && incoming.length === 0 && <EmptyState icon="Link2" title="No relationships" description="Add a Relationship field in the module builder to connect this module to others." />}
          </div>
        )}

        {tab === 'files' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-muted">Files are stored in this browser (IndexedDB).</p>
              <>
                <input ref={fileRef} type="file" multiple className="hidden" aria-label="Attach files" onChange={(e) => void upload(e.target.files)} />
                <Button size="sm" icon="Upload" disabled={!canEdit} onClick={() => fileRef.current?.click()}>Attach files</Button>
              </>
            </div>
            {(record.attachments ?? []).length === 0 ? (
              <EmptyState icon="Paperclip" title="No attachments" description="Attach contracts, images or any supporting files to this record." />
            ) : (
              <ul className="space-y-1.5">
                {(record.attachments ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-lg border border-line p-2">
                    <Thumb file={a} />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{a.name}</div><div className="text-xs text-muted">{formatBytes(a.size)}</div></div>
                    <Button size="xs" onClick={() => void openStoredFile(a.id, a.name, true)}><Download size={12} /> Download</Button>
                    <button type="button" aria-label={`Remove ${a.name}`} disabled={!canEdit} onClick={async () => { if (await confirmDialog({ title: 'Remove attachment?', message: a.name, danger: true, confirmLabel: 'Remove' })) rs.removeAttachment(record.id, a.id) }} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'activity' && (
          recActs.length === 0 ? <EmptyState icon="History" title="No history yet" description="Changes to this record will be listed here." /> : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {recActs.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[25px] top-1 size-2.5 rounded-full bg-primary" />
                  <div className="text-sm">{a.description}</div>
                  <div className="text-xs text-muted">{format(new Date(a.timestamp), 'MMM d, yyyy HH:mm')} · {ctx.users.get(a.userId ?? '')?.name ?? 'System'}</div>
                </li>
              ))}
            </ol>
          )
        )}
      </div>
    </Drawer>
  )
}

function LinkedList({ ids }: { ids: string[] }) {
  const ctx = useCtx()
  const show = useUiStore((s) => s.showRecord)
  return (
    <ul className="space-y-1">
      {ids.map((id) => {
        const r = ctx.records.get(id)
        const m = r ? ctx.modules.get(r.moduleId) : undefined
        return (
          <li key={id}>
            <button type="button" disabled={!r || !m} onClick={() => r && m && show(m.id, r.id)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-subtle disabled:opacity-60">
              <Icon name={m?.icon} size={14} className="text-muted" />
              <span className="flex-1 truncate">{r && m ? recordTitle(m, r, ctx) : 'Deleted record'}</span>
              {m && <Badge>{m.name}</Badge>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}