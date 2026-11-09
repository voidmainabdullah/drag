import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ExternalLink, Maximize2, Minus, Plus, ZoomIn } from 'lucide-react'
import type { DataFlowLink, ID, Module } from '#/types'
import { NODE_H, NODE_W, RELATION_COLOR, actionMeta, defaultNodePos, type RelationEdge } from '#/utils/dataflow'
import { setNodePositions } from '#/services/dataFlowService'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { dragCurve, edgeCurve, loopCurve, type Curve, type Pt, type Rect } from './geometry'

export interface CanvasSelection { kind: 'flow' | 'rel' | 'node'; id: string }

export interface CanvasHandle {
  fit: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
}

interface Props {
  /** every module of the workspace, in a stable order (default positions depend on it) */
  modules: Module[]
  visibleIds: Set<ID>
  flows: DataFlowLink[]
  rels: RelationEdge[]
  draft: DataFlowLink | null
  selection: CanvasSelection | null
  focusModuleId?: ID
  canEdit: boolean
  recordCounts: Record<ID, number>
  height: number | string
  onSelect: (s: CanvasSelection | null) => void
  onConnect: (sourceId: ID, targetId: ID) => void
  /** the connector handle was clicked (not dragged) or activated with the keyboard */
  onStartFrom: (sourceId: ID) => void
  onOpenModule: (id: ID) => void
}

interface View { x: number; y: number; k: number }
const MIN_K = 0.3
const MAX_K = 1.8
const DRAG_THRESHOLD = 4

interface EdgeItem {
  key: string
  kind: 'flow' | 'rel' | 'draft'
  id: string
  fromId: ID
  toId: ID
  color: string
  label: string
  enabled: boolean
}

export const DataFlowCanvas = forwardRef<CanvasHandle, Props>(function DataFlowCanvas(
  { modules, visibleIds, flows, rels, draft, selection, focusModuleId, canEdit, recordCounts, height, onSelect, onConnect, onStartFrom, onOpenModule },
  ref,
) {
  const uidBase = useId().replace(/[^a-zA-Z0-9]/g, '')
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 40, y: 30, k: 1 })
  const viewRef = useRef(view)
  viewRef.current = view
  const [drag, setDrag] = useState<{ id: ID; x: number; y: number } | null>(null)
  const [connecting, setConnecting] = useState<{ from: ID; to: Pt; over: ID | null } | null>(null)
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const didFit = useRef(false)

  const posOf = useCallback(
    (m: Module, i: number): Pt => (drag?.id === m.id ? { x: drag.x, y: drag.y } : (m.flowPos ?? defaultNodePos(i))),
    [drag],
  )
  const nodes = useMemo(() => modules.map((m, i) => ({ m, p: posOf(m, i) })).filter((n) => visibleIds.has(n.m.id)), [modules, visibleIds, posOf])
  const rectOf = useMemo(() => new Map<ID, Rect>(nodes.map((n) => [n.m.id, { x: n.p.x, y: n.p.y, w: NODE_W, h: NODE_H }])), [nodes])

  // ---- view helpers -------------------------------------------------------------------------------------------
  const size = () => {
    const r = box.current?.getBoundingClientRect()
    return { w: r?.width ?? 800, h: r?.height ?? 500, left: r?.left ?? 0, top: r?.top ?? 0 }
  }
  const toWorld = (cx: number, cy: number): Pt => {
    const s = size()
    const v = viewRef.current
    return { x: (cx - s.left - v.x) / v.k, y: (cy - s.top - v.y) / v.k }
  }
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, v.k * factor))
      const f = k / v.k
      return { k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f }
    })
  }, [])
  const fit = useCallback(() => {
    if (!rectOf.size) return
    const rs = [...rectOf.values()]
    const minX = Math.min(...rs.map((r) => r.x))
    const minY = Math.min(...rs.map((r) => r.y - 40))
    const maxX = Math.max(...rs.map((r) => r.x + r.w))
    const maxY = Math.max(...rs.map((r) => r.y + r.h))
    const s = size()
    const pad = 48
    const k = Math.max(MIN_K, Math.min(1.1, (s.w - pad * 2) / (maxX - minX), (s.h - pad * 2) / (maxY - minY)))
    setView({ k, x: (s.w - (maxX - minX) * k) / 2 - minX * k, y: (s.h - (maxY - minY) * k) / 2 - minY * k })
  }, [rectOf])
  useImperativeHandle(ref, () => ({
    fit,
    zoomIn: () => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1.2) },
    zoomOut: () => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1 / 1.2) },
    resetZoom: () => { const s = size(); const v = viewRef.current; zoomAt(s.w / 2, s.h / 2, 1 / v.k) },
  }), [fit, zoomAt])

  useEffect(() => {
    if (didFit.current || !rectOf.size) return
    didFit.current = true
    const id = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(id)
  }, [rectOf, fit])

  // ctrl / cmd + wheel zooms; a plain wheel keeps scrolling the page
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---- background pan -----------------------------------------------------------------------------------------
  const onBgDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('[data-node],[data-edge],[data-ui]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false }
  }
  const onBgMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (!p) return
    const dx = e.clientX - p.sx
    const dy = e.clientY - p.sy
    if (!p.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    p.moved = true
    setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }))
  }
  const onBgUp = (e: React.PointerEvent) => {
    const p = pan.current
    if (!p) return
    pan.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!p.moved) onSelect(null)
  }

  // ---- node drag ----------------------------------------------------------------------------------------------
  const nodeDrag = useRef<{ id: ID; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const onNodeDown = (e: React.PointerEvent, m: Module, p: Pt) => {
    if (e.button !== 0 || (e.target as Element).closest('[data-handle],[data-open]')) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    nodeDrag.current = { id: m.id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false }
  }
  const onNodeMove = (e: React.PointerEvent) => {
    const d = nodeDrag.current
    if (!d || !canEdit) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    const k = viewRef.current.k
    setDrag({ id: d.id, x: Math.max(0, d.ox + dx / k), y: Math.max(0, d.oy + dy / k) })
  }
  const onNodeUp = (e: React.PointerEvent, m: Module) => {
    const d = nodeDrag.current
    if (!d) return
    nodeDrag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.moved && canEdit) {
      setDrag((cur) => {
        if (cur) setNodePositions({ [cur.id]: { x: cur.x, y: cur.y } })
        return null
      })
    } else {
      onSelect({ kind: 'node', id: m.id })
    }
  }
  const onNodeKey = (e: React.KeyboardEvent, m: Module, p: Pt) => {
    if (e.target !== e.currentTarget) return
    const step = e.shiftKey ? 48 : 16
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (move && canEdit) {
      e.preventDefault()
      setNodePositions({ [m.id]: { x: Math.max(0, p.x + move[0]), y: Math.max(0, p.y + move[1]) } })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect({ kind: 'node', id: m.id })
    }
  }

  // ---- connector handle ---------------------------------------------------------------------------------------
  const hit = (pt: Pt, except: ID): ID | null => {
    for (const [id, r] of rectOf) if (id !== except && pt.x >= r.x - 14 && pt.x <= r.x + r.w + 14 && pt.y >= r.y - 14 && pt.y <= r.y + r.h + 14) return id
    return null
  }
  const conn = useRef<{ from: ID; sx: number; sy: number; moved: boolean } | null>(null)
  const onHandleDown = (e: React.PointerEvent, m: Module) => {
    if (e.button !== 0 || !canEdit) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    conn.current = { from: m.id, sx: e.clientX, sy: e.clientY, moved: false }
  }
  const onHandleMove = (e: React.PointerEvent) => {
    const c = conn.current
    if (!c) return
    if (!c.moved && Math.hypot(e.clientX - c.sx, e.clientY - c.sy) < DRAG_THRESHOLD) return
    c.moved = true
    const to = toWorld(e.clientX, e.clientY)
    setConnecting({ from: c.from, to, over: hit(to, c.from) })
  }
  const onHandleUp = (e: React.PointerEvent) => {
    const c = conn.current
    if (!c) return
    conn.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const over = c.moved ? hit(toWorld(e.clientX, e.clientY), c.from) : null
    setConnecting(null)
    if (over) onConnect(c.from, over)
    else if (!c.moved) onStartFrom(c.from)
  }

  // ---- edges ---------------------------------------------------------------------------------------------------
  const edges = useMemo(() => {
    const out: EdgeItem[] = []
    for (const r of rels) out.push({ key: r.id, kind: 'rel', id: r.id, fromId: r.fromId, toId: r.toId, color: RELATION_COLOR, label: r.label, enabled: true })
    const list = draft && !flows.some((f) => f.id === draft.id) ? [...flows, draft] : flows
    for (const f of list) out.push({ key: f.id, kind: draft?.id === f.id && !flows.some((x) => x.id === f.id) ? 'draft' : 'flow', id: f.id, fromId: f.sourceModuleId, toId: f.targetModuleId, color: actionMeta(f.action.type).color, label: f.name, enabled: f.enabled })
    return out.filter((e) => rectOf.has(e.fromId) && rectOf.has(e.toId))
  }, [rels, flows, draft, rectOf])

  const drawn = useMemo(() => {
    const groups = new Map<string, EdgeItem[]>()
    for (const e of edges) {
      const k = [e.fromId, e.toId].sort().join('|')
      groups.set(k, [...(groups.get(k) ?? []), e])
    }
    const out: { e: EdgeItem; c: Curve }[] = []
    for (const list of groups.values()) {
      list.forEach((e, i) => {
        const off = (i - (list.length - 1) / 2) * 16
        const a = rectOf.get(e.fromId)!
        const b = rectOf.get(e.toId)!
        out.push({ e, c: e.fromId === e.toId ? loopCurve(a, off * 2) : edgeCurve(a, b, off) })
      })
    }
    // relationships underneath, flows on top, the selected line last
    const rank = (x: EdgeItem) => (x.kind === 'rel' ? 0 : 1) + (selection?.id === x.id ? 2 : 0)
    return out.sort((x, y) => rank(x.e) - rank(y.e))
  }, [edges, rectOf, selection])

  const counts = useMemo(() => {
    const c = new Map<ID, { out: number; inn: number }>()
    for (const f of flows) {
      c.set(f.sourceModuleId, { out: (c.get(f.sourceModuleId)?.out ?? 0) + 1, inn: c.get(f.sourceModuleId)?.inn ?? 0 })
      c.set(f.targetModuleId, { out: c.get(f.targetModuleId)?.out ?? 0, inn: (c.get(f.targetModuleId)?.inn ?? 0) + 1 })
    }
    return c
  }, [flows])

  const worldW = Math.max(1600, ...[...rectOf.values()].map((r) => r.x + r.w + 600))
  const worldH = Math.max(1000, ...[...rectOf.values()].map((r) => r.y + r.h + 600))
  const colors = [...new Set([...edges.map((e) => e.color), '#7B68EE'])]
  const markerId = (c: string) => `${uidBase}-m-${c.replace('#', '')}`
  const pct = Math.round(view.k * 100)
  const flowCount = flows.filter((f) => rectOf.has(f.sourceModuleId) && rectOf.has(f.targetModuleId)).length

  return (
    <div
      ref={box}
      role="application"
      aria-label="Data flow canvas. Drag modules to arrange them, drag from the connector on a module to another module to create a flow."
      className="relative touch-none overflow-hidden rounded-xl border border-line bg-subtle/40 select-none"
      style={{ height, cursor: pan.current ? 'grabbing' : 'grab', backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--fg) 14%, transparent) 1px, transparent 1.2px)', backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
      onPointerDown={onBgDown}
      onPointerMove={onBgMove}
      onPointerUp={onBgUp}
      onPointerCancel={onBgUp}
    >
      <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0', width: worldW, height: worldH }}>
        <svg width={worldW} height={worldH} className="pointer-events-none absolute top-0 left-0 overflow-visible" aria-hidden={false}>
          <defs>
            {colors.map((c) => (
              <marker key={c} id={markerId(c)} markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M1,1.5 L11,6 L1,10.5 Z" fill={c} />
              </marker>
            ))}
          </defs>
          {drawn.map(({ e, c }) => {
            const sel = selection?.id === e.id
            const rel = e.kind === 'rel'
            const animated = e.kind !== 'rel' && e.enabled
            const w = Math.min(160, e.label.length * 6.4 + 18)
            const text = e.label.length > 24 ? `${e.label.slice(0, 23)}…` : e.label
            const tw = Math.min(w, text.length * 6.4 + 18)
            return (
              <g key={e.key} data-edge className={cn(!e.enabled && 'opacity-45')} role="button" aria-label={`${rel ? 'Relationship' : 'Data flow'}: ${e.label}`}>
                <path d={c.d} fill="none" stroke="transparent" strokeWidth={18} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: rel ? 'rel' : 'flow', id: e.id }) }} />
                <path d={c.d} fill="none" stroke={e.kind === 'draft' ? '#7B68EE' : e.color} strokeWidth={sel ? 3.5 : 2.2} strokeOpacity={animated ? 0.38 : rel ? 0.9 : 0.75} strokeDasharray={rel ? '5 5' : e.kind === 'draft' ? '2 5' : undefined} strokeLinecap="round" markerEnd={`url(#${markerId(e.kind === 'draft' ? '#7B68EE' : e.color)})`} />
                {animated && <path d={c.d} fill="none" stroke={e.color} strokeWidth={sel ? 3.5 : 2.2} strokeLinecap="round" className="flow-line-anim" />}
                <g transform={`translate(${c.mid.x - tw / 2}, ${c.mid.y - 11})`} style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={(ev) => { ev.stopPropagation(); onSelect({ kind: rel ? 'rel' : 'flow', id: e.id }) }}>
                  <rect width={tw} height={22} rx={11} fill="var(--surface)" stroke={e.kind === 'draft' ? '#7B68EE' : e.color} strokeWidth={sel ? 2 : 1} strokeDasharray={rel ? '3 3' : undefined} />
                  <text x={tw / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={500} fill="var(--fg)">{text}</text>
                </g>
              </g>
            )
          })}
          {connecting && rectOf.get(connecting.from) && (
            <path d={dragCurve({ x: rectOf.get(connecting.from)!.x + NODE_W, y: rectOf.get(connecting.from)!.y + NODE_H / 2 }, connecting.to).d} fill="none" stroke="#7B68EE" strokeWidth={2.5} strokeDasharray="6 5" strokeLinecap="round" markerEnd={`url(#${markerId('#7B68EE')})`} />
          )}
        </svg>

        {nodes.map(({ m, p }) => {
          const sel = selection?.kind === 'node' && selection.id === m.id
          const over = connecting?.over === m.id
          const c = counts.get(m.id)
          return (
            <div
              key={m.id}
              data-node
              role="group"
              tabIndex={0}
              aria-label={`${m.name} module. ${recordCounts[m.id] ?? 0} records.${canEdit ? ' Arrow keys move it.' : ''}`}
              className={cn(
                'group absolute flex items-center gap-3 rounded-xl border bg-surface px-3 shadow-sm transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                sel ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:shadow-md',
                over && 'border-accent ring-4 ring-accent/30',
                drag?.id === m.id && 'z-10 shadow-xl',
                focusModuleId === m.id && !sel && 'border-primary/60',
              )}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
              onPointerDown={(e) => onNodeDown(e, m, p)}
              onPointerMove={onNodeMove}
              onPointerUp={(e) => onNodeUp(e, m)}
              onPointerCancel={(e) => onNodeUp(e, m)}
              onDoubleClick={() => onOpenModule(m.id)}
              onKeyDown={(e) => onNodeKey(e, m, p)}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: m.color }}><Icon name={m.icon} size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{m.name}</span>
                <span className="block truncate text-[11px] text-muted">{recordCounts[m.id] ?? 0} records{c ? ` · ${c.inn} in · ${c.out} out` : ''}</span>
              </span>
              <button type="button" data-open aria-label={`Open ${m.name} records`} title="Open records (or double-click)" onClick={() => onOpenModule(m.id)} className="rounded-md p-1 text-muted opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-subtle hover:text-fg focus:opacity-100"><ExternalLink size={13} /></button>
              {canEdit && (
                <button
                  type="button"
                  data-handle
                  aria-label={`Connect ${m.name} to another module. Drag to a module, or press Enter to pick one.`}
                  title="Drag to another module to connect"
                  className="absolute top-1/2 -right-3 flex size-6 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-primary bg-surface text-primary shadow transition hover:scale-110 hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
                  onPointerDown={(e) => onHandleDown(e, m)}
                  onPointerMove={onHandleMove}
                  onPointerUp={onHandleUp}
                  onPointerCancel={onHandleUp}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStartFrom(m.id) } }}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {flowCount === 0 && !draft && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-4">
          <div className="max-w-md rounded-xl border border-dashed border-primary/40 bg-surface/95 px-4 py-3 text-center text-[13px] shadow-sm">
            <strong className="block">No data flows yet</strong>
            <span className="text-muted">{canEdit ? 'Drag from the + handle on a module to another module to connect them, or use “New flow”.' : 'Flows will appear here as lines between modules.'}</span>
          </div>
        </div>
      )}

      <div data-ui className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-muted shadow-sm">
        {(['create_linked', 'update_linked', 'link_records'] as const).map((t) => <span key={t} className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded" style={{ background: actionMeta(t).color }} />{actionMeta(t).short}</span>)}
        <span className="inline-flex items-center gap-1"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: RELATION_COLOR }} />relationship field</span>
      </div>
      <div data-ui className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface/95 p-0.5 shadow-sm">
        <ZoomBtn label="Zoom out" onClick={() => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1 / 1.2) }}><Minus size={14} /></ZoomBtn>
        <span className="w-10 text-center text-[11px] text-muted tabular-nums" aria-live="polite">{pct}%</span>
        <ZoomBtn label="Zoom in" onClick={() => { const s = size(); zoomAt(s.w / 2, s.h / 2, 1.2) }}><ZoomIn size={14} /></ZoomBtn>
        <ZoomBtn label="Fit all modules in view" onClick={fit}><Maximize2 size={14} /></ZoomBtn>
      </div>
    </div>
  )
})

function ZoomBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-subtle hover:text-fg">{children}</button>
}
