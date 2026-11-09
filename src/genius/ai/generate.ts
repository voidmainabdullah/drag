import { z } from 'zod'
import { Question } from '../blueprint/schema'
import { buildPrompt, type PromptMode, type ResponseKind, type VariableData } from './ai-core'
import { logAi, estimateTokens } from './observability'
import { MAX_TOKENS, TEMPERATURE, TIMEOUT_MS, type ModelSet } from './models'
import { LLMError, type LLMProvider, type Operation, type StructuredMode, type Usage } from './provider'
import { stripNulls } from './strictSchema'
import { modelIdFor, type Tier } from './model-router'

/**
 * Server-side call orchestration for ONE model step (generate or repair). It owns the failure policy that is about the
 * model's transport/format, not about CRM validity:
 *   truncated   -> escalate fast->strong once, then one retry with a larger budget
 *   empty / malformed / wrong envelope -> one re-ask (escalating to the strong model)
 *   everything else (auth, 400, refusal, filter, exhausted 429/5xx) -> stop, report, nothing is changed
 * CRM validity (the six validation stages) is the client's job: the client holds the configuration, so validation and
 * the bounded repair loop live there. A hard cap of 3 model calls per step bounds cost whatever happens.
 */
export const MAX_CALLS_PER_STEP = 3

const EnvelopeBase = z.object({
  status: z.string(),
  summary: z.string().max(2000).optional(),
  assumptions: z.array(z.string().max(400)).max(20).optional(),
  questions: z.array(Question).max(4).optional(),
  blueprint: z.unknown().optional(),
  patch: z.unknown().optional(),
  answer: z.string().max(4000).optional(),
  references: z.array(z.string().max(100)).max(30).optional(),
})
export type Envelope = z.infer<typeof EnvelopeBase>

export function parseEnvelope(kind: ResponseKind, json: unknown): Envelope {
  const r = EnvelopeBase.safeParse(stripNulls(json))
  if (!r.success) throw new LLMError('schema_invalid', `envelope: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}`.trim())
  const e = r.data
  if (kind === 'answer') {
    if (e.status === 'ok' && !e.answer) throw new LLMError('schema_invalid', 'answer missing')
    return e
  }
  if (e.status === 'needs_clarification') {
    if (!e.questions?.length) throw new LLMError('schema_invalid', 'needs_clarification without questions')
    return e
  }
  if (e.status !== 'ok') throw new LLMError('schema_invalid', `unknown status "${e.status.slice(0, 30)}"`)
  if (kind === 'blueprint' && !e.blueprint) throw new LLMError('schema_invalid', 'blueprint missing')
  if (kind === 'patch' && !e.patch) throw new LLMError('schema_invalid', 'patch missing')
  return e
}

export interface GenerateParams {
  tenantId: string
  workspaceId: string
  correlationId: string
  operation: Operation
  kind: ResponseKind
  mode: PromptMode
  tier: Exclude<Tier, 'none'>
  variable: VariableData
}

export interface StepStats {
  calls: number
  attempts: number
  latencyMs: number
  usage: Usage
  models: string[]
  structuredMode?: StructuredMode
  escalated: boolean
}

export type GenerateOutcome = ({ ok: true; envelope: Envelope } & StepStats) | ({ ok: false; code: LLMError['code']; message: string; retryable: boolean } & StepStats)

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0 })

export async function runGenerate(deps: { provider: LLMProvider; models: ModelSet; /** multiplies the per-operation timeouts (GENIUS_TIMEOUT_SCALE) */ timeoutScale?: number }, p: GenerateParams): Promise<GenerateOutcome> {
  const prompt = buildPrompt(p.kind, p.mode, p.variable)
  const stats: StepStats = { calls: 0, attempts: 0, latencyMs: 0, usage: zero(), models: [], escalated: false }
  let tier = p.tier
  let maxTokens = MAX_TOKENS[p.operation]
  let reasks = 0
  let enlarged = false
  const staticTokens = estimateTokens(prompt.system)
  const variableTokens = estimateTokens(prompt.user)

  for (let call = 0; call < MAX_CALLS_PER_STEP; call++) {
    const model = modelIdFor(tier, deps.models)
    const caps = tier === 'fast' ? deps.models.fast : deps.models.strong
    maxTokens = Math.min(maxTokens, caps.maxOutputTokens)
    stats.calls += 1
    if (!stats.models.includes(model)) stats.models.push(model)
    try {
      const res = await deps.provider.generate({
        operation: p.operation,
        model,
        system: prompt.system,
        user: prompt.user,
        schemaName: prompt.schemaName,
        jsonSchema: prompt.jsonSchema,
        maxTokens,
        temperature: TEMPERATURE,
        timeoutMs: Math.round(TIMEOUT_MS[p.operation] * (deps.timeoutScale ?? 1)),
        correlationId: p.correlationId,
      })
      stats.attempts += res.attempts
      stats.latencyMs += res.latencyMs
      stats.usage = { inputTokens: stats.usage.inputTokens + res.usage.inputTokens, outputTokens: stats.usage.outputTokens + res.usage.outputTokens, cachedTokens: stats.usage.cachedTokens + res.usage.cachedTokens }
      stats.structuredMode = res.structuredMode
      const envelope = parseEnvelope(p.kind, res.json)
      logAi({ correlationId: p.correlationId, tenantId: p.tenantId, operation: p.operation, step: p.mode, model, ok: true, ...res.usage, latencyMs: res.latencyMs, attempts: res.attempts, structuredMode: res.structuredMode, staticPrefixTokens: staticTokens, variableTokens })
      return { ok: true, envelope, ...stats }
    } catch (e) {
      const err = e instanceof LLMError ? e : new LLMError('server_error', 'unexpected failure')
      logAi({ correlationId: p.correlationId, tenantId: p.tenantId, operation: p.operation, step: p.mode, model, ok: false, code: err.code, staticPrefixTokens: staticTokens, variableTokens })
      if (err.code === 'truncated') {
        if (tier === 'fast') {
          tier = 'strong'
          stats.escalated = true
          continue
        }
        if (!enlarged) {
          enlarged = true
          maxTokens = Math.ceil(maxTokens * 1.5)
          continue
        }
      }
      if ((err.code === 'empty' || err.code === 'malformed_json' || err.code === 'schema_invalid') && reasks < 1) {
        reasks += 1
        if (tier === 'fast') {
          tier = 'strong'
          stats.escalated = true
        }
        continue
      }
      return { ok: false, code: err.code, message: err.userMessage, retryable: err.retryable || err.code === 'truncated', ...stats }
    }
  }
  return { ok: false, code: 'schema_invalid', message: 'The AI answer could not be used after several tries. Your CRM is unchanged.', retryable: true, ...stats }
}
