import { TEMPERATURE, TIMEOUT_MS, type ModelCaps, type ModelSet } from './models'
import { LLMError, type GenerateRequest, type GenerateResult, type LLMProvider, type StructuredMode, type Usage } from './provider'

export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

export interface GroqOptions {
  /** the secret. Read from the server binding GROQ_API_KEY by the caller, never from client code. */
  apiKey: string | undefined
  models: ModelSet
  endpoint?: string
  fetch?: typeof fetch
  /** transient-failure retries (429, 5xx, network, timeout, empty) on top of the first attempt */
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

const SCHEMA_400 = /json_schema|response_format|structured|strict|schema|json mode|json_object/i
const REASONING_400 = /reasoning_effort|include_reasoning/i

interface ChatChoice {
  finish_reason?: string | null
  message?: { content?: string | null; refusal?: string | null }
}
interface ChatResponse {
  choices?: ChatChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null }
}

/** Tolerant JSON extraction: plain JSON, ```json fences, or prose around one object. Returns undefined when nothing parses. */
export function parseJsonLoose(text: string): unknown | undefined {
  const t = text.trim()
  const attempts = [t]
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t)
  if (fence) attempts.push(fence[1])
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a >= 0 && b > a) attempts.push(t.slice(a, b + 1))
  for (const s of attempts) {
    try {
      return JSON.parse(s)
    } catch {
      /* try the next shape */
    }
  }
  return undefined
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export class GroqProvider implements LLMProvider {
  readonly name = 'groq'
  private readonly o: Required<Omit<GroqOptions, 'apiKey' | 'fetch'>> & { apiKey?: string; fetch?: typeof fetch }

  constructor(o: GroqOptions) {
    this.o = {
      endpoint: GROQ_ENDPOINT,
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 8000,
      sleep: defaultSleep,
      random: Math.random,
      ...o,
    }
  }

  private caps(model: string): ModelCaps {
    const { fast, strong } = this.o.models
    if (model === strong.id) return strong
    if (model === fast.id) return fast
    return { ...fast, id: model, strictJsonSchema: false, promptCaching: false }
  }

  private backoff(retry: number, retryAfterMs?: number): number {
    const exp = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** retry)
    const jitter = exp * 0.25 * this.o.random()
    return Math.min(this.o.maxDelayMs, Math.max(retryAfterMs ?? 0, exp + jitter))
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const key = this.o.apiKey
    if (!key) throw new LLMError('misconfigured', 'GROQ_API_KEY is not set')
    const caps = this.caps(req.model)
    const modes: StructuredMode[] = caps.strictJsonSchema ? ['strict', 'best_effort', 'json_object'] : ['json_object']
    let modeIx = 0
    let reasoning = caps.reasoning && /gpt-oss/.test(req.model)
    let attempts = 0
    let retries = 0
    const started = Date.now()

    for (;;) {
      attempts += 1
      const mode = modes[modeIx]
      try {
        const res = await this.once(req, key, mode, reasoning)
        return { ...res, attempts, latencyMs: Date.now() - started, structuredMode: mode, model: req.model }
      } catch (e) {
        const err = e instanceof LLMError ? e : new LLMError('network', 'unexpected provider failure', { retryable: true })
        // the provider refused our response_format: step down once per mode, without spending the retry budget
        if (err.code === 'invalid_request' && err.status === 400) {
          if (reasoning && REASONING_400.test(err.message)) {
            reasoning = false
            continue
          }
          if (SCHEMA_400.test(err.message) && modeIx < modes.length - 1) {
            modeIx += 1
            continue
          }
        }
        if (err.retryable && retries < this.o.maxRetries) {
          await this.o.sleep(this.backoff(retries, err.retryAfterMs))
          retries += 1
          continue
        }
        throw err
      }
    }
  }

  private async once(req: GenerateRequest, key: string, mode: StructuredMode, reasoning: boolean): Promise<Omit<GenerateResult, 'attempts' | 'latencyMs' | 'structuredMode' | 'model'>> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature ?? TEMPERATURE,
      max_completion_tokens: req.maxTokens,
      stream: false,
    }
    if (mode === 'json_object') body.response_format = { type: 'json_object' }
    else body.response_format = { type: 'json_schema', json_schema: { name: req.schemaName, strict: mode === 'strict', schema: req.jsonSchema } }
    if (reasoning) {
      body.reasoning_effort = req.operation === 'new_build' ? 'medium' : 'low'
      body.include_reasoning = false
    }

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? TIMEOUT_MS[req.operation])
    let res: Response
    try {
      res = await (this.o.fetch ?? fetch)(this.o.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e instanceof Error && e.name === 'AbortError')
      throw aborted ? new LLMError('timeout', 'request deadline exceeded', { retryable: true }) : new LLMError('network', 'network failure', { retryable: true })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) throw await httpError(res)

    let payload: ChatResponse
    try {
      payload = (await res.json()) as ChatResponse
    } catch {
      throw new LLMError('server_error', 'provider returned a non-JSON body', { retryable: true, status: res.status })
    }
    const choice = payload.choices?.[0]
    const usage = toUsage(payload.usage)
    if (!choice) throw new LLMError('empty', 'no choices in response', { retryable: true })
    if (choice.message?.refusal) throw new LLMError('refusal', 'model refused')
    const finish = choice.finish_reason ?? 'stop'
    if (finish === 'content_filter') throw new LLMError('content_filter', 'blocked by provider safety filter')
    if (finish === 'length') throw new LLMError('truncated', 'completion hit max_completion_tokens')
    const text = (choice.message?.content ?? '').trim()
    if (!text) throw new LLMError('empty', 'empty completion', { retryable: true })
    const json = parseJsonLoose(text)
    if (json === undefined || json === null || typeof json !== 'object') throw new LLMError('malformed_json', 'completion is not a JSON object')
    return { json, usage, finishReason: finish }
  }
}

function toUsage(u: ChatResponse['usage']): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

async function httpError(res: Response): Promise<LLMError> {
  let detail = ''
  try {
    const j = (await res.json()) as { error?: { message?: string } }
    detail = String(j?.error?.message ?? '').slice(0, 300)
  } catch {
    /* body is optional */
  }
  const status = res.status
  const ra = res.headers.get('retry-after-ms')
  const rs = res.headers.get('retry-after')
  const retryAfterMs = ra ? Number(ra) : rs && Number.isFinite(Number(rs)) ? Number(rs) * 1000 : undefined
  const msg = `HTTP ${status}${detail ? `: ${detail}` : ''}`
  if (status === 429) return new LLMError('rate_limited', msg, { retryable: true, status, retryAfterMs })
  if (status === 401 || status === 403) return new LLMError('auth', msg, { status })
  if (status === 408) return new LLMError('timeout', msg, { retryable: true, status })
  if (status >= 500) return new LLMError('server_error', msg, { retryable: true, status, retryAfterMs })
  return new LLMError('invalid_request', msg, { status })
}
