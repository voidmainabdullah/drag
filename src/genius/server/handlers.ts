import { RateLimiter } from '../ai/cache'
import { runGenerate } from '../ai/generate'
import { GroqProvider } from '../ai/groq'
import { resolveModels } from '../ai/models'
import type { LLMProvider } from '../ai/provider'
import { MAX_VARIABLE_CHARS, type GenerateResponse, type GenerateWire, type TransportFailure } from '../ai/wire'
import { verifyAccessToken, type SupabaseCfg } from './auth'
import type { ServerEnv } from './env'

/**
 * Transport-independent request handlers (the createServerFn wrappers in functions.ts are one-liners over these, so the
 * whole server path is unit-testable with a mocked fetch/provider and no Worker).
 *
 * Order of every handler: authenticate -> derive tenant from the verified user id -> rate limit -> size check -> work.
 * The browser never supplies a tenant id; the tenant is the verified Supabase user id.
 */
export interface ServerDeps {
  env: ServerEnv
  supabase: SupabaseCfg
  fetch?: typeof fetch
  /** inject a provider (tests); production builds a GroqProvider from the GROQ_API_KEY binding */
  provider?: LLMProvider
}

const limiter = new RateLimiter(30, 60_000)
export const resetServerLimiter = () => {
  // tests only
  ;(limiter as unknown as { hits: Map<string, number[]> }).hits.clear()
}

const num = (v: string | undefined, d: number, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, n)) : d
}

export function buildProvider(env: ServerEnv, f?: typeof fetch): { provider: LLMProvider; models: ReturnType<typeof resolveModels> } {
  const models = resolveModels(env)
  const provider = new GroqProvider({ apiKey: env.GROQ_API_KEY?.trim() || undefined, models, fetch: f, maxRetries: num(env.GENIUS_MAX_RETRIES, 2, 0, 5) })
  return { provider, models }
}

const authFailure = (reason: string): TransportFailure => ({
  ok: false,
  code: reason === 'unavailable' ? 'unavailable' : 'auth_required',
  message: reason === 'unavailable' ? 'Could not verify your session right now. Please try again. Your CRM is unchanged.' : 'Please sign in to use Genius AI. Your CRM is unchanged.',
  retryable: reason === 'unavailable',
})

export async function authenticate(deps: ServerDeps, token: string | undefined) {
  return verifyAccessToken(token, deps.supabase, deps.fetch)
}

export async function generateHandler(deps: ServerDeps, token: string | undefined, wire: GenerateWire): Promise<GenerateResponse | TransportFailure> {
  const preservedRequest = wire.variable.request
  const user = await authenticate(deps, token)
  if (!user.ok) return { ...authFailure(user.reason), preservedRequest }
  const tenantId = user.userId
  if (!limiter.take(tenantId, 'generate')) return { ok: false, code: 'rate_limited', message: 'You are sending requests too quickly. Wait a few seconds and try again. Your CRM is unchanged.', retryable: true, preservedRequest }
  if (JSON.stringify(wire.variable).length > MAX_VARIABLE_CHARS) return { ok: false, code: 'too_large', message: 'That request and its context are too large. Try a smaller, more specific request. Your CRM is unchanged.', retryable: false, preservedRequest }

  const built = deps.provider ? { provider: deps.provider, models: resolveModels(deps.env) } : buildProvider(deps.env, deps.fetch)
  const out = await runGenerate(
    { provider: built.provider, models: built.models, timeoutScale: num(deps.env.GENIUS_TIMEOUT_SCALE, 1, 0.1, 5) },
    { tenantId, workspaceId: wire.workspaceId, correlationId: wire.correlationId, operation: wire.operation, kind: wire.kind, mode: wire.mode, tier: wire.tier, variable: wire.variable },
  )
  const provider = deps.provider ? (deps.provider.name === 'groq' ? 'groq' : 'mock') : 'groq'
  return out.ok ? { ...out, provider } : { ...out, provider, preservedRequest }
}

export interface HealthInfo {
  /** true when the GROQ_API_KEY binding is visible to the server (the key itself is never returned) */
  groqConfigured: boolean
  models: { fast: string; strong: string }
  strictJsonSchema: { fast: boolean; strong: boolean }
  promptCaching: { fast: boolean; strong: boolean }
  supabaseConfigured: boolean
  session?: { tenantId: string; email?: string } | { error: string }
}

export async function healthHandler(deps: ServerDeps, token: string | undefined): Promise<HealthInfo> {
  const m = resolveModels(deps.env)
  const info: HealthInfo = {
    groqConfigured: !!deps.env.GROQ_API_KEY?.trim(),
    models: { fast: m.fast.id, strong: m.strong.id },
    strictJsonSchema: { fast: m.fast.strictJsonSchema, strong: m.strong.strictJsonSchema },
    promptCaching: { fast: m.fast.promptCaching, strong: m.strong.promptCaching },
    supabaseConfigured: !!deps.supabase.url && !!deps.supabase.key,
  }
  if (token) {
    const u = await authenticate(deps, token)
    info.session = u.ok ? { tenantId: u.userId, email: u.email } : { error: u.reason }
  }
  return info
}
