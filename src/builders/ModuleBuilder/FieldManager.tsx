import { useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Copy, GripVertical, Pencil, Trash2 } from 'lucide-react'
import type { Field, Module } from '#/types'
import { FIELD_TYPES, FIELD_TYPE_MAP, createField } from '#/utils/fieldTypes'
import { useModuleStore } from '#/stores/moduleStore'
import { usePerms } from '#/hooks/useData'
import { removeFieldCascade } from '#/services/moduleService'
import { confirmDialog, toast } from '#/utils/toast'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Badge, EmptyState } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { FieldConfigPanel } from './FieldConfigPanel'

function Row({ field, module, canManage, onEdit, onDup, onDelete }: { field: Field; module: Module; canManage: boolean; onEdit: () => void; onDup: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, disabled: !canManage })
  const def = FIELD_TYPE_MAP[field.type]
  const isTitle = module.titleFieldId === field.id
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5', isDragging && 'opacity-60 shadow-lg')}>
      {canManage && <button type="button" aria-label={`Reorder ${field.label}`} className="cursor-grab touch-none text-muted/60 hover:text-fg" {...attributes} {...listeners}><GripVertical size={16} /></button>}
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={def.icon} size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{field.label}</span>
          {field.required && <Badge color="#EF4444">Required</Badge>}
          {field.unique && <Badge color="#3B9DF8">Unique</Badge>}
          {field.condition && <Badge color="#F5A524">Conditional</Badge>}
          {field.permissions && <Badge color="#A855F7">Restricted</Badge>}
          {isTitle && <Badge color="#2DB67D">Record title</Badge>}
        </div>
        <div className="text-xs text-muted">{def.label} · <code>{field.name}</code>{field.type === 'formula' && field.formula ? ` · ${field.formula}` : ''}</div>
      </div>
      {canManage && (
        <div className="flex shrink-0 items-center">
          <button type="button" aria-label={`Edit ${field.label}`} onClick={onEdit} className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg"><Pencil size={14} /></button>
          <button type="button" aria-label={`Duplicate ${field.label}`} onClick={onDup} className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg"><Copy size={14} /></button>
          <button type="button" aria-label={`Delete ${field.label}`} onClick={onDelete} className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  )
}

export function FieldManager({ module }: { module: Module }) {
  const perms = usePerms()
  const canManage = perms.can('manageFields')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [picker, setPicker] = useState(false)
  const [editing, setEditing] = useState<{ field: Field; isNew: boolean } | null>(null)
  const ms = useModuleStore.getState()

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = module.fields.map((f) => f.id)
    ms.reorderFields(module.id, arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }

  const del = async (f: Field) => {
    const ok = await confirmDialog({ title: `Delete field “${f.label}”?`, message: 'The field is removed from the module, its forms and views. Values already entered stay in the records but are no longer shown.', confirmLabel: 'Delete field', danger: true })
    if (ok) {
      removeFieldCascade(module.id, f.id)
      toast.success('Field deleted')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{module.fields.length} field{module.fields.length === 1 ? '' : 's'} · drag to reorder</p>
        <div className="flex items-center gap-2">
          {module.fields.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Record title
              <select aria-label="Record title field" disabled={!canManage} value={module.titleFieldId ?? ''} onChange={(e) => ms.update(module.id, { titleFieldId: e.target.value || undefined })} className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-fg">
                <option value="">Automatic</option>
                {module.fields.filter((f) => !['password', 'signature', 'file', 'image', 'document'].includes(f.type)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
          )}
          {canManage && <Button size="sm" variant="primary" icon="Plus" onClick={() => setPicker(true)}>Add field</Button>}
        </div>
      </div>

      {module.fields.length === 0 ? (
        <EmptyState icon="Rows3" title="No fields yet" description="Fields define what you track for each record — text, numbers, dates, dropdowns, relationships and more." action={canManage ? <Button variant="primary" icon="Plus" onClick={() => setPicker(true)}>Add first field</Button> : undefined} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={module.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {module.fields.map((f) => (
                <Row key={f.id} field={f} module={module} canManage={canManage} onEdit={() => setEditing({ field: f, isNew: false })} onDup={() => { ms.duplicateField(module.id, f.id); toast.success('Field duplicated') }} onDelete={() => void del(f)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {!canManage && <p className="text-xs text-muted">Your current role cannot manage fields.</p>}

      <Modal open={picker} onClose={() => setPicker(false)} size="lg" title="Choose a field type">
        <div className="space-y-5">
          {(['Text', 'Numbers', 'Date & time', 'Choice', 'Media', 'Advanced'] as const).map((g) => (
            <div key={g}>
              <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{g}</h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FIELD_TYPES.filter((t) => t.group === g).map((t) => (
                  <button key={t.type} type="button" onClick={() => { setPicker(false); setEditing({ field: createField(t.type, module.fields.length), isNew: true }) }} className="flex items-center gap-2.5 rounded-xl border border-line p-2.5 text-left transition hover:border-primary/50 hover:bg-primary/5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={t.icon} size={15} /></span>
                    <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{t.label}</span><span className="block truncate text-[11px] text-muted">{t.hint}</span></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {editing && (
        <FieldConfigPanel
          module={module}
          field={editing.field}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            if (editing.isNew) ms.addField(module.id, f)
            else ms.updateField(module.id, f.id, f)
            toast.success(editing.isNew ? 'Field added' : 'Field saved')
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
