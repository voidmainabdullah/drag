import { beforeEach, describe, expect, it, vi } from 'vitest'
import { bearerToken, verifyAccessToken } from '#/genius/server/auth'
import { generateHandler, healthHandler, resetServerLimiter, type ServerDeps } from '#/genius/server/handlers'
import { GenerateWire, MAX_VARIABLE_CHARS } from '#/genius/ai/wire'
import { LLMError, type LLMProvider } from '#/genius/ai/provider'

const JWT = 'aaaaaaaa.bbbbbbbb.cccccccc'
const SB = { url: 'https://example.supabase.co', key: 'sb_publishable_test' }
const KEY = 'gsk_SERVER_SECRET_123'

const wire = (over: Partial<GenerateWire> = {}): GenerateWire => ({ workspaceId: 'ws_1', correlationId: 'cor_test_1', operation: 'modify', kind: 'patch', mode: 'generate', tier: 'fast', variable: { request: 'add a notes field to students' }, ...over })

function supabaseFetch(user: { id: string; email?: string } | number) {
  return vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://example.supabase.co/auth/v1/user')
    const h = init.headers as Record<string, string>
    expect(h.apikey).toBe(SB.key)
    expect(h.authorization).toBe(`Bearer ${JWT}`)
    return typeof user === 'number' ? new Response('{}', { status: user }) : new Response(JSON.stringify(user), { status: 200 })
  }) as unknown as typeof fetch
}

const provider = (impl?: LLMProvider['generate']): LLMProvider & { calls: unknown[] } => {
  const calls: unknown[] = []
  return {
    name: 'mock',
    calls,
    generate: impl ?? (async (r) => (calls.push(r), { json: { status: 'ok', summary: 's', assumptions: [], questions: [], patch: { ops: [] } }, usage: { inputTokens: 10, outputTokens: 2, cachedTokens: 0 }, model: r.model, latencyMs: 1, attempts: 1, finishReason: 'stop', structuredMode: 'strict' as const })),
  }
}

beforeEach(() => resetServerLimiter())

describe('Supabase token verification (server side)', () => {
  it('extracts a bearer token', () => {
    expect(bearerToken(`Bearer ${JWT}`)).toBe(JWT)
    expect(bearerToken('bearer   x.y.z')).toBe('x.y.z')
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(bearerToken(null)).toBeUndefined()
  })
  it('verifies against Supabase /auth/v1/user with the publishable key and returns the user id as tenant', async () => {
    const f = supabaseFetch({ id: 'b0a1c2d3-1111-2222-3333-444455556666', email: 'a@b.co' })
    await expect(verifyAccessToken(JWT, SB, f)).resolves.toEqual({ ok: true, userId: 'b0a1c2d3-1111-2222-3333-444455556666', email: 'a@b.co' })
  })
  it('rejects missing, malformed, expired/forged and unverifiable tokens without trusting anything in the token', async () => {
    expect(await verifyAccessToken(undefined, SB, supabaseFetch(200 as never))).toEqual({ ok: false, reason: 'missing' })
    expect(await verifyAccessToken('not-a-jwt', SB)).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyAccessToken(JWT, SB, supabaseFetch(401))).toEqual({ ok: false, reason: 'rejected' })
    expect(await verifyAccessToken(JWT, SB, supabaseFetch(503))).toEqual({ ok: false, reason: 'unavailable' })
    expect(await verifyAccessToken(JWT, SB, (async () => { throw new Error('down') }) as never)).toEqual({ ok: false, reason: 'unavailable' })
    // a user id that is not a safe tenant id is refused (it would end up in storage keys and cache keys)
    expect(await verifyAccessToken(JWT, SB, supabaseFetch({ id: 'x|y' }))).toEqual({ ok: false, reason: 'rejected' })
  })
})

describe('generate handler', () => {
  const deps = (p: LLMProvider, f = supabaseFetch({ id: 'user_tenant_a' }), env = { GROQ_API_KEY: KEY }): ServerDeps => ({ env, supabase: SB, fetch: f, provider: p })

  it('refuses unauthenticated calls before any model call, and preserves the request', async () => {
    const p = provider()
    const r = await generateHandler(deps(p), undefined, wire())
    expect(r).toMatchObject({ ok: false, code: 'auth_required', preservedRequest: 'add a notes field to students' })
    expect(p.calls).toHaveLength(0)
    const r2 = await generateHandler(deps(p, supabaseFetch(401)), JWT, wire())
    expect(r2).toMatchObject({ ok: false, code: 'auth_required' })
    expect(p.calls).toHaveLength(0)
  })

  it('a Supabase outage is reported as retryable, not as "not signed in"', async () => {
    const r = await generateHandler(deps(provider(), supabaseFetch(503)), JWT, wire())
    expect(r).toMatchObject({ ok: false, code: 'unavailable', retryable: true })
  })

  it('an authenticated call runs the model once and returns usage', async () => {
    const p = provider()
    const r = await generateHandler(deps(p), JWT, wire())
    expect(r).toMatchObject({ ok: true, provider: 'mock', usage: { inputTokens: 10 } })
    expect(p.calls).toHaveLength(1)
    expect((p.calls[0] as { system: string }).system).not.toContain('add a notes field')
  })

  it('provider failure is friendly, keeps the user request and never contains the key', async () => {
    const p = provider(async () => {
      throw new LLMError('rate_limited', `HTTP 429 key=${KEY}`, { retryable: true })
    })
    const r = await generateHandler(deps(p), JWT, wire({ tier: 'strong' }))
    expect(r).toMatchObject({ ok: false, code: 'rate_limited', preservedRequest: 'add a notes field to students' })
    expect(JSON.stringify(r)).not.toContain(KEY)
    expect((r as { message: string }).message).toMatch(/unchanged/)
  })

  it('rate limits per tenant, not globally', async () => {
    const p = provider()
    let limited = 0
    for (let i = 0; i < 35; i++) if ((await generateHandler(deps(p), JWT, wire())).ok === false) limited++
    expect(limited).toBe(5)
    const other = await generateHandler(deps(p, supabaseFetch({ id: 'user_tenant_b' })), JWT, wire())
    expect(other.ok).toBe(true)
  })

  it('rejects oversize context instead of silently truncating it', async () => {
    const r = await generateHandler(deps(provider()), JWT, wire({ variable: { request: 'x', context: 'y'.repeat(MAX_VARIABLE_CHARS + 10) } }))
    expect(r).toMatchObject({ ok: false, code: 'too_large' })
  })

  it('the wire schema rejects malformed input and cannot carry a tenant id', () => {
    expect(() => GenerateWire.parse({ ...wire(), workspaceId: '../etc' })).toThrow()
    expect(() => GenerateWire.parse({ ...wire(), kind: 'sql' })).toThrow()
    expect(() => GenerateWire.parse({ ...wire(), variable: { request: '' } })).toThrow()
    expect('tenantId' in GenerateWire.parse({ ...wire(), tenantId: 'victim' })).toBe(false)
  })
})

describe('health handler', () => {
  it('reports configuration without ever returning the key', async () => {
    const withKey = await healthHandler({ env: { GROQ_API_KEY: KEY, GENIUS_MODEL_FAST: 'openai/gpt-oss-120b' }, supabase: SB }, undefined)
    expect(withKey).toMatchObject({ groqConfigured: true, models: { fast: 'openai/gpt-oss-120b', strong: 'openai/gpt-oss-120b' }, supabaseConfigured: true })
    expect(JSON.stringify(withKey)).not.toContain(KEY)
    expect((await healthHandler({ env: {}, supabase: SB }, undefined)).groqConfigured).toBe(false)
    const s = await healthHandler({ env: {}, supabase: SB, fetch: supabaseFetch({ id: 'user_x', email: 'a@b.co' }) }, JWT)
    expect(s.session).toEqual({ tenantId: 'user_x', email: 'a@b.co' })
  })
})
