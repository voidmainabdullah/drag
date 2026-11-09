import { useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import type { Field } from '#/types'
import { groupRecords, recordTitle, valueOf } from '#/utils/records'
import { Checkbox } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { FieldValue } from '#/components/fields/FieldValue'
import { FIELD_TYPE_MAP } from '#/utils/fieldTypes'
import { cn } from '#/utils/id'
import type { ViewProps } from './viewTypes'

const DEFAULT_W = 180
const MIN_W = 80

function HeaderCell({ field, width, sortDir, onSort, onResize, canDrag }: { field: Field; width: number; sortDir?: 'asc' | 'desc'; onSort: () => void; onResize: (w: number) => void; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id, disabled: !canDrag })
  const startX = useRef(0)
  const startW = useRef(0)

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startX.current = e.clientX
    startW.current = width
    const move = (ev: PointerEvent) => onResize(Math.max(MIN_W, startW.current + ev.clientX - startX.current))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <th
      ref={setNodeRef}
      scope="col"
      style={{ width, minWidth: width, maxWidth: width, transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="relative border-b border-line bg-subtle/70 px-2 py-2 text-left text-xs font-semibold text-muted select-none"
    >
      <div className="flex items-center gap-1">
        {canDrag && (
          <button type="button" aria-label={`Reorder ${field.label}`} className="cursor-grab touch-none text-muted/50 hover:text-fg" {...attributes} {...listeners}>
            <GripVertical size={12} />
          </button>
        )}
        <button type="button" onClick={onSort} className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-fg" title={`Sort by ${field.label}`}>
          <Icon name={FIELD_TYPE_MAP[field.type]?.icon} size={12} className="shrink-0" />
          <span className="truncate">{field.label}</span>
          {sortDir === 'asc' && <ArrowUp size={12} className="shrink-0 text-primary" />}
          {sortDir === 'desc' && <ArrowDown size={12} className="shrink-0 text-primary" />}
        </button>
      </div>
      <div role="separator" aria-label={`Resize ${field.label}`} onPointerDown={onPointerDown} className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
    </th>
  )
}

export function TableView({ module, records, config, ctx, fields, selected, onSelect, onOpen, onConfig, canEdit }: ViewProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [limit, setLimit] = useState(200)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const groups = useMemo(() => groupRecords(module, records, config.groupBy, ctx), [module, records, config.groupBy, ctx])
  const allIds = records.map((r) => r.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const someSelected = allIds.some((id) => selected.has(id))
  const w = (f: Field) => config.columnWidths[f.id] ?? DEFAULT_W
  const total = 44 + fields.reduce((n, f) => n + w(f), 0)

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const ids = fields.map((f) => f.id)
    onConfig({ fieldOrder: arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))) })
  }
  const toggleSort = (f: Field) => {
    const cur = config.sorts[0]
    if (cur?.fieldId !== f.id) onConfig({ sorts: [{ id: 'quick', fieldId: f.id, dir: 'asc' }] })
    else if (cur.dir === 'asc') onConfig({ sorts: [{ ...cur, dir: 'desc' }] })
    else onConfig({ sorts: [] })
  }
  let rendered = 0

  return (
    <div className="scroll-thin overflow-auto rounded-xl border border-line bg-surface">
      <table className="border-collapse text-[13px]" style={{ width: total, minWidth: '100%', tableLayout: 'fixed' }}>
        <thead className="sticky top-0 z-10">
          <tr>
            <th scope="col" className="w-11 border-b border-line bg-subtle/70 px-3 py-2" style={{ width: 44 }}>
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={(v) => onSelect(v ? new Set(allIds) : new Set())} label={<span className="sr-only">Select all</span>} />
            </th>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={fields.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
                {fields.map((f) => (
                  <HeaderCell key={f.id} field={f} width={w(f)} canDrag sortDir={config.sorts[0]?.fieldId === f.id ? config.sorts[0].dir : undefined} onSort={() => toggleSort(f)} onResize={(nw) => onConfig({ columnWidths: { ...config.columnWidths, [f.id]: nw } })} />
                ))}
              </SortableContext>
            </DndContext>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isCollapsed = collapsed.has(g.key)
            return (
              <GroupRows key={g.key} showHeader={!!config.groupBy} label={g.label} color={g.color} count={g.records.length} colSpan={fields.length + 1} collapsed={isCollapsed} onToggle={() => setCollapsed((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}>
                {!isCollapsed &&
                  g.records.map((r) => {
                    if (rendered >= limit) return null
                    rendered++
                    const sel = selected.has(r.id)
                    return (
                      <tr key={r.id} onClick={() => onOpen(r.id)} className={cn('cursor-pointer border-b border-line/70 transition hover:bg-primary/5', sel && 'bg-primary/10', r.archived && 'opacity-60')}>
                        <td className="px-3" style={{ paddingTop: 'var(--row-y)', paddingBottom: 'var(--row-y)' }} onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={sel} onChange={(v) => { const n = new Set(selected); v ? n.add(r.id) : n.delete(r.id); onSelect(n) }} label={<span className="sr-only">Select {recordTitle(module, r, ctx)}</span>} />
                        </td>
                        {fields.map((f, i) => (
                          <td key={f.id} className={cn('overflow-hidden px-2 align-middle', i === 0 && 'font-medium')} style={{ width: w(f), maxWidth: w(f), paddingTop: 'var(--row-y)', paddingBottom: 'var(--row-y)' }}>
                            <div className="truncate"><FieldValue field={f} value={valueOf(module, r, f, ctx)} ctx={ctx} compact /></div>
                          </td>
                        ))}
                      </tr>
                    )
                  })}
              </GroupRows>
            )
          })}
        </tbody>
      </table>
      {records.length > limit && (
        <div className="border-t border-line p-2 text-center">
          <button type="button" className="text-[13px] font-medium text-primary hover:underline" onClick={() => setLimit((l) => l + 300)}>Show more ({records.length - limit} remaining)</button>
        </div>
      )}
      {!canEdit && <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Read-only for your current role.</div>}
    </div>
  )
}

function GroupRows({ showHeader, label, color, count, colSpan, collapsed, onToggle, children }: { showHeader: boolean; label: string; color?: string; count: number; colSpan: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      {showHeader && (
        <tr className="bg-subtle/40">
          <td colSpan={colSpan + 0} className="border-b border-line px-3 py-1.5">
            <button type="button" onClick={onToggle} className="flex items-center gap-2 text-xs font-semibold" aria-expanded={!collapsed}>
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              {color && <span className="size-2 rounded-full" style={{ background: color }} />}
              {label}
              <span className="rounded-full bg-surface px-1.5 text-[10px] font-medium text-muted">{count}</span>
            </button>
          </td>
        </tr>
      )}
      {children}
    </>
  )
}
