import { z } from 'zod'
import { CURRENT_VERSION, DATA_KEYS, KEYS, readJson, removeKey, storageKey, writeJson, type StorageKey } from './storageService'
import { exportFiles, importFiles } from './fileStorage'
import { flushAll, reloadFromStorage } from '#/stores'
import { useModuleStore } from '#/stores/moduleStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { placeModuleInNav } from '#/services/moduleService'
import { nowIso, uid } from '#/utils/id'

export type MergeMode = 'replace' | 'merge'
export type DuplicateMode = 'skip' | 'overwrite' | 'duplicate'

export interface Backup {
  app: 'xcrm'
  schemaVersion: number
  exportedAt: string
  data: Partial<Record<StorageKey, unknown>>
  files?: Record<string, { dataUrl: string }>
}

/** Collections: arrays of objects that have a string `id`. */
const LIST_KEYS = DATA_KEYS.filter((k) => k !== KEYS.settings) as StorageKey[]
const ENTITY_LABEL: Record<string, string> = {
  [KEYS.workspaces]: 'Workspaces',
  [KEYS.modules]: 'Modules',
  [KEYS.records]: 'Records',
  [KEYS.templates]: 'Templates',
  [KEYS.forms]: 'Forms',
  [KEYS.views]: 'Views',
  [KEYS.dashboards]: 'Dashboards',
  [KEYS.workflows]: 'Workflows',
  [KEYS.workflowRuns]: 'Workflow runs',
  [KEYS.dataflows]: 'Data flows',
  [KEYS.users]: 'Team members',
  [KEYS.roles]: 'Roles',
  [KEYS.activities]: 'Activity log',
  [KEYS.genius]: 'Genius AI history',
}
/** Keys whose items must never be duplicated under new ids (shared / identity-like). */
const NEVER_DUPLICATE = new Set<string>([KEYS.users, KEYS.roles])

const itemSchema = z.object({ id: z.string().min(1) }).passthrough()
const backupSchema = z.object({
  app: z.literal('xcrm'),
  schemaVersion: z.number().int().min(1),
  exportedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.object({ dataUrl: z.string() })).optional(),
})

export interface BackupSummary {
  exportedAt: string
  schemaVersion: number
  counts: { key: string; label: string; count: number }[]
  workspaces: string[]
  fileCount: number
  includesSettings: boolean
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  summary?: BackupSummary
  backup?: Backup
}

const key = (k: string) => k as StorageKey

export async function createBackup(includeFiles: boolean): Promise<Backup> {
  flushAll()
  const data: Backup['data'] = {}
  for (const k of DATA_KEYS) {
    const v = readJson<unknown>(k, undefined)
    if (v !== undefined) data[k] = v
  }
  const backup: Backup = { app: 'xcrm', schemaVersion: CURRENT_VERSION, exportedAt: nowIso(), data }
  if (includeFiles) {
    const ids = new Set<string>()
    const collect = (v: unknown) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) return v.forEach(collect)
      const o = v as Record<string, unknown>
      // FileMeta objects look like { id, name, size, type }
      if (typeof o.id === 'string' && typeof o.name === 'string' && typeof o.size === 'number' && typeof o.type === 'string') ids.add(o.id)
      Object.values(o).forEach(collect)
    }
    collect(data[KEYS.records])
    backup.files = await exportFiles([...ids])
  }
  const s = useSettingsStore.getState().settings
  useSettingsStore.getState().setAll({ ...s, lastBackupAt: backup.exportedAt })
  return backup
}

/** Apply forward migrations to the data inside an older backup. */
function migrateData(data: Backup['data'], from: number): Backup['data'] {
  const out = { ...data }
  if (from < 2 && Array.isArray(out[KEYS.modules])) {
    out[KEYS.modules] = (out[KEYS.modules] as Record<string, unknown>[]).map((m) => ({
      ...m,
      fields: ((m.fields as Record<string, unknown>[]) ?? []).map((f, i) => ({ width: 'full', order: i, ...f })),
    }))
  }
  return out
}

export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const parsed = backupSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first?.path.join('.') || 'file'
    errors.push(typeof input === 'object' && input && (input as { app?: unknown }).app !== 'xcrm' ? 'This is not an Xcrm backup (missing app: "xcrm").' : `Invalid backup structure at “${where}”: ${first?.message}`)
    return { ok: false, errors, warnings }
  }
  const b = parsed.data as unknown as Backup
  if (b.schemaVersion > CURRENT_VERSION) errors.push(`This backup was made by a newer version of Xcrm (schema v${b.schemaVersion}; this app understands up to v${CURRENT_VERSION}).`)
  const unknown = Object.keys(b.data).filter((k) => !DATA_KEYS.includes(key(k)))
  if (unknown.length) warnings.push(`Ignoring unrecognised keys: ${unknown.join(', ')}`)

  for (const k of LIST_KEYS) {
    const v = b.data[k]
    if (v === undefined) continue
    if (!Array.isArray(v)) { errors.push(`“${ENTITY_LABEL[k]}” must be a list.`); continue }
    const bad = v.findIndex((x) => !itemSchema.safeParse(x).success)
    if (bad >= 0) errors.push(`“${ENTITY_LABEL[k]}” item #${bad + 1} is missing an id or is not an object.`)
  }
  const settings = b.data[KEYS.settings]
  if (settings !== undefined && (typeof settings !== 'object' || settings === null || Array.isArray(settings))) errors.push('Settings must be an object.')
  if (errors.length) return { ok: false, errors, warnings }

  const data = b.schemaVersion < CURRENT_VERSION ? migrateData(b.data, b.schemaVersion) : b.data
  const migrated: Backup = { ...b, data }
  const modules = (data[KEYS.modules] as { id: string; workspaceId?: string; fields?: unknown }[] | undefined) ?? []
  const moduleIds = new Set(modules.map((m) => m.id))
  const wsIds = new Set(((data[KEYS.workspaces] as { id: string }[] | undefined) ?? []).map((w) => w.id))
  const records = (data[KEYS.records] as { moduleId?: string }[] | undefined) ?? []
  const orphans = records.filter((r) => r.moduleId && !moduleIds.has(r.moduleId)).length
  if (orphans) warnings.push(`${orphans} record(s) belong to modules that are not in this backup. They will only be usable in merge mode if those modules already exist.`)
  const badModules = modules.filter((m) => !Array.isArray(m.fields)).length
  if (badModules) errors.push(`${badModules} module(s) have no field list and cannot be restored.`)
  const modWs = modules.filter((m) => m.workspaceId && !wsIds.has(m.workspaceId)).length
  if (modWs) warnings.push(`${modWs} module(s) reference a workspace that is not in this backup.`)
  if (errors.length) return { ok: false, errors, warnings }

  const summary: BackupSummary = {
    exportedAt: b.exportedAt,
    schemaVersion: b.schemaVersion,
    counts: LIST_KEYS.map((k) => ({ key: k, label: ENTITY_LABEL[k], count: Array.isArray(data[k]) ? (data[k] as unknown[]).length : 0 })).filter((c) => c.count > 0),
    workspaces: ((data[KEYS.workspaces] as { name?: string }[] | undefined) ?? []).map((w) => w.name ?? 'Untitled'),
    fileCount: b.files ? Object.keys(b.files).length : 0,
    includesSettings: settings !== undefined,
  }
  if (b.schemaVersion < CURRENT_VERSION) warnings.push(`Older backup (schema v${b.schemaVersion}) — it will be upgraded to v${CURRENT_VERSION} while restoring.`)
  return { ok: true, errors, warnings, summary, backup: migrated }
}

type Item = { id: string; [k: string]: unknown }

function currentData(): Record<string, Item[]> {
  flushAll()
  const out: Record<string, Item[]> = {}
  for (const k of LIST_KEYS) {
    const v = readJson<unknown>(k, [])
    out[k] = Array.isArray(v) ? (v as Item[]) : []
  }
  return out
}

export interface MergePlanRow { label: string; incoming: number; added: number; existing: number; overwritten: number; skipped: number; duplicated: number }

/** Describe what a restore would do without touching any data. */
export function planBackup(backup: Backup, mode: MergeMode, dupes: DuplicateMode): MergePlanRow[] {
  const cur = currentData()
  return LIST_KEYS.filter((k) => Array.isArray(backup.data[k]) && (backup.data[k] as unknown[]).length > 0).map((k) => {
    const incoming = backup.data[k] as Item[]
    const have = new Set(cur[k].map((i) => i.id))
    const clash = incoming.filter((i) => have.has(i.id)).length
    const fresh = incoming.length - clash
    if (mode === 'replace') return { label: ENTITY_LABEL[k], incoming: incoming.length, added: incoming.length, existing: cur[k].length, overwritten: 0, skipped: 0, duplicated: 0 }
    const dupAs = NEVER_DUPLICATE.has(k) && dupes === 'duplicate' ? 'skip' : dupes
    return { label: ENTITY_LABEL[k], incoming: incoming.length, added: fresh, existing: cur[k].length, overwritten: dupAs === 'overwrite' ? clash : 0, skipped: dupAs === 'skip' ? clash : 0, duplicated: dupAs === 'duplicate' ? clash : 0 }
  })
}

/** Give clashing ids new values everywhere they appear in the incoming data. */
function remapClashes(backup: Backup, cur: Record<string, Item[]>): Backup {
  const map = new Map<string, string>()
  for (const k of LIST_KEYS) {
    if (NEVER_DUPLICATE.has(k) || !Array.isArray(backup.data[k])) continue
    const have = new Set(cur[k].map((i) => i.id))
    for (const item of backup.data[k] as Item[]) if (have.has(item.id)) map.set(item.id, uid(item.id.split('_')[0] || 'id'))
  }
  if (!map.size) return backup
  const replaced = JSON.stringify(backup.data).replace(/"((?:\\.|[^"\\])*)"/g, (all, inner: string) => (map.has(inner) ? `"${map.get(inner)}"` : all))
  return { ...backup, data: JSON.parse(replaced) as Backup['data'] }
}

export async function applyBackup(backup: Backup, mode: MergeMode, dupes: DuplicateMode): Promise<{ ok: boolean; message: string }> {
  const cur = currentData()
  // snapshot of what is about to change, so a failed restore can be rolled back
  const snapshot: Record<string, string | null> = {}
  try { for (const k of [KEYS.version, ...DATA_KEYS]) snapshot[k] = window.localStorage.getItem(storageKey(k)) } catch { /* storage unavailable */ }
  try {
    if (backup.files && Object.keys(backup.files).length) await importFiles(backup.files)

    if (mode === 'replace') {
      for (const k of DATA_KEYS) {
        const v = backup.data[k]
        if (v === undefined) removeKey(k)
        else if (!writeJson(k, v)) throw new Error('Browser storage is full.')
      }
    } else {
      const b = dupes === 'duplicate' ? remapClashes(backup, cur) : backup
      for (const k of LIST_KEYS) {
        const incoming = b.data[k]
        if (!Array.isArray(incoming)) continue
        const existing = cur[k]
        const idx = new Map(existing.map((i, n) => [i.id, n]))
        const next = [...existing]
        const mode2 = NEVER_DUPLICATE.has(k) && dupes === 'duplicate' ? 'skip' : dupes
        for (const item of incoming as Item[]) {
          const at = idx.get(item.id)
          if (at === undefined) { idx.set(item.id, next.length); next.push(item); continue }
          if (mode2 === 'overwrite') next[at] = item
          // skip: keep existing. duplicate: ids were remapped so a clash only happens for NEVER_DUPLICATE keys.
        }
        if (!writeJson(k, next)) throw new Error('Browser storage is full.')
      }
      const inSettings = b.data[KEYS.settings] as Partial<ReturnType<typeof useSettingsStore.getState>['settings']> | undefined
      if (inSettings) {
        const s = readJson<ReturnType<typeof useSettingsStore.getState>['settings']>(KEYS.settings, useSettingsStore.getState().settings)
        const wsHave = new Set((cur[KEYS.workspaces] ?? []).map((w) => w.id))
        const nav = { ...s.nav }
        const favourites = { ...s.favourites }
        const recents = { ...s.recents }
        for (const ws of Object.keys(inSettings.nav ?? {})) if (!wsHave.has(ws) || dupes === 'overwrite') nav[ws] = inSettings.nav![ws]
        for (const ws of Object.keys(inSettings.favourites ?? {})) if (!wsHave.has(ws) || dupes === 'overwrite') favourites[ws] = inSettings.favourites![ws]
        for (const ws of Object.keys(inSettings.recents ?? {})) if (!wsHave.has(ws) || dupes === 'overwrite') recents[ws] = inSettings.recents![ws]
        const known = new Set(s.integrations.map((i) => i.id))
        const integrations = [...s.integrations, ...(inSettings.integrations ?? []).filter((i) => !known.has(i.id))]
        writeJson(KEYS.settings, { ...s, nav, favourites, recents, integrations })
      }
    }
    writeJson(KEYS.version, CURRENT_VERSION)
    reloadFromStorage()
    // make sure every restored module is reachable from the sidebar
    const settings = useSettingsStore.getState()
    for (const m of useModuleStore.getState().modules) {
      // modules the user chose to keep out of the sidebar stay out; blank workspaces keep their empty sidebar
      if (m.system || m.archived || m.showInNav === false) continue
      if (!settings.getNav(m.workspaceId).some((n) => n.moduleId === m.id)) placeModuleInNav(m)
    }
    return { ok: true, message: mode === 'replace' ? 'Backup restored — all data was replaced.' : 'Backup merged into your workspace.' }
  } catch (e) {
    try {
      for (const [k, v] of Object.entries(snapshot)) {
        if (v === null) window.localStorage.removeItem(storageKey(k))
        else window.localStorage.setItem(storageKey(k), v)
      }
      reloadFromStorage()
    } catch { /* ignore */ }
    return { ok: false, message: `${e instanceof Error ? e.message : 'Restore failed'} Your previous data was kept.` }
  }
}
