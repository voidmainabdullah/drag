import type { DataFlowLink, Field, FlowActionType, FlowFieldMap, FlowLinkField, FlowTriggerType, ID, Module } from '#/types'
import { nowIso, uid } from '#/utils/id'

export const NODE_W = 212
export const NODE_H = 78
export const RELATION_COLOR = '#94A3B8'

export const FLOW_TRIGGERS: { id: FlowTriggerType; label: string; short: string; hint: string }[] = [
  { id: 'record_created', label: 'A record is created', short: 'created', hint: 'Runs right after a new record is saved in the source module.' },
  { id: 'record_updated', label: 'A record is updated', short: 'updated', hint: 'Runs after any edit to a source record.' },
  { id: 'record_deleted', label: 'A record is deleted', short: 'deleted', hint: 'Runs when a source record is moved to the trash.' },
  { id: 'field_changed', label: 'A field changes', short: 'field changed', hint: 'Runs when the chosen field of a source record gets a new value.' },
]

export const FLOW_ACTIONS: { id: FlowActionType; label: string; short: string; icon: string; color: string; hint: string }[] = [
  { id: 'create_linked', label: 'Create a linked record', short: 'creates', icon: 'FilePlus', color: '#2DB67D', hint: 'Creates a record in the target module from the source record (and keeps it in sync on later runs).' },
  { id: 'update_linked', label: 'Update linked record(s)', short: 'updates', icon: 'RefreshCw', color: '#3B9DF8', hint: 'Sets fields on the target records that are linked to the source record.' },
  { id: 'link_records', label: 'Link / relate records', short: 'links', icon: 'Link2', color: '#F5A524', hint: 'Finds matching target records and fills in the relationship field.' },
]

export const actionMeta = (t: FlowActionType) => FLOW_ACTIONS.find((a) => a.id === t) ?? FLOW_ACTIONS[0]
export const triggerMeta = (t: FlowTriggerType) => FLOW_TRIGGERS.find((a) => a.id === t) ?? FLOW_TRIGGERS[0]

const NOT_MAPPABLE = new Set(['formula', 'autoId', 'file', 'image', 'document', 'signature', 'password'])
export const mappableTarget = (f: Field) => !NOT_MAPPABLE.has(f.type)
export const mappableSource = (f: Field) => f.type !== 'password' && f.type !== 'signature'

export const encodeLink = (l?: FlowLinkField) => (l ? `${l.side}:${l.fieldId}` : '')
export function decodeLink(v: string): FlowLinkField | undefined {
  const i = v.indexOf(':')
  if (i < 0) return undefined
  const side = v.slice(0, i)
  if (side !== 'source' && side !== 'target') return undefined
  return { side, fieldId: v.slice(i + 1) }
}

export interface LinkOption { value: string; label: string; link: FlowLinkField }

/** Relationship fields that connect the two modules, in either direction. */
export function linkOptions(source?: Module, target?: Module): LinkOption[] {
  if (!source || !target) return []
  const out: LinkOption[] = []
  for (const f of target.fields) {
    if (f.type === 'relationship' && f.relation?.moduleId === source.id) {
      out.push({ value: `target:${f.id}`, label: `${target.name} › ${f.label}  (points to ${source.name})`, link: { side: 'target', fieldId: f.id } })
    }
  }
  for (const f of source.fields) {
    if (f.type === 'relationship' && f.relation?.moduleId === target.id) {
      out.push({ value: `source:${f.id}`, label: `${source.name} › ${f.label}  (points to ${target.name})`, link: { side: 'source', fieldId: f.id } })
    }
  }
  return out
}

export function linkFieldOf(l: DataFlowLink, source?: Module, target?: Module): Field | undefined {
  const lf = l.action.linkField
  if (!lf) return undefined
  return (lf.side === 'source' ? source : target)?.fields.find((f) => f.id === lf.fieldId)
}

/** Pairs fields with the same name/label so a new flow starts with a useful mapping. */
export function suggestMappings(source: Module, target: Module): FlowFieldMap[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const used = new Set<string>()
  const out: FlowFieldMap[] = []
  for (const s of source.fields.filter(mappableSource)) {
    const t = target.fields.find((f) => mappableTarget(f) && !used.has(f.id) && (norm(f.label) === norm(s.label) || norm(f.name) === norm(s.name)))
    if (t) {
      used.add(t.id)
      out.push({ id: uid('map'), sourceFieldId: s.id, targetFieldId: t.id })
    }
  }
  // the title fields usually describe the same thing
  if (!out.length && source.fields[0] && target.fields[0] && mappableTarget(target.fields[0])) out.push({ id: uid('map'), sourceFieldId: source.fields[0].id, targetFieldId: target.fields[0].id })
  return out.slice(0, 12)
}

export function newFlow(ws: ID, source: Module, target: Module): DataFlowLink {
  const t = nowIso()
  const opts = linkOptions(source, target)
  const preferred = opts.find((o) => o.link.side === 'target') ?? opts[0]
  return {
    id: uid('flow'),
    workspaceId: ws,
    name: `${source.name} → ${target.name}`,
    enabled: true,
    sourceModuleId: source.id,
    targetModuleId: target.id,
    trigger: { type: 'record_created' },
    conditions: [],
    action: { type: 'create_linked', mappings: suggestMappings(source, target), defaults: {}, sets: [], linkField: preferred?.link },
    createdAt: t,
    updatedAt: t,
  }
}

/** Human readable one-liner shown on lines, cards and in the run log. */
export function flowSummary(l: DataFlowLink, modules: Module[]): string {
  const s = modules.find((m) => m.id === l.sourceModuleId)
  const t = modules.find((m) => m.id === l.targetModuleId)
  const f = s?.fields.find((x) => x.id === l.trigger.fieldId)
  const when = l.trigger.type === 'field_changed' ? `${f?.label ?? 'a field'} changes` : triggerMeta(l.trigger.type).short
  const verb = { create_linked: 'create a linked record in', update_linked: 'update linked records in', link_records: 'link to records in' }[l.action.type]
  return `When ${s?.name ?? '?'} ${when} → ${verb} ${t?.name ?? '?'}`
}

export function validateFlow(l: DataFlowLink, modules: Module[]): string[] {
  const e: string[] = []
  const s = modules.find((m) => m.id === l.sourceModuleId)
  const t = modules.find((m) => m.id === l.targetModuleId)
  if (!l.name.trim()) e.push('Give the flow a name.')
  if (!s) e.push('The source module no longer exists.')
  if (!t) e.push('The target module no longer exists.')
  if (!s || !t) return e
  if (l.trigger.type === 'field_changed' && !s.fields.some((f) => f.id === l.trigger.fieldId)) e.push('Choose which field triggers the flow.')
  l.conditions.forEach((c, i) => { if (!s.fields.some((f) => f.id === c.fieldId) && !c.fieldId.startsWith('__')) e.push(`Condition ${i + 1}: choose a field.`) })
  const a = l.action
  const lf = a.linkField
  if (lf && !(lf.side === 'source' ? s : t).fields.some((f) => f.id === lf.fieldId)) e.push('The relationship field used to link the records no longer exists.')
  if (a.type === 'create_linked') {
    a.mappings.forEach((m, i) => {
      if (!s.fields.some((f) => f.id === m.sourceFieldId) || !t.fields.some((f) => f.id === m.targetFieldId)) e.push(`Mapping ${i + 1}: choose both fields.`)
    })
    const dup = a.mappings.map((m) => m.targetFieldId).filter((x, i, arr) => x && arr.indexOf(x) !== i)
    if (dup.length) e.push('Two mappings write to the same target field.')
    if (!a.mappings.length && !Object.keys(a.defaults).length && !lf) e.push('Map at least one field, set a default value, or choose a relationship to fill in.')
  }
  if (a.type === 'update_linked') {
    if (!lf) e.push('Choose the relationship that tells the flow which target records are linked.')
    if (!a.sets.length) e.push('Add at least one field to update.')
    a.sets.forEach((x, i) => {
      if (!t.fields.some((f) => f.id === x.targetFieldId)) e.push(`Update ${i + 1}: choose the target field.`)
      else if (x.mode === 'copy' && !s.fields.some((f) => f.id === x.sourceFieldId)) e.push(`Update ${i + 1}: choose the source field to copy.`)
    })
  }
  if (a.type === 'link_records') {
    if (l.trigger.type === 'record_deleted') e.push('“Link records” cannot run when a record is deleted. Choose another trigger.')
    if (!lf) e.push('Choose the relationship field to fill in.')
    if (!a.matchSourceFieldId || !s.fields.some((f) => f.id === a.matchSourceFieldId)) e.push('Choose the source field to match on.')
    if (!a.matchTargetFieldId || !t.fields.some((f) => f.id === a.matchTargetFieldId)) e.push('Choose the target field to match against.')
  }
  return e
}

export interface RelationEdge { id: string; fromId: ID; toId: ID; label: string; fieldId: string }

/** Existing relationship fields, drawn automatically as dashed lines. */
export function relationEdges(modules: Module[]): RelationEdge[] {
  const ids = new Set(modules.map((m) => m.id))
  const out: RelationEdge[] = []
  for (const m of modules) {
    for (const f of m.fields) {
      if (f.type === 'relationship' && f.relation && ids.has(f.relation.moduleId)) out.push({ id: `rel:${m.id}:${f.id}`, fromId: m.id, toId: f.relation.moduleId, label: f.label, fieldId: f.id })
    }
  }
  return out
}

const PAD = 56
const COL_W = 320
const ROW_H = 132

export function defaultNodePos(index: number): { x: number; y: number } {
  return { x: PAD + (index % 4) * (NODE_W + 60), y: PAD + Math.floor(index / 4) * ROW_H }
}

/** Layered left-to-right layout following the lines; unconnected modules go in a grid underneath. */
export function autoArrange(modules: Module[], edges: { from: ID; to: ID }[]): Record<ID, { x: number; y: number }> {
  const ids = modules.map((m) => m.id)
  const known = new Set(ids)
  const out = new Map<ID, Set<ID>>(ids.map((i) => [i, new Set<ID>()]))
  const indeg = new Map<ID, number>(ids.map((i) => [i, 0]))
  const connected = new Set<ID>()
  for (const e of edges) {
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to) || out.get(e.from)!.has(e.to)) continue
    out.get(e.from)!.add(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
    connected.add(e.from)
    connected.add(e.to)
  }
  const layer = new Map<ID, number>()
  const queue = ids.filter((i) => connected.has(i) && (indeg.get(i) ?? 0) === 0)
  queue.forEach((i) => layer.set(i, 0))
  const done = new Set<ID>()
  while (queue.length) {
    const v = queue.shift()!
    done.add(v)
    for (const w of out.get(v)!) {
      layer.set(w, Math.max(layer.get(w) ?? 0, (layer.get(v) ?? 0) + 1))
      indeg.set(w, (indeg.get(w) ?? 1) - 1)
      if ((indeg.get(w) ?? 0) === 0) queue.push(w)
    }
  }
  // members of cycles never reach in-degree 0: put them after everything else, in order
  let maxLayer = Math.max(0, ...[...layer.values()])
  const leftovers = ids.filter((i) => connected.has(i) && !done.has(i))
  if (leftovers.length) {
    maxLayer += 1
    leftovers.forEach((i) => layer.set(i, layer.get(i) ?? maxLayer))
  }
  const cols = new Map<number, ID[]>()
  for (const i of ids) if (connected.has(i)) cols.set(layer.get(i) ?? 0, [...(cols.get(layer.get(i) ?? 0) ?? []), i])
  const pos: Record<ID, { x: number; y: number }> = {}
  let rows = 0
  for (const [l, list] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    list.forEach((id, idx) => { pos[id] = { x: PAD + l * COL_W, y: PAD + idx * ROW_H } })
    rows = Math.max(rows, list.length)
  }
  const isolated = ids.filter((i) => !connected.has(i))
  const baseY = PAD + (rows ? rows * ROW_H + 40 : 0)
  isolated.forEach((id, idx) => { pos[id] = { x: PAD + (idx % 4) * (NODE_W + 60), y: baseY + Math.floor(idx / 4) * ROW_H } })
  return pos
}
