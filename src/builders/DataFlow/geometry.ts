export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Curve { d: string; mid: Pt }

const bez = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt => {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

const curve = (s: Pt, c1: Pt, c2: Pt, t: Pt): Curve => ({
  d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`,
  mid: bez(s, c1, c2, t, 0.5),
})

/** Smooth line from the edge of one node to the edge of another. `offset` fans out several lines between the same pair. */
export function edgeCurve(a: Rect, b: Rect, offset = 0): Curve {
  const acx = a.x + a.w / 2
  const acy = a.y + a.h / 2
  const bcx = b.x + b.w / 2
  const bcy = b.y + b.h / 2
  const dx = bcx - acx
  const dy = bcy - acy
  const horizontal = Math.abs(dx) > (a.w + b.w) / 2 + 8 || Math.abs(dx) > Math.abs(dy)
  if (horizontal) {
    const sign = dx >= 0 ? 1 : -1
    const lim = Math.min(a.h, b.h) / 2 - 10
    const o = Math.max(-lim, Math.min(lim, offset))
    const s = { x: sign > 0 ? a.x + a.w : a.x, y: acy + o }
    const t = { x: sign > 0 ? b.x : b.x + b.w, y: bcy + o }
    const d = Math.max(48, Math.abs(t.x - s.x) / 2)
    return curve(s, { x: s.x + sign * d, y: s.y }, { x: t.x - sign * d, y: t.y }, t)
  }
  const sign = dy >= 0 ? 1 : -1
  const lim = Math.min(a.w, b.w) / 2 - 16
  const o = Math.max(-lim, Math.min(lim, offset))
  const s = { x: acx + o, y: sign > 0 ? a.y + a.h : a.y }
  const t = { x: bcx + o, y: sign > 0 ? b.y : b.y + b.h }
  const d = Math.max(40, Math.abs(t.y - s.y) / 2)
  return curve(s, { x: s.x, y: s.y + sign * d }, { x: t.x, y: t.y - sign * d }, t)
}

/** A line that leaves a node and comes back into it (a module linked to itself). */
export function loopCurve(a: Rect, offset = 0): Curve {
  const s = { x: a.x + a.w * 0.3 + offset, y: a.y }
  const t = { x: a.x + a.w * 0.7 + offset, y: a.y }
  return curve(s, { x: s.x - 10, y: s.y - 70 }, { x: t.x + 10, y: t.y - 70 }, t)
}

/** Preview line while dragging from a connector handle to the pointer. */
export function dragCurve(from: Pt, to: Pt): Curve {
  const d = Math.max(40, Math.abs(to.x - from.x) / 2)
  return curve(from, { x: from.x + d, y: from.y }, { x: to.x - d, y: to.y }, to)
}
