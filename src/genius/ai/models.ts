/**
 * Model configuration. Model ids come from the environment (`GENIUS_MODEL_FAST`, `GENIUS_MODEL_STRONG`) so they can
 * be changed without a code change. Capability flags are per model: a model that does not support strict
 * `json_schema` is asked for best-effort JSON and validated locally either way.
 *
 * The capability table below is a hand-maintained snapshot of Groq's public documentation. Unknown ids get the
 * conservative profile (no strict schema, no caching assumption). Every flag can be forced from the environment:
 *   GENIUS_MODEL_FAST_STRICT=true|false   GENIUS_MODEL_FAST_CACHING=true|false   (same for _STRONG)
 */
export interface ModelCaps {
  id: string
  tier: 'fast' | 'strong'
  /** supports response_format json_schema with strict:true */
  strictJsonSchema: boolean
  /** supports response_format json_object */
  jsonObject: boolean
  /** provider-side prompt caching of a repeated static prefix (reports cached_tokens) */
  promptCaching: boolean
  /** a reasoning model: reasoning tokens count toward the completion budget */
  reasoning: boolean
  contextTokens: number
  maxOutputTokens: number
}

export const DEFAULT_FAST = 'openai/gpt-oss-20b'
export const DEFAULT_STRONG = 'openai/gpt-oss-120b'

type Known = Omit<ModelCaps, 'id' | 'tier'>

const GPT_OSS: Known = { strictJsonSchema: true, jsonObject: true, promptCaching: true, reasoning: true, contextTokens: 131072, maxOutputTokens: 65536 }
const CONSERVATIVE: Known = { strictJsonSchema: false, jsonObject: true, promptCaching: false, reasoning: false, contextTokens: 32768, maxOutputTokens: 8192 }

export const KNOWN_MODELS: Record<string, Known> = {
  'openai/gpt-oss-20b': GPT_OSS,
  'openai/gpt-oss-120b': GPT_OSS,
  'openai/gpt-oss-safeguard-20b': GPT_OSS,
}

type Env = Record<string, string | undefined>

const flag = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim()))

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{1,100}$/

function resolveOne(env: Env, tier: 'fast' | 'strong'): ModelCaps {
  const T = tier.toUpperCase()
  const raw = env[`GENIUS_MODEL_${T}`]?.trim()
  const id = raw && MODEL_ID.test(raw) ? raw : tier === 'fast' ? DEFAULT_FAST : DEFAULT_STRONG
  const base = KNOWN_MODELS[id] ?? CONSERVATIVE
  return {
    id,
    tier,
    ...base,
    strictJsonSchema: flag(env[`GENIUS_MODEL_${T}_STRICT`], base.strictJsonSchema),
    promptCaching: flag(env[`GENIUS_MODEL_${T}_CACHING`], base.promptCaching),
  }
}

export interface ModelSet {
  fast: ModelCaps
  strong: ModelCaps
}

export function resolveModels(env: Env): ModelSet {
  return { fast: resolveOne(env, 'fast'), strong: resolveOne(env, 'strong') }
}

/** Output budget per operation (completion tokens, including reasoning). Deliberately tight; the router escalates on truncation. */
export const MAX_TOKENS: Record<'new_build' | 'modify' | 'repair' | 'question', number> = {
  new_build: 16000,
  modify: 6000,
  repair: 8000,
  question: 1200,
}
export const TIMEOUT_MS: Record<'new_build' | 'modify' | 'repair' | 'question', number> = {
  new_build: 90_000,
  modify: 45_000,
  repair: 60_000,
  question: 20_000,
}
export const TEMPERATURE = 0.1
