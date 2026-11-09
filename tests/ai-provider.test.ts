import { describe, expect, it, vi } from 'vitest'
import { GroqProvider, GROQ_ENDPOINT, parseJsonLoose } from '#/genius/ai/groq'
import { resolveModels } from '#/genius/ai/models'
import { LLMError, type GenerateRequest, type LLMProvider } from '#/genius/ai/provider'
import { runGenerate, parseEnvelope } from '#/genius/ai/generate'
import { setLogSink, type AiLogEvent } from '#/genius/ai/observability'

const KEY = 'gsk_test_SECRET_KEY_do_not_leak_123456'
const models = resolveModels({})

const req = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  operation: 'modify',
  model: models.fast.id,
  system: 'STATIC',
  user: 'VARIABLE',
  schemaName: 'genius_patch_response',
  jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  maxTokens: 1000,
  correlationId: 'cor_test',
  ...over,
})

const ok = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1000 } }, ...extra }), { status: 200 })
const fail = (status: number, message = 'nope', headers: Record<string, string> = {}) => new Response(JSON.stringify({ error: { message } }), { status, headers })

function provider(responses: (Response | Error | ((init: RequestInit) => Promise<Response>))[], over: Partial<ConstructorParameters<typeof GroqProvider>[0]> = {}) {
  const calls: { url: string; init: RequestInit; body: Record<string, any> }[] = []
  const sleeps: number[] = []
  let i = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) })
    const next = responses[Math.min(i++, responses.length - 1)]
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(init)
    return next.clone()
  })
  const p = new GroqProvider({ apiKey: KEY, models, fetch: fetchMock as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms), random: () => 0, ...over })
  return { p, calls, sleeps, fetchMock }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'no error'
  } catch (e) {
    return e instanceof LLMError ? e.code : `other:${String(e)}`
  }
}

describe('GroqProvider: request shape', () => {
  it('posts to the Groq endpoint with the bearer key, static system first, strict schema, token budget and usage', async () => {
    const { p, calls } = provider([ok({ status: 'ok' })])
    const r = await p.generate(req())
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(GROQ_ENDPOINT).toBe(calls[0].url)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    const b = calls[0].body
    expect(b.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
    expect(b.messages[0].content).toBe('STATIC')
    expect(b.messages[1].content).toBe('VARIABLE')
    expect(b.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'genius_patch_response', strict: true } })
    expect(b.temperature).toBeLessThanOrEqual(0.2)
    expect(b.max_completion_tokens).toBe(1000)
    expect(b.stream).toBe(false)
    expect(JSON.stringify(b)).not.toContain(KEY)
    expect(r.usage).toEqual({ inputTokens: 1200, outputTokens: 80, cachedTokens: 1000 })
    expect(r.structuredMode).toBe('strict')
    expect(r.attempts).toBe(1)
  })

  it('uses json_object for a model without strict json_schema support', async () => {
    const m = resolveModels({ GENIUS_MODEL_FAST: 'some-vendor/unknown-model' })
    const { p, calls } = provider([ok({ a: 1 })], { models: m })
    const r = await p.generate(req({ model: 'some-vendor/unknown-model' }))
    expect(calls[0].body.response_format).toEqual({ type: 'json_object' })
    expect(calls[0].body.reasoning_effort).toBeUndefined()
    expect(r.structuredMode).toBe('json_object')
  })

  it('model ids come from the environment', () => {
    const m = resolveModels({ GENIUS_MODEL_FAST: 'openai/gpt-oss-120b', GENIUS_MODEL_STRONG: 'x/y', GENIUS_MODEL_STRONG_STRICT: 'true' })
    expect(m.fast.id).toBe('openai/gpt-oss-120b')
    expect(m.strong).toMatchObject({ id: 'x/y', strictJsonSchema: true, promptCaching: false })
    expect(resolveModels({ GENIUS_MODEL_FAST: 'bad id with spaces' }).fast.id).toBe('openai/gpt-oss-20b')
  })
})

describe('GroqProvider: failures (mocked provider)', () => {
  it('429 is retried with exponential backoff and honours Retry-After, then succeeds', async () => {
    const { p, sleeps, fetchMock } = provider([fail(429, 'rate', { 'retry-after': '2' }), fail(429), ok({ a: 1 })])
    const r = await p.generate(req())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(r.attempts).toBe(3)
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000)
    expect(sleeps[1]).toBeGreaterThan(500)
  })

  it('429 beyond the retry budget is a normalised rate_limited error (bounded: 1 + 2 calls)', async () => {
    const { p, fetchMock } = provider([fail(429)])
    await expect(p.generate(req())).rejects.toMatchObject({ code: 'rate_limited', retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('5xx is retried, a persistent 5xx surfaces as server_error', async () => {
    const a = provider([fail(503), ok({ a: 1 })])
    await expect(a.p.generate(req())).resolves.toMatchObject({ attempts: 2 })
    const b = provider([fail(500)])
    expect(await code(b.p.generate(req()))).toBe('server_error')
    expect(b.fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a 400 that is not about the schema is never retried', async () => {
    const { p, fetchMock } = provider([fail(400, 'messages must not be empty')])
    expect(await code(p.generate(req()))).toBe('invalid_request')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('401/403 fail immediately as auth', async () => {
    const { p, fetchMock } = provider([fail(401, 'Invalid API Key')])
    const e = (await p.generate(req()).catch((x) => x)) as LLMError
    expect(e.code).toBe('auth')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(e.userMessage).not.toContain(KEY)
    expect(e.message).not.toContain(KEY)
  })

  it('a schema 400 steps down strict -> best-effort -> json_object without spending the retry budget', async () => {
    const { p, calls } = provider([fail(400, "response_format: 'strict' json_schema is not supported"), fail(400, 'json_schema is not supported by this model'), ok({ a: 1 })])
    const r = await p.generate(req())
    expect(calls.map((c) => c.body.response_format.type + ':' + (c.body.response_format.json_schema?.strict ?? '-'))).toEqual(['json_schema:true', 'json_schema:false', 'json_object:-'])
    expect(r.structuredMode).toBe('json_object')
  })

  it('a rejected reasoning parameter is dropped once and the call is repeated', async () => {
    const { p, calls } = provider([fail(400, 'unknown parameter: reasoning_effort'), ok({ a: 1 })])
    await p.generate(req())
    expect(calls[0].body.reasoning_effort).toBe('low')
    expect(calls[1].body.reasoning_effort).toBeUndefined()
  })

  it('a timeout aborts the request and is retried then reported as timeout', async () => {
    const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    const { p, fetchMock } = provider([hang], { maxRetries: 1 })
    expect(await code(p.generate(req({ timeoutMs: 15 })))).toBe('timeout')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a network failure is retried', async () => {
    const { p } = provider([new TypeError('fetch failed'), ok({ a: 1 })])
    await expect(p.generate(req())).resolves.toMatchObject({ attempts: 2 })
  })

  it('malformed JSON is reported and not retried inside the provider; fenced JSON is accepted', async () => {
    const bad = provider([ok('{"status": "ok", "patch": {')])
    expect(await code(bad.p.generate(req()))).toBe('malformed_json')
    expect(bad.fetchMock).toHaveBeenCalledTimes(1)
    const fenced = provider([ok('```json\n{"status":"ok"}\n```')])
    await expect(fenced.p.generate(req())).resolves.toMatchObject({ json: { status: 'ok' } })
    expect(parseJsonLoose('Sure! {"a":1} hope that helps')).toEqual({ a: 1 })
    expect(parseJsonLoose('[1,2]')).toBeDefined()
    expect(parseJsonLoose('no json here')).toBeUndefined()
  })

  it('an empty completion is retried, then reported as empty', async () => {
    const a = provider([ok(''), ok({ a: 1 })])
    await expect(a.p.generate(req())).resolves.toMatchObject({ attempts: 2 })
    const b = provider([ok('   ')])
    expect(await code(b.p.generate(req()))).toBe('empty')
  })

  it('a truncated completion (finish_reason length) is reported, never parsed', async () => {
    const res = new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"status":"ok","patch":{"ops":[' } }], usage: {} }), { status: 200 })
    const { p, fetchMock } = provider([res])
    expect(await code(p.generate(req()))).toBe('truncated')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refusals and content-filter stops are normalised', async () => {
    const refusal = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: "I can't help with that" } }] }), { status: 200 })
    expect(await code(provider([refusal]).p.generate(req()))).toBe('refusal')
    const filtered = new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }), { status: 200 })
    expect(await code(provider([filtered]).p.generate(req()))).toBe('content_filter')
  })

  it('without a key it fails as misconfigured before any network call', async () => {
    const { p, fetchMock } = provider([ok({})], { apiKey: undefined })
    const e = (await p.generate(req()).catch((x) => x)) as LLMError
    expect(e.code).toBe('misconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the key never appears in errors, user messages or logs', async () => {
    const events: AiLogEvent[] = []
    setLogSink((e) => events.push(e))
    const { p } = provider([fail(500, `upstream echo ${'x'.repeat(10)}`)], { maxRetries: 0 })
    const deps = { provider: p, models }
    const out = await runGenerate(deps, { tenantId: 't1', workspaceId: 'w1', correlationId: 'cor_1', operation: 'modify', kind: 'patch', mode: 'generate', tier: 'fast', variable: { request: 'add a field' } })
    expect(out.ok).toBe(false)
    expect(JSON.stringify([out, events])).not.toContain(KEY)
    expect(JSON.stringify(events)).not.toContain('add a field') // prompts and request text are never logged
    setLogSink((e) => console.log(`[genius-ai] ${JSON.stringify(e)}`))
  })
})

describe('runGenerate: failure policy', () => {
  const patchOk = { status: 'ok', summary: 's', assumptions: [], questions: [], patch: { ops: [] } }
  const scripted = (script: (LLMError | unknown)[]) => {
    const seen: string[] = []
    let i = 0
    const provider: LLMProvider = {
      name: 'mock',
      async generate(r) {
        seen.push(`${r.model}@${r.maxTokens}`)
        const step = script[i++]
        if (step instanceof LLMError) throw step
        return { json: step, usage: { inputTokens: 100, outputTokens: 10, cachedTokens: 50 }, model: r.model, latencyMs: 5, attempts: 1, finishReason: 'stop', structuredMode: 'strict' }
      },
    }
    return { provider, seen }
  }
  const base = { tenantId: 't1', workspaceId: 'w1', correlationId: 'cor_1', operation: 'modify' as const, kind: 'patch' as const, mode: 'generate' as const, variable: { request: 'x' } }

  it('truncation on the fast model escalates to the strong model once', async () => {
    const { provider, seen } = scripted([new LLMError('truncated', 'cut'), patchOk])
    const out = await runGenerate({ provider, models }, { ...base, tier: 'fast' })
    expect(out.ok).toBe(true)
    expect(out.escalated).toBe(true)
    expect(seen.map((s) => s.split('@')[0])).toEqual([models.fast.id, models.strong.id])
    expect(out.usage).toMatchObject({ inputTokens: 100, cachedTokens: 50 })
  })

  it('truncation on the strong model retries once with a larger budget, then gives up', async () => {
    const { provider, seen } = scripted([new LLMError('truncated', 'cut'), new LLMError('truncated', 'cut')])
    const out = await runGenerate({ provider, models }, { ...base, tier: 'strong' })
    expect(out.ok).toBe(false)
    expect(out.ok === false && out.code).toBe('truncated')
    const budgets = seen.map((s) => Number(s.split('@')[1]))
    expect(budgets[1]).toBeGreaterThan(budgets[0])
    expect(seen).toHaveLength(2)
  })

  it('malformed output is re-asked once on the strong model, then reported; calls are bounded', async () => {
    const { provider, seen } = scripted([new LLMError('malformed_json', 'x'), new LLMError('malformed_json', 'x'), new LLMError('malformed_json', 'x')])
    const out = await runGenerate({ provider, models }, { ...base, tier: 'fast' })
    expect(out.ok).toBe(false)
    expect(out.calls).toBeLessThanOrEqual(3)
    expect(seen).toHaveLength(2)
  })

  it('a wrong envelope is a schema_invalid error and is re-asked', async () => {
    const { provider } = scripted([{ status: 'ok' }, patchOk])
    const out = await runGenerate({ provider, models }, { ...base, tier: 'strong' })
    expect(out.ok).toBe(true)
    expect(out.calls).toBe(2)
  })

  it('hard failures are not re-asked', async () => {
    for (const c of ['auth', 'refusal', 'content_filter', 'invalid_request', 'rate_limited', 'timeout'] as const) {
      const { provider, seen } = scripted([new LLMError(c, 'x')])
      const out = await runGenerate({ provider, models }, { ...base, tier: 'strong' })
      expect(out.ok).toBe(false)
      expect(seen).toHaveLength(1)
      expect(out.ok === false && out.message).toMatch(/CRM is unchanged/)
    }
  })

  it('strict-mode nulls are stripped before the envelope is read', () => {
    const e = parseEnvelope('patch', { status: 'ok', summary: 's', assumptions: [], questions: [], patch: { ops: [], note: null }, blueprint: null })
    expect(e.blueprint).toBeUndefined()
    expect(() => parseEnvelope('blueprint', { status: 'ok', summary: 's' })).toThrow(/blueprint missing/)
    expect(() => parseEnvelope('patch', { status: 'needs_clarification', questions: [] })).toThrow()
    expect(parseEnvelope('answer', { status: 'ok', answer: 'It is the sum of fees.', references: [] }).answer).toContain('sum')
  })
})
