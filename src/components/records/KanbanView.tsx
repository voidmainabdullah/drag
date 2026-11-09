import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { CrmRecord } from '#/types'
import { recordTitle, valueOf } from '#/utils/records'
import { EmptyState } from '#/components/ui/misc'
import { FieldValue } from '#/components/fields/FieldValue'
import { cn } from '#/utils/id'
import type { ViewProps } from './viewTypes'

const NONE = '__none'

function Card({ record, props, overlay }: { record: CrmRecord; props: ViewProps; overlay?: boolean }) {
  const { module, ctx, fields, config } = props
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: record.id, disabled: !props.canEdit || overlay })
  const show = fields.filter((f) => f.id !== config.groupBy).slice(1, 4)
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={() => !overlay && props.onOpen(record.id)}
      className={cn('cursor-pointer touch-none rounded-lg border border-line bg-surface p-3 text-[13px] shadow-sm transition hover:border-primary/40 hover:shadow-md', isDragging && 'opacity-40', overlay && 'rotate-1 shadow-xl')}
    >
      <div className="mb-1.5 font-medium">{recordTitle(module, record, ctx)}</div>
      <div className="space-y-1">
        {show.map((f) => {
          const v = valueOf(module, record, f, ctx)
          return (
            <div key={f.id} className="flex items-center gap-1.5 text-xs">
              <span className="w-16 shrink-0 truncate text-muted">{f.label}</span>
              <span className="min-w-0 flex-1 truncate"><FieldValue field={f} value={v} ctx={ctx} compact /></span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Column({ id, label, color, records, props }: { id: string; label: string; color?: string; records: CrmRecord[]; props: ViewProps }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div className="flex w-[290px] shrink-0 flex-col rounded-xl bg-subtle/70">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="size-2.5 rounded-full" style={{ background: color ?? '#94a3b8' }} />
        <span className="flex-1 truncate text-[13px] font-semibold">{label}</span>
        <span className="rounded-full bg-surface px-2 text-[11px] text-muted">{records.length}</span>
        {props.canCreate && (
          <button type="button" aria-label={`Add to ${label}`} onClick={() => props.onAdd(props.config.groupBy ? { [props.config.groupBy]: id === NONE ? '' : id } : undefined)} className="rounded p-0.5 text-muted hover:bg-surface hover:text-primary"><Plus size={15} /></button>
        )}
      </div>
      <div ref={setNodeRef} className={cn('scroll-thin min-h-[80px] flex-1 space-y-2 overflow-y-auto px-2 pb-2 transition', isOver && 'rounded-xl bg-primary/10')} style={{ maxHeight: 'calc(100vh - 300px)' }}>
        {records.map((r) => <Card key={r.id} record={r} props={props} />)}
        {records.length === 0 && <div className="rounded-lg border border-dashed border-line py-6 text-center text-xs text-muted">Drop cards here</div>}
      </div>
    </div>
  )
}

export function KanbanView(props: ViewProps) {
  const { module, records, config } = props
  const field = module.fields.find((f) => f.id === config.groupBy)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const [active, setActive] = useState<CrmRecord | null>(null)

  const cols = useMemo(() => {
    if (!field?.options) return []
    const list = field.options.map((o) => ({ id: o.id, label: o.label, color: o.color, records: [] as CrmRecord[] }))
    const none = { id: NONE, label: 'No value', color: '#94a3b8', records: [] as CrmRecord[] }
    for (const r of records) {
      const v = String(r.data[field.id] ?? '')
      ;(list.find((c) => c.id === v) ?? none).records.push(r)
    }
    return none.records.length ? [none, ...list] : list
  }, [field, records])

  if (!field || !(field.type === 'dropdown' || field.type === 'radio')) {
    return <EmptyState icon="Columns3" title="Choose a field to group by" description="Kanban boards need a Dropdown or Radio field. Pick one from the Group menu, or add a status field to this module." />
  }

  const onDragStart = (e: DragStartEvent) => setActive(records.find((r) => r.id === e.active.id) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null)
    if (!e.over) return
    const target = String(e.over.id)
    const rec = records.find((r) => r.id === e.active.id)
    if (!rec) return
    const cur = String(rec.data[field.id] ?? '') || NONE
    if (cur === target) return
    props.onUpdateRecord(rec.id, { [field.id]: target === NONE ? '' : target })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="scroll-thin flex gap-3 overflow-x-auto pb-3">
        {cols.map((c) => <Column key={c.id} id={c.id} label={c.label} color={c.color} records={c.records} props={props} />)}
      </div>
      <DragOverlay>{active ? <Card record={active} props={props} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}
