/**
 * Tenant-scoped in-memory cache and rate limiter.
 *
 * Every key is built from (tenantId, workspaceId, ...) and every read re-checks the tenant, so one tenant can never
 * read another tenant's entry even when the rest of the key collides. Honest limits: this is per process / Worker isolate
 * memory, not a shared store. It is an optimisation and a best-effort abuse guard, never a source of truth.
 */
const SAFE = /^[A-Za-z0-9_-]{1,64}$/

function assertId(label: string, v: string) {
  if (!SAFE.test(v)) throw new Error(`Invalid ${label}`)
}

export const tenantKey = (tenantId: string, workspaceId: string, ...parts: string[]) => {
  assertId('tenant id', tenantId)
  assertId('workspace id', workspaceId)
  return [tenantId, workspaceId, ...parts].join('|')
}

interface Entry<T> {
  tenantId: string
  value: T
  expires: number
}

export class TenantCache<T> {
  private readonly map = new Map<string, Entry<T>>()
  constructor(
    private readonly max = 200,
    private readonly ttlMs = 10 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(tenantId: string, workspaceId: string, ...parts: string[]): T | undefined {
    const k = tenantKey(tenantId, workspaceId, ...parts)
    const e = this.map.get(k)
    if (!e) return undefined
    if (e.tenantId !== tenantId || e.expires < this.now()) {
      this.map.delete(k)
      return undefined
    }
    this.map.delete(k)
    this.map.set(k, e) // LRU touch
    return e.value
  }

  set(tenantId: string, workspaceId: string, parts: string[], value: T) {
    const k = tenantKey(tenantId, workspaceId, ...parts)
    this.map.delete(k)
    this.map.set(k, { tenantId, value, expires: this.now() + this.ttlMs })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }

  /** drop everything of one workspace (called when its configuration or permissions change) */
  invalidateWorkspace(tenantId: string, workspaceId: string) {
    const prefix = `${tenantKey(tenantId, workspaceId)}|`
    for (const k of this.map.keys()) if (k.startsWith(prefix) || k === prefix.slice(0, -1)) this.map.delete(k)
  }

  invalidateTenant(tenantId: string) {
    for (const [k, e] of this.map) if (e.tenantId === tenantId) this.map.delete(k)
  }

  get size() {
    return this.map.size
  }
}

/** Sliding-window limiter per tenant (and per operation). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** true = allowed (and counted); false = over the limit */
  take(tenantId: string, bucket = 'default'): boolean {
    assertId('tenant id', tenantId)
    const k = `${tenantId}|${bucket}`
    const t = this.now()
    const recent = (this.hits.get(k) ?? []).filter((x) => x > t - this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(k, recent)
      return false
    }
    recent.push(t)
    this.hits.set(k, recent)
    if (this.hits.size > 5000) for (const [key, list] of this.hits) if (!list.some((x) => x > t - this.windowMs)) this.hits.delete(key)
    return true
  }

  retryAfterMs(tenantId: string, bucket = 'default'): number {
    const list = this.hits.get(`${tenantId}|${bucket}`) ?? []
    return list.length ? Math.max(0, list[0] + this.windowMs - this.now()) : 0
  }
}
