/**
 * Provider-agnostic LLM boundary. Everything above this file (orchestrator, router, prompts) talks to `LLMProvider`;
 * only `groq.ts` knows about Groq. This file is server-safe (no browser or store imports).
 */

export type Operation = 'new_build' | 'modify' | 'repair' | 'question'

export type StructuredMode = 'strict' | 'best_effort' | 'json_object'

export type LLMErrorCode =
  | 'misconfigured' // no key / bad model config
  | 'auth' // 401/403 from the provider
  | 'invalid_request' // 400 that is not about the schema; never retried
  | 'rate_limited' // 429 after the retry budget
  | 'server_error' // 5xx after the retry budget
  | 'network' // fetch failed after the retry budget
  | 'timeout' // aborted by our own deadline after the retry budget
  | 'empty' // no content returned
  | 'truncated' // finish_reason = length: the JSON is cut off
  | 'refusal' // the model declined
  | 'content_filter' // blocked by the provider's safety filter
  | 'malformed_json' // content is not parseable JSON
  | 'schema_invalid' // JSON parsed, does not match the response contract

export class LLMError extends Error {
  readonly code: LLMErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly retryAfterMs?: number
  /** what we can safely tell the end user (never contains keys, prompts or provider internals) */
  readonly userMessage: string
  constructor(code: LLMErrorCode, message: string, opts: { retryable?: boolean; status?: number; retryAfterMs?: number; userMessage?: string } = {}) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.retryable = opts.retryable ?? false
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
    this.userMessage = opts.userMessage ?? USER_MESSAGES[code]
  }
}

export const USER_MESSAGES: Record<LLMErrorCode, string> = {
  misconfigured: 'The AI service is not configured yet. Your CRM is unchanged.',
  auth: 'The AI service rejected our credentials. Your CRM is unchanged.',
  invalid_request: 'The AI service could not process that request. Your CRM is unchanged.',
  rate_limited: 'The AI service is busy right now. Please try again in a moment. Your CRM is unchanged.',
  server_error: 'The AI service had a temporary problem. Please try again. Your CRM is unchanged.',
  network: 'We could not reach the AI service. Please check your connection and try again. Your CRM is unchanged.',
  timeout: 'The AI service took too long to answer. Please try again, or split the request into smaller steps. Your CRM is unchanged.',
  empty: 'The AI service returned nothing. Please try again. Your CRM is unchanged.',
  truncated: 'The answer was too large to finish. Try asking for fewer things at once. Your CRM is unchanged.',
  refusal: 'The AI service declined this request. Try rephrasing it. Your CRM is unchanged.',
  content_filter: 'The request was blocked by the AI service safety filter. Try rephrasing it. Your CRM is unchanged.',
  malformed_json: 'The AI answer could not be read. Please try again. Your CRM is unchanged.',
  schema_invalid: 'The AI answer did not follow the required format. Please try again. Your CRM is unchanged.',
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** prompt tokens served from the provider's prompt cache (0 when the model does not report it) */
  cachedTokens: number
}

export interface GenerateRequest {
  operation: Operation
  /** exact provider model id */
  model: string
  /** STATIC prefix: byte-identical across requests of the same operation (this is what the provider caches) */
  system: string
  /** VARIABLE part: everything specific to this request goes here and only here */
  user: string
  schemaName: string
  /** JSON Schema of the response contract (already converted for strict mode) */
  jsonSchema: Record<string, unknown>
  maxTokens: number
  temperature?: number
  timeoutMs?: number
  correlationId: string
}

export interface GenerateResult {
  /** the parsed JSON object */
  json: unknown
  usage: Usage
  model: string
  latencyMs: number
  /** HTTP attempts made (1 = no retry) */
  attempts: number
  finishReason: string
  structuredMode: StructuredMode
}

export interface LLMProvider {
  readonly name: string
  generate(req: GenerateRequest): Promise<GenerateResult>
}
