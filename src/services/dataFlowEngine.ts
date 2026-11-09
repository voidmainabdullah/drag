import { format } from 'date-fns'
import type { CrmRecord, DataFlowLink, Field, ID, Module } from '#/types'
import { nowIso, uid } from '#/utils/id'
import type { RecordEvent } from '#/utils/events'
import { displayValue, makeCtx, matchesFilter, recordTitle, toIds, valueOf, type Ctx } from '#/utils/records'
import { parseImportValue } from '#/utils/csv'
import { isEmpty, isMultiValue, isSingleRel } from '#/utils/fieldTypes'
import { flowSummary } from '#/utils/dataflow'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useDataFlowStore, useRunStore } from '#/stores/collections'
import { useUserStore } from '#/stores/userStore'
import { logActivity } from '#/stores/activityStore'

/** Same loop protection as workflows: a flow written record may trigger flows, but only this many levels deep. */
export const MAX_FLOW_DEPTH = 3

const modulesNow = () => useModuleStore.getState().modules
const ctxNow = (): Ctx => makeCtx(modulesNow(), useRecordStore.getState().records, useUserStore.getState().users)
const getModule = (id: ID): Module | undefined => modulesNow().find((m) => m.id === id)

function logRun(link: DataFlowLink, status: 'success' | 'skipped' | 'error', message: string, rec?: CrmRecord, key?: string) {
  useRunStore.getState().add({
    id: uid('run'),
    workspaceId: link.workspaceId,
    workflowId: link.id,
    workflowName: `Data flow: ${link.name}`,
    kind: 'dataflow',
    recordId: rec?.id,
    moduleId: rec?.moduleId ?? link.sourceModuleId,
    status,
    message,
    at: nowIso(),
    key,
  })
}

class FlowSkip extends Error {}

function tokens(tpl: string, m: Module, rec: CrmRecord, ctx: Ctx): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_all, key: string) => {
    if (key === 'today') return format(new Date(), 'yyyy-MM-dd')
    if (key === 'now') return nowIso()
    if (key === 'id') return rec.id
    if (key === 'title') return recordTitle(m, rec, ctx)
    if (key === 'module') return m.name
    const f = m.fields.find((x) => x.id === key || x.name === key)
    return f ? displayValue(f, valueOf(m, rec, f, ctx), ctx) : ''
  })
}

const TEXT_TYPES = new Set(['shortText', 'longText', 'email', 'phone', 'website'])

/** A typed default / fixed value, with {{tokens}} filled in for text fields. */
function fixedValue(target: Field, raw: unknown, sm: Module, rec: CrmRecord, ctx: Ctx): unknown {
  if (typeof raw === 'string' && raw.includes('{{') && TEXT_TYPES.has(target.type)) return tokens(raw, sm, rec, ctx)
  return raw
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Convert a source value so it fits the target field (same type is copied; others go through text). */
function convert(src: Field | undefined, tgt: Field, raw: unknown, ctx: Ctx): unknown {
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return undefined
  if (src && src.type === tgt.type) {
    if ((tgt.type === 'dropdown' || tgt.type === 'radio') && tgt.options) {
      const id = String(raw)
      if (tgt.options.some((o) => o.id === id)) return id
      const label = src.options?.find((o) => o.id === id)?.label
      return label ? tgt.options.find((o) => sameLabel(o.label, label))?.id : undefined
    }
    if ((tgt.type === 'multiSelect' || tgt.type === 'checkboxes') && tgt.options && Array.isArray(raw)) {
      const ids = (raw as string[]).map((id) => (tgt.options!.some((o) => o.id === id) ? id : tgt.options!.find((o) => sameLabel(o.label, src.options?.find((x) => x.id === id)?.label ?? '\u0000'))?.id)).filter((x): x is string => !!x)
      return ids.length ? ids : undefined
    }
    if (tgt.type === 'relationship') {
      if (src.relation?.moduleId === tgt.relation?.moduleId) return isSingleRel(tgt) ? toIds(raw)[0] : toIds(raw)
    } else return raw
  }
  const text = src ? displayValue(src, raw, ctx) : String(raw)
  if (!text.trim()) return undefined
  const parsed = parseImportValue(tgt, text, ctx, useRecordStore.getState().records)
  if (parsed.error) throw new Error(`${tgt.label}: ${parsed.error}`)
  return parsed.value
}

function addId(field: Field, current: unknown, id: ID): unknown {
  if (isSingleRel(field)) return id
  const cur = toIds(current)
  return cur.includes(id) ? cur : [...cur, id]
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function conditionsPass(link: DataFlowLink, sm: Module, rec: CrmRecord, ctx: Ctx): boolean {
  return link.conditions.every((c) => matchesFilter(sm, rec, { id: c.id, fieldId: c.fieldId, op: c.op, value: c.value }, ctx))
}

function targetsLinkedTo(link: DataFlowLink, sm: Module, tm: Module, rec: CrmRecord): CrmRecord[] {
  const lf = link.action.linkField
  if (!lf) throw new Error('No relationship field is set for this flow')
  const all = useRecordStore.getState().records.filter((r) => r.moduleId === tm.id && !r.deletedAt)
  if (lf.side === 'target') {
    if (!tm.fields.some((f) => f.id === lf.fieldId)) throw new Error('The relationship field no longer exists')
    return all.filter((r) => toIds(r.data[lf.fieldId]).includes(rec.id))
  }
  if (!sm.fields.some((f) => f.id === lf.fieldId)) throw new Error('The relationship field no longer exists')
  const ids = new Set(toIds(rec.data[lf.fieldId]))
  return all.filter((r) => ids.has(r.id))
}

function doCreateLinked(link: DataFlowLink, sm: Module, tm: Module, rec: CrmRecord, depth: number, ctx: Ctx): string {
  const a = link.action
  const data: Record<string, unknown> = {}
  for (const [fid, raw] of Object.entries(a.defaults)) {
    const f = tm.fields.find((x) => x.id === fid)
    if (!f || isEmpty(raw)) continue
    data[fid] = fixedValue(f, raw, sm, rec, ctx)
  }
  const notes: string[] = []
  for (const m of a.mappings) {
    const sf = sm.fields.find((x) => x.id === m.sourceFieldId)
    const tf = tm.fields.find((x) => x.id === m.targetFieldId)
    if (!sf || !tf) throw new Error('A mapped field no longer exists')
    try {
      const v = convert(sf, tf, valueOf(sm, rec, sf, ctx), ctx)
      if (v !== undefined) data[tf.id] = v
    } catch (e) {
      notes.push(e instanceof Error ? e.message : 'could not convert a value')
    }
  }
  const lf = a.linkField
  const linkTarget = lf?.side === 'target' ? tm.fields.find((f) => f.id === lf.fieldId) : undefined
  const linkSource = lf?.side === 'source' ? sm.fields.find((f) => f.id === lf.fieldId) : undefined
  if (lf && !linkTarget && !linkSource) throw new Error('The relationship field no longer exists')
  if (linkTarget) data[linkTarget.id] = isSingleRel(linkTarget) ? rec.id : [rec.id]

  const existing = useRecordStore.getState().records.find((r) => r.moduleId === tm.id && !r.deletedAt && r.origin?.linkId === link.id && r.origin.recordId === rec.id)
  const extra = notes.length ? ` (skipped: ${notes.join('; ')})` : ''
  if (existing) {
    useRecordStore.getState().update(existing.id, data, { depth: depth + 1 })
    return `Updated the ${tm.name} record "${recordTitle(tm, { ...existing, data: { ...existing.data, ...data } }, ctx)}" that this flow created earlier${extra}`
  }
  const res = useRecordStore.getState().create(tm.id, data, { depth: depth + 1, validate: false, origin: { linkId: link.id, recordId: rec.id } })
  if (!res.record) throw new Error('Could not create the record')
  if (linkSource) {
    const cur = useRecordStore.getState().records.find((r) => r.id === rec.id)
    useRecordStore.getState().update(rec.id, { [linkSource.id]: addId(linkSource, cur?.data[linkSource.id], res.record.id) }, { depth: depth + 1 })
  }
  return `Created ${tm.name} "${recordTitle(tm, res.record, ctx)}"${extra}`
}

function doUpdateLinked(link: DataFlowLink, sm: Module, tm: Module, rec: CrmRecord, depth: number, ctx: Ctx): string {
  const targets = targetsLinkedTo(link, sm, tm, rec)
  if (!targets.length) throw new FlowSkip(`No ${tm.name} records are linked to "${recordTitle(sm, rec, ctx)}"`)
  const patch: Record<string, unknown> = {}
  const notes: string[] = []
  for (const s of link.action.sets) {
    const tf = tm.fields.find((x) => x.id === s.targetFieldId)
    if (!tf) throw new Error('A field to update no longer exists')
    if (s.mode === 'value') {
      patch[tf.id] = fixedValue(tf, s.value, sm, rec, ctx)
      continue
    }
    const sf = sm.fields.find((x) => x.id === s.sourceFieldId)
    if (!sf) throw new Error('A source field no longer exists')
    try {
      const v = convert(sf, tf, valueOf(sm, rec, sf, ctx), ctx)
      const multi = isMultiValue(tf.type) || (tf.type === 'relationship' && !isSingleRel(tf))
      patch[tf.id] = v === undefined ? (multi ? [] : '') : v
    } catch (e) {
      notes.push(e instanceof Error ? e.message : 'could not convert a value')
    }
  }
  let changed = 0
  for (const t of targets) {
    const effective = Object.fromEntries(Object.entries(patch).filter(([k, v]) => !sameJson(t.data[k], v)))
    if (!Object.keys(effective).length) continue
    useRecordStore.getState().update(t.id, effective, { depth: depth + 1 })
    changed++
  }
  return `${changed ? `Updated ${changed} of ${targets.length}` : `Checked ${targets.length}`} linked ${tm.name} record${targets.length === 1 ? '' : 's'}${changed ? '' : ' (already up to date)'}${notes.length ? ` (skipped: ${notes.join('; ')})` : ''}`
}

const norm = (s: string) => s.trim().toLowerCase()

function doLinkRecords(link: DataFlowLink, sm: Module, tm: Module, rec: CrmRecord, depth: number, ctx: Ctx): string {
  const a = link.action
  const lf = a.linkField
  const sf = sm.fields.find((f) => f.id === a.matchSourceFieldId)
  const tf = tm.fields.find((f) => f.id === a.matchTargetFieldId)
  if (!lf || !sf || !tf) throw new Error('The flow is missing its relationship or match fields')
  const wanted = norm(displayValue(sf, valueOf(sm, rec, sf, ctx), ctx))
  if (!wanted) throw new FlowSkip(`${sf.label} is empty, so there is nothing to match`)
  const matches = useRecordStore.getState().records.filter((r) => r.moduleId === tm.id && !r.deletedAt && !r.archived && norm(displayValue(tf, valueOf(tm, r, tf, ctx), ctx)) === wanted)
  if (!matches.length) throw new FlowSkip(`No ${tm.name} record has ${tf.label} = “${displayValue(sf, valueOf(sm, rec, sf, ctx), ctx)}”`)
  const store = useRecordStore.getState()
  if (lf.side === 'source') {
    const f = sm.fields.find((x) => x.id === lf.fieldId)
    if (!f) throw new Error('The relationship field no longer exists')
    const fresh = store.records.find((r) => r.id === rec.id) ?? rec
    const next = isSingleRel(f) ? matches[0].id : [...new Set([...toIds(fresh.data[f.id]), ...matches.map((m) => m.id)])]
    if (sameJson(fresh.data[f.id], next)) return `Already linked to ${matches.length} ${tm.name} record${matches.length === 1 ? '' : 's'}`
    store.update(rec.id, { [f.id]: next }, { depth: depth + 1 })
    return `Linked to ${isSingleRel(f) ? '1' : matches.length} ${tm.name} record${matches.length === 1 || isSingleRel(f) ? '' : 's'}`
  }
  const f = tm.fields.find((x) => x.id === lf.fieldId)
  if (!f) throw new Error('The relationship field no longer exists')
  let n = 0
  for (const m of matches) {
    const next = addId(f, m.data[f.id], rec.id)
    if (sameJson(m.data[f.id], next)) continue
    store.update(m.id, { [f.id]: next }, { depth: depth + 1 })
    n++
  }
  return n ? `Linked ${n} ${tm.name} record${n === 1 ? '' : 's'} to this record` : `Already linked to ${matches.length} ${tm.name} record${matches.length === 1 ? '' : 's'}`
}

export function executeFlow(link: DataFlowLink, recInput: CrmRecord, depth = 0, opts: { key?: string } = {}): boolean {
  const rec = useRecordStore.getState().records.find((r) => r.id === recInput.id) ?? recInput
  if (depth >= MAX_FLOW_DEPTH) {
    logRun(link, 'error', 'Stopped: records written by flows and workflows triggered each other too many times (loop protection)', rec, opts.key)
    return false
  }
  const sm = getModule(link.sourceModuleId)
  const tm = getModule(link.targetModuleId)
  if (!sm || !tm) {
    logRun(link, 'error', 'The source or target module no longer exists', rec, opts.key)
    return false
  }
  const ctx = ctxNow()
  try {
    if (!conditionsPass(link, sm, rec, ctx)) {
      logRun(link, 'skipped', 'Conditions not met', rec, opts.key)
      return false
    }
    const msg =
      link.action.type === 'create_linked' ? doCreateLinked(link, sm, tm, rec, depth, ctx)
      : link.action.type === 'update_linked' ? doUpdateLinked(link, sm, tm, rec, depth, ctx)
      : doLinkRecords(link, sm, tm, rec, depth, ctx)
    logRun(link, 'success', `${msg} — from "${recordTitle(sm, rec, ctx)}"`, rec, opts.key)
    logActivity({ workspaceId: link.workspaceId, action: 'dataflow_ran', entity: 'workflow', moduleId: sm.id, recordId: rec.id, description: `Data flow "${link.name}": ${msg}` })
    return true
  } catch (e) {
    if (e instanceof FlowSkip) logRun(link, 'skipped', e.message, rec, opts.key)
    else logRun(link, 'error', e instanceof Error ? e.message : 'Unknown error', rec, opts.key)
    return false
  }
}

function triggerMatches(link: DataFlowLink, e: RecordEvent): boolean {
  const t = link.trigger
  switch (t.type) {
    case 'record_created': return e.type === 'created'
    case 'record_updated': return e.type === 'updated'
    case 'record_deleted': return e.type === 'deleted'
    case 'field_changed': {
      if (e.type !== 'updated' || !t.fieldId || !e.previous) return false
      const before = JSON.stringify(e.previous.data[t.fieldId] ?? '')
      const now = e.record.data[t.fieldId]
      if (before === JSON.stringify(now ?? '')) return false
      if (!isEmpty(t.value) && String(now) !== String(t.value)) return false
      return true
    }
  }
}

/** Called by the workflow engine for every record create / update / delete. */
export function handleFlowEvent(e: RecordEvent) {
  const links = useDataFlowStore.getState().items.filter((l) => l.enabled && l.sourceModuleId === e.record.moduleId && l.workspaceId === e.record.workspaceId)
  for (const link of links) {
    if (!triggerMatches(link, e)) continue
    executeFlow(link, e.record, e.depth)
  }
}

/** “Run on existing records”: applies one flow to every active source record (or a chosen few). */
export function runFlowNow(link: DataFlowLink, recordIds?: ID[]): { ran: number; total: number } {
  const all = useRecordStore.getState().records.filter((r) => r.moduleId === link.sourceModuleId && !r.deletedAt && !r.archived)
  const targets = recordIds ? all.filter((r) => recordIds.includes(r.id)) : all
  let ran = 0
  for (const r of targets) if (executeFlow(link, r, 0)) ran++
  if (!targets.length) logRun(link, 'skipped', `No records to run on (${flowSummary(link, modulesNow())})`)
  return { ran, total: targets.length }
}
