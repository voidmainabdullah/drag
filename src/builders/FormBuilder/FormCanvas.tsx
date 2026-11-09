import { useMemo, useState } from 'react'
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Copy, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Field, FieldType, Form, FormSection, Module } from '#/types'
import { useFormStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { FIELD_TYPES, FIELD_TYPE_MAP, createField } from '#/utils/fieldTypes'
import { isAutoField } from '#/services/defaults'
import { cn, uid } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import { Button } from '#/components/ui/Button'
import { Segmented, EmptyState } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { Input } from '#/components/ui/controls'
import { FieldConfigPanel } from '#/builders/ModuleBuilder/FieldConfigPanel'

type Target = { sectionId: string; index: number }

function PaletteItem({ id, label, icon, hint, onAdd }: { id: string; label: string; icon: string; hint?: string; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return (
    <div ref={setNodeRef} className={cn('group flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] hover:border-primary/50', isDragging && 'opacity-40')}>
      <button type="button" aria-label={`Drag ${label}`} className="cursor-grab touch-none text-muted/60 hover:text-fg" {...attributes} {...listeners}><GripVertical size={14} /></button>
      <Icon name={icon} size={14} className="text-primary" />
      <span className="min-w-0 flex-1 truncate" title={hint}>{label}</span>
      <button type="button" aria-label={`Add ${label} to form`} onClick={onAdd} className="rounded p-0.5 text-muted hover:bg-primary/10 hover:text-primary"><Plus size={14} /></button>
    </div>
  )
}

function CanvasItem({ field, columns, onEdit, onDuplicate, onRemove, onWidth }: { field: Field; columns: number; onEdit: () => void; onDuplicate: () => void; onRemove: () => void; onWidth: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `item:${field.id}` })
  const def = FIELD_TYPE_MAP[field.type]
  const full = field.width === 'full' || columns === 1
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-2', full && columns > 1 && (columns === 2 ? 'sm:col-span-2' : 'sm:col-span-3'), isDragging && 'opacity-50 shadow-lg')}>
      <button type="button" aria-label={`Reorder ${field.label}`} className="cursor-grab touch-none text-muted/60 hover:text-fg" {...attributes} {...listeners}><GripVertical size={15} /></button>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon name={def.icon} size={14} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{field.label}{field.required && <span className="ml-0.5 text-danger">*</span>}</div>
        <div className="truncate text-[11px] text-muted">{def.label}</div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition group-focus-within:opacity-100 group-hover:opacity-100">
        {columns > 1 && <button type="button" onClick={onWidth} title={field.width === 'full' ? 'Full width — click for half' : 'Half width — click for full'} className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:bg-subtle hover:text-fg">{field.width === 'full' ? 'FULL' : 'HALF'}</button>}
        <button type="button" aria-label={`Edit ${field.label}`} title="Edit field" onClick={onEdit} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg"><Pencil size={13} /></button>
        <button type="button" aria-label={`Duplicate ${field.label}`} title="Duplicate field" onClick={onDuplicate} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg"><Copy size={13} /></button>
        <button type="button" aria-label={`Remove ${field.label} from form`} title="Remove from form" onClick={onRemove} className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"><X size={13} /></button>
      </div>
    </div>
  )
}

function SectionBox({ section, index, total, fields, children, onChange, onMove, onDuplicate, onDelete }: { section: FormSection; index: number; total: number; fields: Field[]; children: React.ReactNode; onChange: (p: Partial<FormSection>) => void; onMove: (d: -1 | 1) => void; onDuplicate: () => void; onDelete: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `sec:${section.id}` })
  return (
    <section className={cn('rounded-xl border bg-subtle/40 p-3 transition', isOver ? 'border-primary' : 'border-line')}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Input aria-label="Section title" value={section.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Section title" className="h-8 max-w-[220px] flex-1 font-medium" />
        <Segmented<'1' | '2' | '3'> value={String(section.columns) as '1' | '2' | '3'} onChange={(v) => onChange({ columns: Number(v) as 1 | 2 | 3 })} options={[{ id: '1', label: '1 col' }, { id: '2', label: '2 col' }, { id: '3', label: '3 col' }]} />
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => onMove(-1)} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30"><ArrowUp size={14} /></button>
          <button type="button" aria-label="Move section down" disabled={index === total - 1} onClick={() => onMove(1)} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30"><ArrowDown size={14} /></button>
          <button type="button" aria-label="Duplicate section" title="Duplicate section (copies its fields)" onClick={onDuplicate} className="rounded p-1.5 text-muted hover:bg-subtle"><Copy size={14} /></button>
          <button type="button" aria-label="Delete section" disabled={total <= 1} onClick={onDelete} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
        </div>
      </div>
      <Input aria-label="Section description" value={section.description ?? ''} onChange={(e) => onChange({ description: e.target.value || undefined })} placeholder="Optional description" className="mb-2 h-7 text-xs" />
      <div ref={setNodeRef} className="min-h-[56px]">
        <SortableContext items={section.items.map((i) => `item:${i.fieldId}`)} strategy={verticalListSortingStrategy}>
          <div className={cn('grid grid-cols-1 gap-2', section.columns === 2 && 'sm:grid-cols-2', section.columns === 3 && 'sm:grid-cols-3')}>{children}</div>
        </SortableContext>
        {fields.length === 0 && <div className="rounded-lg border border-dashed border-line py-5 text-center text-xs text-muted">Drag fields here, or click + in the palette</div>}
      </div>
    </section>
  )
}

export function FormCanvas({ form, module }: { form: Form; module: Module }) {
  const [paletteTab, setPaletteTab] = useState<'existing' | 'new'>('existing')
  const [drag, setDrag] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ field: Field; isNew: boolean; target?: Target } | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const fstore = useFormStore.getState()
  const mstore = useModuleStore.getState()
  const fieldById = useMemo(() => new Map(module.fields.map((f) => [f.id, f])), [module.fields])
  const used = useMemo(() => new Set(form.sections.flatMap((s) => s.items.map((i) => i.fieldId))), [form.sections])
  const available = module.fields.filter((f) => !used.has(f.id) && !isAutoField(f))

  const setSections = (sections: FormSection[]) => fstore.update(form.id, { sections })
  const patchSection = (id: string, p: Partial<FormSection>) => setSections(form.sections.map((s) => (s.id === id ? { ...s, ...p } : s)))
  const insert = (fieldId: string, t: Target) => {
    setSections(form.sections.map((s) => {
      if (s.id !== t.sectionId) return s
      const items = [...s.items]
      items.splice(Math.min(t.index, items.length), 0, { fieldId })
      return { ...s, items }
    }))
  }
  const lastTarget = (): Target => {
    const s = form.sections[form.sections.length - 1]
    return { sectionId: s.id, index: s.items.length }
  }
  const startNewField = (type: FieldType, target: Target) => {
    setEditing({ field: createField(type, module.fields.length), isNew: true, target })
  }

  const parse = (id: string): { kind: string; key: string } => { const i = id.indexOf(':'); const j = id.indexOf(':', i + 1); return id.startsWith('pal:') ? { kind: id.slice(i + 1, j), key: id.slice(j + 1) } : { kind: id.slice(0, i), key: id.slice(i + 1) } }

  const onDragStart = (e: DragStartEvent) => {
    const a = parse(String(e.active.id))
    if (a.kind === 'new') setDrag(FIELD_TYPE_MAP[a.key as FieldType]?.label ?? 'Field')
    else setDrag(fieldById.get(a.key)?.label ?? 'Field')
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDrag(null)
    const { active, over } = e
    if (!over) return
    const a = parse(String(active.id))
    const o = parse(String(over.id))
    let target: Target | null = null
    if (o.kind === 'sec') {
      const s = form.sections.find((x) => x.id === o.key)
      if (s) target = { sectionId: s.id, index: s.items.length }
    } else if (o.kind === 'item') {
      const s = form.sections.find((x) => x.items.some((i) => i.fieldId === o.key))
      if (s) target = { sectionId: s.id, index: s.items.findIndex((i) => i.fieldId === o.key) }
    }
    if (!target) return
    if (a.kind === 'new') return startNewField(a.key as FieldType, target)
    if (a.kind === 'fld') return insert(a.key, target)
    if (a.kind === 'item') {
      if (a.key === o.key) return
      const from = form.sections.find((s) => s.items.some((i) => i.fieldId === a.key))
      if (!from) return
      if (from.id === target.sectionId) {
        const oldIdx = from.items.findIndex((i) => i.fieldId === a.key)
        const items = arrayMove(from.items, oldIdx, Math.min(target.index, from.items.length - 1))
        patchSection(from.id, { items })
      } else {
        setSections(form.sections.map((s) => {
          if (s.id === from.id) return { ...s, items: s.items.filter((i) => i.fieldId !== a.key) }
          if (s.id === target!.sectionId) { const items = [...s.items]; items.splice(target!.index, 0, { fieldId: a.key }); return { ...s, items } }
          return s
        }))
      }
    }
  }

  const removeFromForm = (fieldId: string) => setSections(form.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.fieldId !== fieldId) })))
  const duplicateItem = (sectionId: string, fieldId: string) => {
    const copy = mstore.duplicateField(module.id, fieldId)
    if (!copy) return
    const s = form.sections.find((x) => x.id === sectionId)!
    insert(copy.id, { sectionId, index: s.items.findIndex((i) => i.fieldId === fieldId) + 1 })
    toast.success('Field duplicated', 'A new field was added to the module and this form.')
  }
  const duplicateSection = (s: FormSection) => {
    const items = s.items.map((i) => mstore.duplicateField(module.id, i.fieldId)).filter((f): f is Field => !!f).map((f) => ({ fieldId: f.id }))
    const idx = form.sections.findIndex((x) => x.id === s.id)
    const next = [...form.sections]
    next.splice(idx + 1, 0, { ...s, id: uid('sec'), title: `${s.title || 'Section'} (copy)`, items })
    setSections(next)
  }
  const moveSection = (idx: number, d: -1 | 1) => setSections(arrayMove(form.sections, idx, idx + d))
  const deleteSection = async (s: FormSection) => {
    if (s.items.length && !(await confirmDialog({ title: `Delete section “${s.title || 'Untitled'}”?`, message: 'Its fields stay in the module and return to the palette.', confirmLabel: 'Delete section', danger: true }))) return
    setSections(form.sections.filter((x) => x.id !== s.id))
  }
  const addSection = () => setSections([...form.sections, { id: uid('sec'), title: `Section ${form.sections.length + 1}`, columns: 1, items: [] }])
  const toggleWidth = (f: Field) => mstore.updateField(module.id, f.id, { width: f.width === 'full' ? 'half' : 'full' })

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDrag(null)}>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="rounded-xl border border-line bg-surface p-3 lg:sticky lg:top-2 lg:max-h-[78vh] lg:self-start lg:overflow-y-auto">
          <Segmented<'existing' | 'new'> value={paletteTab} onChange={setPaletteTab} options={[{ id: 'existing', label: `Module fields (${available.length})` }, { id: 'new', label: 'New field' }]} />
          <div className="mt-3 space-y-1.5">
            {paletteTab === 'existing' && (available.length === 0
              ? <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">Every editable field is already on this form. Use “New field” to add more.</p>
              : available.map((f) => <PaletteItem key={f.id} id={`pal:fld:${f.id}`} label={f.label} icon={FIELD_TYPE_MAP[f.type].icon} hint={FIELD_TYPE_MAP[f.type].label} onAdd={() => insert(f.id, lastTarget())} />))}
            {paletteTab === 'new' && FIELD_TYPES.filter((t) => t.type !== 'autoId').map((t) => <PaletteItem key={t.type} id={`pal:new:${t.type}`} label={t.label} icon={t.icon} hint={t.hint} onAdd={() => startNewField(t.type, lastTarget())} />)}
          </div>
          {paletteTab === 'existing' && module.fields.some(isAutoField) && <p className="mt-3 text-[11px] text-muted">Formula and auto-ID fields are filled in automatically, so they can’t be placed on a form.</p>}
        </aside>

        <div className="space-y-3">
          {form.sections.length === 0 && <EmptyState icon="FormInput" title="No sections" description="Add a section, then drag fields into it." />}
          {form.sections.map((s, idx) => {
            const fields = s.items.map((i) => fieldById.get(i.fieldId)).filter((f): f is Field => !!f)
            return (
              <SectionBox key={s.id} section={s} index={idx} total={form.sections.length} fields={fields} onChange={(p) => patchSection(s.id, p)} onMove={(d) => moveSection(idx, d)} onDuplicate={() => duplicateSection(s)} onDelete={() => void deleteSection(s)}>
                {fields.map((f) => <CanvasItem key={f.id} field={f} columns={s.columns} onEdit={() => setEditing({ field: f, isNew: false })} onDuplicate={() => duplicateItem(s.id, f.id)} onRemove={() => removeFromForm(f.id)} onWidth={() => toggleWidth(f)} />)}
              </SectionBox>
            )
          })}
          <Button icon="Plus" onClick={addSection}>Add section</Button>
        </div>
      </div>
      <DragOverlay>{drag ? <div className="rounded-lg border border-primary bg-surface px-3 py-2 text-[13px] font-medium shadow-xl">{drag}</div> : null}</DragOverlay>
      {editing && (
        <FieldConfigPanel
          module={module}
          field={editing.field}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSave={(f) => {
            if (editing.isNew) {
              mstore.addField(module.id, f)
              if (editing.target) insert(f.id, editing.target)
              toast.success('Field added to module and form')
            } else {
              mstore.updateField(module.id, f.id, f)
            }
            setEditing(null)
          }}
        />
      )}
    </DndContext>
  )
}
