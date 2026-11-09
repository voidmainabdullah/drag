import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Maximize2, Minimize2, Settings2, Trash2 } from 'lucide-react'
import type { Widget } from '#/types'
import { WidgetView, widgetHeight } from '#/components/dashboard/WidgetView'
import { cn } from '#/utils/id'

const spans: Record<number, string> = {
  1: '',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 xl:col-span-3',
  4: 'sm:col-span-2 xl:col-span-4',
}

function Tile({ w, editing, onConfigure, onRemove, onResize }: { w: Widget; editing: boolean; onConfigure: () => void; onRemove: () => void; onResize: (d: 1 | -1) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id, disabled: !editing })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, height: widgetHeight(w.h) }}
      className={cn('flex min-w-0 flex-col rounded-xl border bg-surface p-3', spans[w.w], editing ? 'border-dashed border-primary/40' : 'border-line', isDragging && 'z-10 opacity-60 shadow-xl')}
    >
      <div className="mb-2 flex shrink-0 items-center gap-1">
        {editing && <button type="button" aria-label={`Drag ${w.title}`} className="cursor-grab touch-none rounded p-0.5 text-muted hover:text-fg" {...attributes} {...listeners}><GripVertical size={15} /></button>}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{w.title}</h3>
        {editing && (
          <div className="flex shrink-0">
            <button type="button" aria-label="Make larger" title="Larger" disabled={w.w >= 4 && w.h >= 3} onClick={() => onResize(1)} className="rounded p-1 text-muted hover:bg-subtle disabled:opacity-30"><Maximize2 size={13} /></button>
            <button type="button" aria-label="Make smaller" title="Smaller" disabled={w.w <= 1 && w.h <= 1} onClick={() => onResize(-1)} className="rounded p-1 text-muted hover:bg-subtle disabled:opacity-30"><Minimize2 size={13} /></button>
            <button type="button" aria-label={`Settings for ${w.title}`} title="Settings" onClick={onConfigure} className="rounded p-1 text-muted hover:bg-subtle"><Settings2 size={13} /></button>
            <button type="button" aria-label={`Remove ${w.title}`} title="Remove" onClick={onRemove} className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1"><WidgetView w={w} /></div>
    </div>
  )
}

export function DashboardGrid({ widgets, editing, onChange, onConfigure }: { widgets: Widget[]; editing: boolean; onChange: (w: Widget[]) => void; onConfigure: (w: Widget) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = widgets.findIndex((w) => w.id === e.active.id)
    const to = widgets.findIndex((w) => w.id === e.over!.id)
    if (from >= 0 && to >= 0) onChange(arrayMove(widgets, from, to))
  }
  const resize = (w: Widget, d: 1 | -1) => {
    // grow/shrink width first, then height
    let { w: cw, h: ch } = w
    if (d === 1) { if (cw < 4) cw = (cw + 1) as Widget['w']; else if (ch < 3) ch = (ch + 1) as Widget['h'] }
    else { if (ch > 1 && cw <= 2) ch = (ch - 1) as Widget['h']; else if (cw > 1) cw = (cw - 1) as Widget['w']; else if (ch > 1) ch = (ch - 1) as Widget['h'] }
    onChange(widgets.map((x) => (x.id === w.id ? { ...x, w: cw, h: ch } : x)))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {widgets.map((w) => <Tile key={w.id} w={w} editing={editing} onConfigure={() => onConfigure(w)} onRemove={() => onChange(widgets.filter((x) => x.id !== w.id))} onResize={(d) => resize(w, d)} />)}
        </div>
      </SortableContext>
    </DndContext>
  )
}
