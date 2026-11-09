import { create } from 'zustand'
import type { CrmRecord, FileMeta, ID } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { defaultValueFor, isEmpty } from '#/utils/fieldTypes'
import { nextAutoId, recordTitle } from '#/utils/records'
import { validatePipelines, validateRecordData } from '#/utils/validation'
import { emitRecordEvent } from '#/utils/events'
import { deleteFile } from '#/services/storage/fileStorage'
import { describeBlocked, planDelete } from '#/genius/permissions/deletePolicy'
import { logActivity } from './activityStore'
import { useModuleStore } from './moduleStore'
import { useSettingsStore } from './settingsStore'

export interface WriteOpts {
  depth?: number
  /** workflow ids that caused this write (loop prevention) */
  chain?: string[]
  validate?: boolean
  source?: string
  silent?: boolean
  /** set by data flows so a created record remembers which flow and source record produced it */
  origin?: { linkId: ID; recordId: ID }
}

export type WriteResult = { record: CrmRecord; errors?: undefined } | { record?: undefined; errors: Record<string, string> }

interface RecordState {
  records: CrmRecord[]
  setAll: (r: CrmRecord[]) => void
  create: (moduleId: ID, data: Record<string, unknown>, opts?: WriteOpts) => WriteResult
  update: (id: ID, patch: Record<string, unknown>, opts?: WriteOpts) => WriteResult | null
  bulkUpdate: (ids: ID[], patch: Record<string, unknown>) => void
  /** Moves records to the trash, honouring relationship delete policies. Refused (nothing changes) when a `restrict` link still points at one. */
  softDelete: (ids: ID[]) => { ok: boolean; message?: string; removed: number }
  restore: (ids: ID[]) => void
  archive: (ids: ID[], archived: boolean) => void
  purge: (ids: ID[]) => void
  duplicate: (id: ID) => CrmRecord | null
  addAttachment: (id: ID, meta: FileMeta) => void
  removeAttachment: (id: ID, fileId: string) => void
  removeByModule: (moduleId: ID) => void
  removeByWorkspace: (ws: ID) => void
}

/** pipeline fields with time-in-stage tracking: remember when the record entered its current stage */
function stageStamps(m: { fields: import('#/types').Field[] }, data: Record<string, unknown>, prev: CrmRecord | undefined, current: Record<string, string> | undefined, t: string): Record<string, string> | undefined {
  let out = current
  for (const f of m.fields) {
    if (!f.pipeline?.trackTimeInStage) continue
    const to = data[f.id]
    if (typeof to !== 'string' || !to) continue
    if (!prev || prev.data[f.id] !== to || !current?.[f.id]) out = { ...(out ?? {}), [f.id]: t }
  }
  return out
}

const getModule = (id: ID) => useModuleStore.getState().modules.find((m) => m.id === id)

export const useRecordStore = create<RecordState>((set, get) => ({
  records: [],
  setAll: (records) => set({ records }),

  create: (moduleId, data, opts = {}) => {
    const m = getModule(moduleId)
    if (!m) return { errors: { _: 'Module not found' } }
    const full: Record<string, unknown> = { ...data }
    for (const f of m.fields) {
      if (f.type === 'formula') {
        delete full[f.id]
        continue
      }
      if (f.type === 'autoId') {
        const gen = nextAutoId(useModuleStore.getState().modules.find((x) => x.id === moduleId)!, f)
        useModuleStore.getState().update(moduleId, { counters: gen.counters })
        full[f.id] = gen.value
        continue
      }
      if (full[f.id] === undefined) full[f.id] = defaultValueFor(f)
    }
    if (opts.validate !== false) {
      const errors = validateRecordData(m, full, { existing: get().records })
      if (Object.keys(errors).length) return { errors }
    }
    const t = nowIso()
    const stageEnteredAt = stageStamps(m, full, undefined, undefined, t)
    const rec: CrmRecord = {
      ...(stageEnteredAt ? { stageEnteredAt } : {}),
      id: uid('rec'),
      workspaceId: m.workspaceId,
      moduleId,
      data: full,
      createdAt: t,
      updatedAt: t,
      createdBy: useSettingsStore.getState().settings.currentUserId,
      source: opts.source,
      origin: opts.origin,
    }
    set((s) => ({ records: [...s.records, rec] }))
    logActivity({ workspaceId: m.workspaceId, action: 'record_created', entity: 'record', moduleId, recordId: rec.id, description: `Created ${m.name} "${recordTitle(m, rec)}"${opts.source ? ' via form' : ''}` })
    if (!opts.silent) emitRecordEvent({ type: 'created', record: rec, depth: opts.depth ?? 0, chain: opts.chain })
    return { record: rec }
  },

  update: (id, patch, opts = {}) => {
    const prev = get().records.find((r) => r.id === id)
    if (!prev) return null
    const m = getModule(prev.moduleId)
    if (!m) return null
    const data = { ...prev.data, ...patch }
    for (const f of m.fields) if (f.type === 'formula') delete data[f.id]
    if (opts.validate) {
      const errors = validateRecordData(m, data, { existing: get().records, selfId: id, previous: prev })
      if (Object.keys(errors).length) return { errors }
    } else {
      // stage rules apply to every write (drag on a board, a workflow, an import), not only to validated form saves
      const errors = validatePipelines(m, data, prev)
      if (Object.keys(errors).length) return { errors }
    }
    const t = nowIso()
    const stageEnteredAt = stageStamps(m, data, prev, prev.stageEnteredAt, t)
    const rec: CrmRecord = { ...prev, data, updatedAt: t, ...(stageEnteredAt ? { stageEnteredAt } : {}) }
    set((s) => ({ records: s.records.map((r) => (r.id === id ? rec : r)) }))
    const changed = Object.keys(patch).filter((k) => JSON.stringify(prev.data[k]) !== JSON.stringify(data[k]))
    if (changed.length) {
      const labels = changed.map((k) => m.fields.find((f) => f.id === k)?.label ?? k).join(', ')
      logActivity({ workspaceId: m.workspaceId, action: 'record_updated', entity: 'record', moduleId: m.id, recordId: id, description: `Updated ${labels} on "${recordTitle(m, rec)}"` })
      if (!opts.silent) emitRecordEvent({ type: 'updated', record: rec, previous: prev, depth: opts.depth ?? 0, chain: opts.chain })
    }
    return { record: rec }
  },

  bulkUpdate: (ids, patch) => {
    ids.forEach((id) => get().update(id, patch))
  },

  softDelete: (ids) => {
    const t = nowIso()
    // relationship delete policies (restrict / cascade / set_null) set by the builder or by hand
    const modules = useModuleStore.getState().modules
    const plan = planDelete(ids, modules, get().records)
    if (plan.blocked.length) return { ok: false, message: describeBlocked(plan, modules, get().records), removed: 0 }
    const set_ = new Set(plan.remove)
    const targets = get().records.filter((r) => set_.has(r.id) && !r.deletedAt)
    set((s) => ({ records: s.records.map((r) => (set_.has(r.id) ? { ...r, deletedAt: t } : r)) }))
    for (const c of plan.clear) get().update(c.recordId, { [c.fieldId]: c.value }, { validate: false })
    for (const r of targets) {
      const m = getModule(r.moduleId)
      if (!m) continue
      logActivity({ workspaceId: m.workspaceId, action: 'record_deleted', entity: 'record', moduleId: m.id, recordId: r.id, description: `Moved ${m.name} "${recordTitle(m, r)}" to trash` })
      emitRecordEvent({ type: 'deleted', record: { ...r, deletedAt: t }, depth: 0 })
    }
    return { ok: true, removed: targets.length }
  },

  restore: (ids) => {
    const s_ = new Set(ids)
    const targets = get().records.filter((r) => s_.has(r.id))
    set((s) => ({ records: s.records.map((r) => (s_.has(r.id) ? { ...r, deletedAt: undefined, archived: false } : r)) }))
    for (const r of targets) {
      const m = getModule(r.moduleId)
      if (m) logActivity({ workspaceId: m.workspaceId, action: 'record_restored', entity: 'record', moduleId: m.id, recordId: r.id, description: `Restored ${m.name} "${recordTitle(m, r)}"` })
    }
  },

  archive: (ids, archived) => {
    const s_ = new Set(ids)
    const targets = get().records.filter((r) => s_.has(r.id))
    set((s) => ({ records: s.records.map((r) => (s_.has(r.id) ? { ...r, archived } : r)) }))
    for (const r of targets) {
      const m = getModule(r.moduleId)
      if (m) logActivity({ workspaceId: m.workspaceId, action: archived ? 'record_archived' : 'record_unarchived', entity: 'record', moduleId: m.id, recordId: r.id, description: `${archived ? 'Archived' : 'Unarchived'} ${m.name} "${recordTitle(m, r)}"` })
    }
  },

  purge: (ids) => {
    const s_ = new Set(ids)
    const targets = get().records.filter((r) => s_.has(r.id))
    const fileIds = targets.flatMap((r) => [
      ...(r.attachments ?? []).map((a) => a.id),
      ...Object.values(r.data).flatMap((v) => (Array.isArray(v) ? v.filter((x): x is FileMeta => !!x && typeof x === 'object' && 'id' in x && 'size' in x).map((x) => x.id) : [])),
    ])
    fileIds.forEach((f) => void deleteFile(f))
    set((s) => ({ records: s.records.filter((r) => !s_.has(r.id)) }))
    for (const r of targets) {
      const m = getModule(r.moduleId)
      if (m) logActivity({ workspaceId: m.workspaceId, action: 'record_purged', entity: 'record', moduleId: m.id, description: `Permanently deleted ${m.name} "${recordTitle(m, r)}"` })
    }
  },

  duplicate: (id) => {
    const src = get().records.find((r) => r.id === id)
    if (!src) return null
    const m = getModule(src.moduleId)
    if (!m) return null
    const data = { ...src.data }
    for (const f of m.fields) {
      if (f.type === 'autoId') delete data[f.id]
      else if (f.unique && !isEmpty(data[f.id])) data[f.id] = defaultValueFor(f)
    }
    const res = get().create(m.id, data, { validate: false })
    return res.record ?? null
  },

  addAttachment: (id, meta) =>
    set((s) => ({ records: s.records.map((r) => (r.id === id ? { ...r, attachments: [...(r.attachments ?? []), meta], updatedAt: nowIso() } : r)) })),
  removeAttachment: (id, fileId) => {
    void deleteFile(fileId)
    set((s) => ({ records: s.records.map((r) => (r.id === id ? { ...r, attachments: (r.attachments ?? []).filter((a) => a.id !== fileId) } : r)) }))
  },
  removeByModule: (moduleId) => set((s) => ({ records: s.records.filter((r) => r.moduleId !== moduleId) })),
  removeByWorkspace: (ws) => set((s) => ({ records: s.records.filter((r) => r.workspaceId !== ws) })),
}))
