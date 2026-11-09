import type { Usage } from './provider'

/**
 * Structured, PII-free observability for AI calls. Logged: operation, model, token counts (incl. cached), latency,
 * attempts, outcome, correlation id, tenant id. NEVER logged: the API key, prompts, the user's request text,
 * record data, e-mail addresses or phone numbers.
 */
export interface AiLogEvent {
  at: string
  correlationId: string
  tenantId: string
  operation: string
  step: string
  model?: string
  ok: boolean
  code?: string
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  /** cachedTokens / inputTokens, 0..1 */
  cacheHitRatio?: number
  latencyMs?: number
  attempts?: number
  structuredMode?: string
  /** prefix/context sizes (estimated tokens) to spot prompt bloat */
  staticPrefixTokens?: number
  variableTokens?: number
}

export type LogSink = (e: AiLogEvent) => void

let sink: LogSink = (e) => {
  // one JSON line per call: easy to read in `whop-logs`
  console.log(`[genius-ai] ${JSON.stringify(e)}`)
}
export const setLogSink = (s: LogSink) => {
  sink = s
}

export function logAi(e: Omit<AiLogEvent, 'at'>): AiLogEvent {
  const full = { at: new Date().toISOString(), ...e, cacheHitRatio: e.inputTokens ? Math.round(((e.cachedTokens ?? 0) / e.inputTokens) * 1000) / 1000 : undefined }
  sink(full)
  return full
}

let counter = 0
/** Correlation ids tie a user action to its server calls and audit entries. Not secret, not guessable-meaningful. */
export function newCorrelationId(now = Date.now()): string {
  counter = (counter + 1) % 1_679_616
  const rand = typeof crypto !== 'undefined' && 'getRandomValues' in crypto ? crypto.getRandomValues(new Uint32Array(1))[0].toString(36) : Math.random().toString(36).slice(2, 8)
  return `cor_${now.toString(36)}${counter.toString(36)}${rand}`.slice(0, 40)
}

export const sumUsage = (list: Usage[]): Usage => list.reduce((a, u) => ({ inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens, cachedTokens: a.cachedTokens + u.cachedTokens }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 })

/** Rough token estimate (~3.5 chars/token for JSON-heavy English text). Used for budgeting only, never billed. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5)
