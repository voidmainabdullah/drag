import type { Dashboard, Form, Module, Role, View, Workflow } from '#/types'

/**
 * The canonical CRM configuration of ONE workspace, as plain data.
 * It is read from / written to the real zustand stores (manual and AI edits share them), so there is a single
 * source of truth. Everything in src/genius that reasons about structure works on this pure shape.
 */
export interface ConfigModel {
  workspaceId: string
  modules: Module[]
  forms: Form[]
  views: View[]
  workflows: Workflow[]
  dashboards: Dashboard[]
  /** all roles (roles are shared across workspaces); the builder may only create `role_ai_*` roles */
  roles: Role[]
}

export const AI_ROLE_PREFIX = 'role_ai_'
export const isAiRole = (r: Pick<Role, 'id'>) => r.id.startsWith(AI_ROLE_PREFIX)

export const clone = <T>(v: T): T => structuredClone(v)

/** keys that change without the configuration changing (timestamps, id counters, canvas positions, scheduler bookkeeping) */
const VOLATILE = new Set(['updatedAt', 'createdAt', 'counters', 'flowPos', 'lastScheduledAt'])

/** JSON with sorted keys and without volatile keys: the same configuration always yields the same text. */
export function canonicalJson(v: unknown): string {
  const go = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(go)
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(o)
          .filter((k) => !VOLATILE.has(k) && o[k] !== undefined)
          .sort()
          .map((k) => [k, go(o[k])]),
      )
    }
    return x
  }
  return JSON.stringify(go(v))
}

/** 53-bit string hash (cyrb53). Not cryptographic: used for change detection and idempotency keys, never for secrets. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** The config revision: changes whenever ANY structural part changes, no matter who changed it (AI or manual edit). */
export function revisionOf(c: ConfigModel): string {
  return `rev_${hash53(
    canonicalJson({
      m: c.modules,
      f: c.forms,
      v: c.views,
      w: c.workflows,
      d: c.dashboards,
      r: c.roles.filter(isAiRole),
    }),
  )}`
}

export function emptyConfig(workspaceId: string, roles: Role[] = []): ConfigModel {
  return { workspaceId, modules: [], forms: [], views: [], workflows: [], dashboards: [], roles }
}

export const findModule = (c: ConfigModel, id: string) => c.modules.find((m) => m.id === id)
