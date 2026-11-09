import { toast } from '#/utils/toast'

export const KEYS = {
  version: 'crm:app:version',
  workspaces: 'crm:workspaces',
  modules: 'crm:modules',
  records: 'crm:records',
  templates: 'crm:templates',
  forms: 'crm:forms',
  views: 'crm:views',
  dashboards: 'crm:dashboards',
  workflows: 'crm:workflows',
  workflowRuns: 'crm:workflowRuns',
  dataflows: 'crm:dataflows',
  settings: 'crm:settings',
  users: 'crm:users',
  roles: 'crm:roles',
  activities: 'crm:activities',
  /** Genius AI builder state (version history, audit log, memory). A list of per-workspace documents so backups handle it like any collection. */
  genius: 'crm:genius',
} as const

export type StorageKey = (typeof KEYS)[keyof typeof KEYS]
export const DATA_KEYS: StorageKey[] = Object.values(KEYS).filter((k) => k !== KEYS.version)

export const CURRENT_VERSION = 4

/**
 * Per-account namespace. Once a user is signed in, every `crm:*` key is transparently stored as
 * `crm:u:<userId>:*`, so two accounts in one browser never see each other's CRM. With no namespace
 * (tests, signed-out) keys are used as they are.
 */
let namespace: string | null = null
const SAFE_NS = /^[A-Za-z0-9_-]{1,64}$/

export function setStorageNamespace(id: string | null) {
  if (id !== null && !SAFE_NS.test(id)) throw new Error('Invalid storage namespace')
  namespace = id
}
export const getStorageNamespace = () => namespace
export function storageKey(key: string): string {
  return namespace && key.startsWith('crm:') ? `crm:u:${namespace}:${key.slice(4)}` : key
}
/** true when a raw localStorage key belongs to the active namespace's data */
export function isOwnStorageKey(rawKey: string): boolean {
  if (!rawKey.startsWith('crm:') || rawKey.endsWith(':corrupt')) return false
  return namespace ? rawKey.startsWith(`crm:u:${namespace}:`) : !rawKey.startsWith('crm:u:')
}

const LEGACY_CLAIM = 'crm:legacyClaimedBy'

/**
 * Data created before accounts existed lives under plain `crm:*` keys. The first account that signs in
 * adopts a copy of it (the originals are left in place, so nothing is ever lost). Later accounts start empty.
 */
export function adoptLegacyData(userId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const ls = window.localStorage
    const claimed = ls.getItem(LEGACY_CLAIM)
    if (claimed) return claimed === userId
    const mine = (k: string) => `crm:u:${userId}:${k.slice(4)}`
    if (DATA_KEYS.some((k) => ls.getItem(mine(k)) !== null)) return false
    const legacy = [KEYS.version, ...DATA_KEYS].filter((k) => ls.getItem(k) !== null)
    if (!legacy.length) return false
    for (const k of legacy) ls.setItem(mine(k), ls.getItem(k)!)
    ls.setItem(LEGACY_CLAIM, userId)
    return true
  } catch {
    return false
  }
}

let warnedUnavailable = false
let warnedQuota = 0

export function storageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const k = '__crm_test__'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

function warnUnavailable() {
  if (warnedUnavailable) return
  warnedUnavailable = true
  toast.error('Browser storage is unavailable', 'Changes will only live in memory and will be lost on reload. Check private-mode or cookie settings.')
}

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(storageKey(key))
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch (e) {
    if (e instanceof SyntaxError) {
      try {
        const raw = window.localStorage.getItem(storageKey(key))
        if (raw) window.localStorage.setItem(`${storageKey(key)}:corrupt`, raw)
      } catch {
        /* ignore */
      }
      toast.warning('Recovered from corrupt data', `"${key}" could not be read and was reset. A copy was kept under ${key}:corrupt.`)
    } else warnUnavailable()
    return fallback
  }
}

export function writeJson(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(value))
    return true
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      const now = Date.now()
      if (now - warnedQuota > 10000) {
        warnedQuota = now
        toast.error('Storage is full', 'Your browser storage quota was exceeded, so the latest changes could not be saved. Export a backup and remove large data.')
      }
    } else warnUnavailable()
    return false
  }
}

export function removeKey(key: string) {
  try {
    window.localStorage.removeItem(storageKey(key))
  } catch {
    /* ignore */
  }
}

export function storageUsage(): { bytes: number; perKey: Record<string, number> } {
  const perKey: Record<string, number> = {}
  let bytes = 0
  if (typeof window === 'undefined') return { bytes, perKey }
  try {
    for (const key of [KEYS.version, ...DATA_KEYS]) {
      const v = window.localStorage.getItem(storageKey(key))
      if (v) {
        perKey[key] = (v.length + key.length) * 2
        bytes += perKey[key]
      }
    }
  } catch {
    /* ignore */
  }
  return { bytes, perKey }
}

type Migration = (read: <T>(key: string, fb: T) => T, write: (key: string, v: unknown) => void) => void

/** Each migration upgrades persisted data from version (n-1) to n. */
const migrations: Record<number, Migration> = {
  2: (read, write) => {
    // v2: every field has width + order, settings gained `autosave`
    const modules = read<Record<string, unknown>[]>(KEYS.modules, [])
    const fixed = modules.map((m) => ({
      ...m,
      fields: ((m.fields as Record<string, unknown>[]) ?? []).map((f, i) => ({ width: 'full', order: i, ...f })),
    }))
    write(KEYS.modules, fixed)
    const settings = read<Record<string, unknown> | null>(KEYS.settings, null)
    if (settings) write(KEYS.settings, { autosave: true, ...settings })
  },
  3: (read, write) => {
    // v3: module-to-module data flows live under their own key; make sure it exists and is a list
    const flows = read<unknown>(KEYS.dataflows, null)
    if (!Array.isArray(flows)) write(KEYS.dataflows, [])
  },
  4: (read, write) => {
    // v4: Genius AI builder state lives under its own key (list of per-workspace documents)
    const g = read<unknown>(KEYS.genius, null)
    if (!Array.isArray(g)) write(KEYS.genius, [])
  },
}

export function runMigrations(): void {
  if (typeof window === 'undefined') return
  const hasData = DATA_KEYS.some((k) => window.localStorage.getItem(storageKey(k)) !== null)
  let version = readJson<number>(KEYS.version, hasData ? 1 : CURRENT_VERSION)
  if (typeof version !== 'number') version = 1
  if (version > CURRENT_VERSION) {
    toast.warning('Data from a newer version', 'Stored data was written by a newer version of Xcrm. Some information may not display correctly.')
    return
  }
  while (version < CURRENT_VERSION) {
    version++
    const m = migrations[version]
    try {
      m?.(readJson, writeJson)
    } catch (e) {
      console.error('Migration failed', version, e)
      toast.error('Data migration failed', `Upgrade to schema v${version} failed. Your data was left untouched.`)
      return
    }
  }
  writeJson(KEYS.version, CURRENT_VERSION)
}
