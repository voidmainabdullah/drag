import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Download, Trash2 } from 'lucide-react'
import type { Field, Module } from '#/types'
import { useActivities, useAllModules, useCtx, useForms, usePerms, useRecords, useViews } from '#/hooks/useData'
import { useModuleStore } from '#/stores/moduleStore'
import { useViewStore } from '#/stores/collections'
import { useRecordStore } from '#/stores/recordStore'
import { useSelectionStore } from '#/stores/selectionStore'
import { useUiStore } from '#/stores/uiStore'
import { createForm, deleteForm, duplicateForm } from '#/services/formService'
import { saveFile } from '#/services/storage/fileStorage'
import { openStoredFile } from '#/hooks/useFileUrl'
import { createField, formatBytes } from '#/utils/fieldTypes'
import { recordTitle } from '#/utils/records'
import { confirmDialog, toast } from '#/utils/toast'
import { nowIso, uid } from '#/utils/id'
import { Button } from '#/components/ui/Button'
import { Badge, Card, EmptyState } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { Thumb } from '#/components/fields/FileInput'
import { useGo } from '#/components/layout/AppLink'
import { VIEW_TYPES } from '#/components/records/RecordsView'
import { NameDialog } from '#/components/ui/Overlays'
import { FieldConfigPanel } from './FieldConfigPanel'

export function RelationshipsPanel({ module }: { module: Module }) {
  const modules = useAllModules()
  const perms = usePerms()
  const [adding, setAdding] = useState<Field | null>(null)
  const outgoing = module.fields.filter((f) => f.type === 'relationship')
  const incoming = modules.flatMap((m) => m.fields.filter((f) => f.type === 'relationship' && f.relation?.moduleId === module.id && m.id !== module.id).map((f) => ({ m, f })))
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">Relationships are Relationship fields linking records between modules.</p>
        {perms.can('manageFields') && <Button size="sm" variant="primary" icon="Plus" onClick={() => setAdding(createField('relationship', module.fields.length, 'Related record'))}>Add relationship</Button>}
      </div>
      <section>
        <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">This module links to</h4>
        {outgoing.length === 0 ? <EmptyState icon="Link2" title="No outgoing relationships" description="Add a relationship to link this module’s records to another module." /> : (
          <div className="space-y-2">
            {outgoing.map((f) => {
              const t = modules.find((m) => m.id === f.relation?.moduleId)
              return (
                <Card key={f.id} className="flex items-center gap-3 p-3">
                  <Icon name="Link2" size={16} className="text-primary" />
                  <div className="min-w-0 flex-1 text-sm"><strong>{f.label}</strong> → {t?.name ?? <span className="text-danger">missing module</span>}</div>
                  <Badge>{f.relation?.cardinality.replace(/-/g, ' ')}</Badge>
                  {f.relation?.lookupFieldId && <Badge color="#7B68EE">lookup: {t?.fields.find((x) => x.id === f.relation!.lookupFieldId)?.label}</Badge>}
                </Card>
              )
            })}
          </div>
        )}
      </section>
      <section>
        <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Linked from other modules</h4>
        {incoming.length === 0 ? <p className="text-sm text-muted">No other module links here yet.</p> : (
          <div className="space-y-2">{incoming.map(({ m, f }) => <Card key={m.id + f.id} className="flex items-center gap-3 p-3 text-sm"><Icon name={m.icon} size={16} className="text-muted" /><span className="flex-1"><strong>{m.name}</strong> via “{f.label}”</span><Badge>{f.relation?.cardinality.replace(/-/g, ' ')}</Badge></Card>)}</div>
        )}
      </section>
      {adding && <FieldConfigPanel module={module} field={adding} isNew onClose={() => setAdding(null)} onSave={(f) => { useModuleStore.getState().addField(module.id, f); toast.success('Relationship added'); setAdding(null) }} />}
    </div>
  )
}

export function FormsPanel({ module }: { module: Module }) {
  const forms = useForms(module.id)
  const perms = usePerms()
  const go = useGo()
  const sel = useSelectionStore.getState()
  const open = (formId: string) => { sel.set({ moduleId: module.id, formId }); go('/forms') }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">Forms decide which fields appear when records are created. A module can have many forms.</p>
        {perms.can('manageForms') && <Button size="sm" variant="primary" icon="Plus" onClick={() => open(createForm(module).id)}>New form</Button>}
      </div>
      {forms.length === 0 ? <EmptyState icon="FormInput" title="No forms" description="Create a form to design the entry experience for this module." /> : forms.map((f) => (
        <Card key={f.id} className="flex flex-wrap items-center gap-3 p-3">
          <Icon name="FormInput" size={16} className="text-primary" />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{f.name}</div><div className="text-xs text-muted">{f.sections.reduce((n, s) => n + s.items.length, 0)} fields · {f.sections.length} section(s){f.public.enabled ? ' · public' : ''}</div></div>
          <Button size="xs" onClick={() => open(f.id)}>Open builder</Button>
          {perms.can('manageForms') && <Button size="xs" onClick={() => { const c = duplicateForm(f.id); if (c) toast.success('Form duplicated') }}>Duplicate</Button>}
          {perms.can('manageForms') && <Button size="xs" variant="ghost" disabled={forms.length <= 1} onClick={async () => { if (await confirmDialog({ title: `Delete form “${f.name}”?`, message: 'Records created through it are kept.', confirmLabel: 'Delete', danger: true })) deleteForm(f.id) }}><Trash2 size={13} /></Button>}
        </Card>
      ))}
    </div>
  )
}

export function ViewsPanel({ module }: { module: Module }) {
  const views = useViews(module.id)
  const perms = usePerms()
  const go = useGo()
  const [rename, setRename] = useState<string | null>(null)
  const canManage = perms.can('manageForms') || perms.can('manageFields')
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">Saved views show the same records as a table, board, calendar and more.</p>
        <Button size="sm" variant="primary" icon="Table2" onClick={() => { useSelectionStore.getState().set({ moduleId: module.id }); go('/views') }}>Open view builder</Button>
      </div>
      {views.map((v) => (
        <Card key={v.id} className="flex flex-wrap items-center gap-3 p-3">
          <Icon name={VIEW_TYPES.find((t) => t.id === v.type)?.icon} size={16} className="text-primary" />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{v.name}</div><div className="text-xs text-muted">{VIEW_TYPES.find((t) => t.id === v.type)?.label} · {v.config.filters.length} filter(s) · {v.config.sorts.length} sort(s)</div></div>
          {canManage && <Button size="xs" onClick={() => setRename(v.id)}>Rename</Button>}
          {canManage && <Button size="xs" onClick={() => { const t = nowIso(); useViewStore.getState().add({ ...structuredClone(v), id: uid('view'), name: `${v.name} (copy)`, order: views.length, createdAt: t, updatedAt: t }); toast.success('View duplicated') }}>Duplicate</Button>}
          {canManage && <Button size="xs" variant="ghost" disabled={views.length <= 1} onClick={async () => { if (await confirmDialog({ title: `Delete view “${v.name}”?`, confirmLabel: 'Delete', danger: true })) useViewStore.getState().remove(v.id) }}><Trash2 size={13} /></Button>}
        </Card>
      ))}
      <NameDialog open={!!rename} title="Rename view" label="View name" initial={views.find((v) => v.id === rename)?.name} onClose={() => setRename(null)} onSubmit={(n) => rename && useViewStore.getState().update(rename, { name: n })} />
    </div>
  )
}

export function ActivityPanel({ module }: { module: Module }) {
  const acts = useActivities()
  const ctx = useCtx()
  const list = useMemo(() => acts.filter((a) => a.moduleId === module.id).slice(0, 150), [acts, module.id])
  if (!list.length) return <EmptyState icon="History" title="No activity yet" description="Record, field and form changes in this module are logged here." />
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {list.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary" />
          <div className="text-sm">{a.description}</div>
          <div className="text-xs text-muted">{format(new Date(a.timestamp), 'MMM d, yyyy HH:mm')} · {ctx.users.get(a.userId ?? '')?.name ?? 'System'}</div>
        </li>
      ))}
    </ol>
  )
}

export function AttachmentsPanel({ module }: { module: Module }) {
  const records = useRecords(module.id)
  const ctx = useCtx()
  const perms = usePerms()
  const showRecord = useUiStore((s) => s.showRecord)
  const ref = useRef<HTMLInputElement | null>(null)
  const [target, setTarget] = useState('')
  const items = useMemo(() => {
    const out: { recordId: string; title: string; file: { id: string; name: string; size: number; type: string }; field?: string }[] = []
    for (const r of records) {
      for (const a of r.attachments ?? []) out.push({ recordId: r.id, title: recordTitle(module, r, ctx), file: a })
      for (const f of module.fields) if (['file', 'image', 'document'].includes(f.type) && Array.isArray(r.data[f.id])) for (const a of r.data[f.id] as typeof out[number]['file'][]) out.push({ recordId: r.id, title: recordTitle(module, r, ctx), file: a, field: f.label })
    }
    return out
  }, [records, module, ctx])

  const upload = async (list: FileList | null) => {
    if (!list || !target) return
    for (const f of Array.from(list)) { const meta = await saveFile(f); if (meta) useRecordStore.getState().addAttachment(target, meta) }
    if (ref.current) ref.current.value = ''
    toast.success('Attached')
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-[13px] text-muted">All files attached to {module.name} records (stored in this browser).</p>
        {perms.canModule(module, 'edit') && records.length > 0 && (
          <>
            <select aria-label="Record to attach to" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 max-w-[200px] rounded-lg border border-line bg-surface px-2 text-xs"><option value="">Attach to record…</option>{records.slice(0, 200).map((r) => <option key={r.id} value={r.id}>{recordTitle(module, r, ctx)}</option>)}</select>
            <input ref={ref} type="file" multiple className="hidden" aria-label="Attach files" onChange={(e) => void upload(e.target.files)} />
            <Button size="sm" disabled={!target} onClick={() => ref.current?.click()}>Upload</Button>
          </>
        )}
      </div>
      {items.length === 0 ? <EmptyState icon="Paperclip" title="No attachments" description="Open a record and use the Attachments tab, or add file fields to this module." /> : (
        <ul className="space-y-1.5">
          {items.map((i, idx) => (
            <li key={i.file.id + idx} className="flex items-center gap-3 rounded-lg border border-line p-2">
              <Thumb file={i.file} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{i.file.name}</div><div className="text-xs text-muted">{formatBytes(i.file.size)}{i.field ? ` · ${i.field}` : ''} · <button type="button" className="text-primary hover:underline" onClick={() => showRecord(module.id, i.recordId)}>{i.title}</button></div></div>
              <Button size="xs" onClick={() => void openStoredFile(i.file.id, i.file.name, true)}><Download size={12} /> Download</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
