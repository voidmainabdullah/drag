import type { ID } from '#/types'
import { Question, SCHEMA_VERSION } from '../blueprint/schema'
import { BLUEPRINT_VERSION } from '../blueprint/schema'
import { projectIdFor } from '../compiler/ids'
import { hash53, revisionOf, type ConfigModel } from '../config/model'
import { readConfig } from '../config/storePort'
import { currencyOfConfig } from './currency'
import { answersAsRequirements, currencyFromAnswers, filterQuestions, preflight } from '../ai/clarification'
import { memoryForPrompt, summarizeProject } from '../ai/context-manager'
import { retrieveContext } from '../ai/context-retriever'
import { parseIntent, type Intent } from '../ai/intent-parser'
import { routeModel, type Route } from '../ai/model-router'
import { estimateTokens, newCorrelationId } from '../ai/observability'
import { clampRequest, fitContext } from '../ai/token-optimizer'
import type { GenerateResponse, GenerateWire, Transport, TransportFailure } from '../ai/wire'
import { currentActor, submitProposal, validationContext } from './builder'
import { explainCalculation, restoreTarget, simulateWorkflow, type RestoreTarget } from './readonly'
import { simplePatch } from './simple-patch'
import { useGeniusStore } from '../state/geniusStore'
import type { Proposal, QuestionAnswer, UsageTotals } from '../state/types'
import { getTenantId } from '../tenant'
import { errorSignature, type Issue } from '../validation/issues'
import { validateBlueprint, validatePatch, type ValidationOutcome } from '../validation'

/**
 * The Genius pipeline, client side. Every step reported through `onStep` is a REAL piece of work: a local computation or
 * a server round trip, with its measured duration. Nothing is animated.
 *
 *   understand (deterministic intent) -> [deterministic handlers: explain / simulate / restore / simple patch]
 *   -> clarify (only costly ambiguity) -> context (retrieval) -> route (model tier) -> design (server: Groq)
 *   -> validate (6 stages, local) -> repair (server, bounded) -> proposal (nothing is written until the user accepts)
 *
 * Validation and the repair loop run here because the configuration lives here; the server only ever sees the compact
 * context, never records, and never decides what gets applied.
 */
export const MAX_REPAIR_ATTEMPTS = 2
const CONTEXT_BUDGET_TOKENS = 14_000

export type StepId = 'understand' | 'handle' | 'clarify' | 'context' | 'route' | 'design' | 'validate' | 'repair' | 'prepare'
export interface StepEvent {
  id: StepId
  label: string
  status: 'running' | 'done' | 'skipped' | 'error'
  detail?: string
  ms?: number
}

export interface RunInput {
  workspaceId: ID
  request: string
  /** answers to earlier clarifying questions; they are remembered and never asked again */
  answers?: QuestionAnswer[]
  onStep?: (e: StepEvent) => void
  /** abort a run in flight (the UI cancel button) */
  signal?: AbortSignal
}

export interface RunDeps {
  transport: Transport
  now?: () => Date
}

export type RunOutput = { intent: Intent; correlationId: string; steps: StepEvent[]; usage: UsageTotals; route?: Route } & (
  | { kind: 'answer'; text: string; references: string[]; source: 'deterministic' | 'model'; candidates?: string[] }
  | { kind: 'proposal'; proposal: Proposal; outcome: ValidationOutcome; valid: boolean; deterministic: boolean; stoppedBecause?: string }
  | { kind: 'clarify'; questions: Question[]; assumptions: string[] }
  | { kind: 'restore'; text: string; target?: RestoreTarget }
  | { kind: 'error'; code: string; message: string; retryable: boolean }
)

const zeroUsage = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0, latencyMs: 0, source: 'groq' })

const isFailure = (r: GenerateResponse | TransportFailure): r is TransportFailure => !('calls' in r)

const compactErrors = (errors: Issue[]) => errors.slice(0, 15).map((e) => ({ stage: e.stage, code: e.code, path: e.path, message: e.message.slice(0, 240), repair: e.repair.slice(0, 200) }))

/** Fix up the fields the application knows better than the model (ids/revision/versions) and stamp provenance. */
function stamp(kind: 'blueprint' | 'patch', raw: unknown, base: { projectId: string; revision: string }, gen: { model: string; provider: string; correlationId: string; intent: string; at: string }) {
  if (!raw || typeof raw !== 'object') return raw
  const o = structuredClone(raw) as Record<string, any>
  if (kind === 'patch') {
    o.schemaVersion = SCHEMA_VERSION
    o.expected_revision = base.revision
  } else if (o.meta && typeof o.meta === 'object') {
    o.meta.projectId = base.projectId
    o.meta.revisionId = base.revision
    o.meta.schemaVersion = SCHEMA_VERSION
    o.meta.blueprintVersion = BLUEPRINT_VERSION
    o.meta.generation = { model: gen.model.slice(0, 80), provider: gen.provider, generatedAt: gen.at, correlationId: gen.correlationId, intent: gen.intent }
  }
  return o
}

export async function runGenius(input: RunInput, deps: RunDeps): Promise<RunOutput> {
  const now = deps.now ?? (() => new Date())
  const steps: StepEvent[] = []
  const usage = zeroUsage()
  const correlationId = newCorrelationId(now().getTime())
  const ws = input.workspaceId
  const tenant = getTenantId()
  const actor = currentActor()
  const g = () => useGeniusStore.getState()

  const emit = (e: StepEvent) => {
    const i = steps.findIndex((s) => s.id === e.id)
    if (i >= 0) steps[i] = e
    else steps.push(e)
    input.onStep?.(e)
  }
  const timed = async <T>(id: StepId, label: string, fn: () => T | Promise<T>, detail?: (r: T) => string): Promise<T> => {
    const t0 = performance.now()
    emit({ id, label, status: 'running' })
    try {
      const r = await fn()
      emit({ id, label, status: 'done', detail: detail?.(r), ms: Math.round(performance.now() - t0) })
      return r
    } catch (e) {
      emit({ id, label, status: 'error', detail: e instanceof Error ? e.message : 'failed', ms: Math.round(performance.now() - t0) })
      throw e
    }
  }
  const base = { correlationId, steps, usage }
  const add = (r: GenerateResponse) => {
    usage.inputTokens += r.usage.inputTokens
    usage.outputTokens += r.usage.outputTokens
    usage.cachedTokens += r.usage.cachedTokens
    usage.calls += r.calls
    usage.latencyMs += r.latencyMs
    usage.source = r.provider
  }

  const { text: request } = clampRequest(input.request.trim())
  if (input.answers?.length) g().recordAnswers(ws, input.answers)

  // ---- 1. understand (deterministic) ------------------------------------------------------------------------------
  let cfg: ConfigModel = readConfig(ws)
  const names = [...cfg.modules.map((m) => m.name), ...cfg.workflows.map((w) => w.name)]
  const parsed = await timed('understand', 'Understanding your request', () => parseIntent(request, { hasModules: cfg.modules.some((m) => !m.system), knownNames: names, hasVersions: g().versions.some((v) => v.workspaceId === ws && !v.undone) }), (p) => `${p.intent.replace(/_/g, ' ')}${p.readOnly ? ' (read-only: nothing will change)' : ''}`)
  const intent = parsed.intent
  g().rememberRequest(ws, request, intent)
  g().audit1({ actor: actor.userId, workspaceId: ws, action: 'ai_request', target: correlationId, detail: `intent=${intent} confidence=${parsed.confidence}`, correlationId })

  // ---- 2. deterministic handlers (no model) -------------------------------------------------------------------------
  if (intent === 'explain_calculation' || intent === 'simulate_workflow') {
    const a = await timed('handle', intent === 'explain_calculation' ? 'Reading the stored formula' : 'Running a dry run (nothing is changed)', () => (intent === 'explain_calculation' ? explainCalculation(cfg, actor, request) : simulateWorkflow(cfg, actor, request, now())))
    return { ...base, intent, kind: 'answer', text: a.text, references: a.references, source: 'deterministic', candidates: a.candidates, route: { tier: 'none', reason: 'answered from the stored configuration' } }
  }
  if (intent === 'restore_version') {
    const r = await timed('handle', 'Finding the version to restore', () => restoreTarget(ws, request))
    return { ...base, intent, kind: 'restore', text: r.text, target: r.target, route: { tier: 'none', reason: 'restore never needs a model' } }
  }
  if (intent === 'modify' || intent === 'delete_or_deactivate') {
    const simple = simplePatch(cfg, actor, request)
    if (simple) {
      const { proposal, outcome } = await timed('handle', 'Building the change directly (no AI needed)', () => submitProposal(ws, { kind: 'patch', raw: simple.patch, request, intent, summary: simple.summary, assumptions: simple.assumptions, correlationId }))
      emit({ id: 'validate', label: 'Checking the change', status: outcome.report.ok ? 'done' : 'error', detail: outcome.report.ok ? 'all checks passed' : `${outcome.report.errors.length} problem(s)` })
      return { ...base, intent, kind: 'proposal', proposal, outcome, valid: outcome.report.ok, deterministic: true, route: { tier: 'none', reason: 'a simple, exact change handled by code' } }
    }
  }

  // ---- 3. clarify (only what is costly to guess) ----------------------------------------------------------------------
  const memory = g().memoryOf(ws)
  const answers = memory.answers
  const answered = new Set(answers.map((a) => a.questionId))
  const knownCurrency = currencyFromAnswers(answers) ?? currencyOfConfig(cfg)
  const pre = preflight({ request: `${request} ${answers.map((a) => a.answer).join(' ')}`, intent, answeredIds: answered, knownCurrency })
  if (intent !== 'question' && pre.questions.length) {
    emit({ id: 'clarify', label: 'Checking what I need to ask', status: 'done', detail: `${pre.questions.length} question${pre.questions.length === 1 ? '' : 's'}` })
    g().setPending(ws, pre.questions)
    return { ...base, intent, kind: 'clarify', questions: pre.questions, assumptions: pre.assumptions }
  }
  emit({ id: 'clarify', label: 'Checking what I need to ask', status: 'skipped', detail: 'nothing costly is unclear' })

  // ---- 4. context (retrieval) -----------------------------------------------------------------------------------------
  const operation = intent === 'new_build' ? 'new_build' : intent === 'question' ? 'question' : intent === 'repair' ? 'repair' : 'modify'
  const kind = intent === 'new_build' ? 'blueprint' : intent === 'question' ? 'answer' : 'patch'
  const revision = revisionOf(cfg)
  const projectId = projectIdFor(tenant, ws)
  const { project, context } = await timed(
    'context',
    'Gathering the parts of your CRM this touches',
    () => {
      const project = summarizeProject(tenant, cfg, actor, memory, g().versions)
      if (intent === 'new_build' && !cfg.modules.some((m) => !m.system)) return { project: undefined, context: undefined, fitted: undefined as undefined | ReturnType<typeof fitContext> }
      const ctx = retrieveContext(cfg, actor, request, intent)
      const fit = fitContext(ctx, CONTEXT_BUDGET_TOKENS)
      return { project, context: fit.context, fitted: fit }
    },
    (r) => (r.context ? `${r.context.modules.length} module${r.context.modules.length === 1 ? '' : 's'} in detail, ~${estimateTokens(JSON.stringify(r.context))} tokens` : 'empty workspace: nothing to include'),
  )

  // ---- 5. route -------------------------------------------------------------------------------------------------------
  const route = await timed('route', 'Choosing how to do this', () => routeModel({ intent, request, confidence: parsed.confidence, selectedModules: context?.modules.filter((m) => m.detail === 'full').length ?? 0 }), (r) => `${r.tier === 'strong' ? 'large model' : 'fast model'}: ${r.reason}`)
  if (route.tier === 'none') return { ...base, intent, route, kind: 'error', code: 'unroutable', message: 'This request could not be handled.', retryable: false }

  const variable = (extra: Partial<GenerateWire['variable']> = {}): GenerateWire['variable'] => ({
    request,
    project,
    context,
    memory: { ...memoryForPrompt(memory), requirements: [...(memory.requirements ?? []), ...answersAsRequirements(answers)].slice(-16) },
    meta: { projectId, revisionId: revision, currency: knownCurrency, locale: 'en-GB', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', today: now().toISOString().slice(0, 10) },
    ...extra,
  })
  const cancelled: TransportFailure = { ok: false, code: 'unavailable', message: 'Cancelled. Nothing was changed.', retryable: true }
  /** Cancelling stops waiting and discards whatever comes back; the server may still finish the call, but nothing is applied. */
  const call = (mode: 'generate' | 'repair', extra: Partial<GenerateWire['variable']> = {}): Promise<GenerateResponse | TransportFailure> => {
    if (input.signal?.aborted) return Promise.resolve(cancelled)
    const req = deps.transport({ workspaceId: ws, correlationId, operation: mode === 'repair' ? 'repair' : operation, kind, mode, tier: mode === 'repair' ? 'strong' : route.tier === 'none' ? 'fast' : route.tier, variable: variable(extra) })
    const sig = input.signal
    if (!sig) return req
    return Promise.race([req, new Promise<TransportFailure>((resolve) => sig.addEventListener('abort', () => resolve(cancelled), { once: true }))])
  }

  const fail = (code: string, message: string, retryable: boolean): RunOutput => ({ ...base, intent, route, kind: 'error', code, message, retryable })

  // ---- 6. design (server round trip) ------------------------------------------------------------------------------------
  let first: GenerateResponse | TransportFailure
  try {
    first = await timed('design', 'Designing with AI', () => call('generate'), (r) => (isFailure(r) ? r.code : r.ok ? `${r.models.join(', ')} · ${r.usage.inputTokens + r.usage.outputTokens} tokens (${r.usage.cachedTokens} cached)` : r.code))
  } catch {
    return fail('network', 'Could not reach the AI service. Your CRM is unchanged.', true)
  }
  if (isFailure(first)) return fail(first.code, first.message, first.retryable)
  add(first)
  if (!first.ok) return fail(first.code, first.message, first.retryable)
  const models = [...first.models]
  const env = first.envelope

  if (env.status === 'needs_clarification') {
    const qs = filterQuestions(env.questions ?? [], answers, [])
    if (!qs.length) return fail('clarification_loop', 'The AI wanted to ask something you already answered. Please add that detail to your request and try again.', false)
    g().setPending(ws, qs)
    return { ...base, intent, route, kind: 'clarify', questions: qs, assumptions: env.assumptions ?? [] }
  }
  if (kind === 'answer') {
    // read-only: only the answer text is ever used, whatever else the model returned
    return { ...base, intent, route, kind: 'answer', text: env.answer ?? '', references: env.references ?? [], source: 'model' }
  }

  // ---- 7. validate + bounded repair ------------------------------------------------------------------------------------
  const asOf = now().toISOString()
  const stampIt = (raw: unknown, model: string) => stamp(kind as 'blueprint' | 'patch', raw, { projectId, revision }, { model, provider: first && !isFailure(first) ? first.provider : 'groq', correlationId, intent, at: asOf })
  const validate = (raw: unknown): ValidationOutcome => {
    const ctx = validationContext(ws, { now: asOf })
    return kind === 'blueprint' ? validateBlueprint(raw, ctx) : validatePatch(raw, ctx)
  }

  let raw = stampIt(kind === 'blueprint' ? env.blueprint : env.patch, models[models.length - 1])
  let outcome = await timed('validate', 'Checking the design (6 stages)', () => validate(raw), (o) => (o.report.ok ? 'all checks passed' : `${o.report.errors.length} problem(s) to fix`))
  const seenSignatures = new Set<string>()
  const seenRaw = new Set<string>([hash53(JSON.stringify(raw))])
  let repairs = 0
  let stoppedBecause: string | undefined

  while (!outcome.report.ok && repairs < MAX_REPAIR_ATTEMPTS) {
    const sig = errorSignature(outcome.report.errors)
    if (seenSignatures.has(sig)) {
      stoppedBecause = 'The same problems came back after a repair, so I stopped instead of looping.'
      break
    }
    seenSignatures.add(sig)
    repairs += 1
    const errs = compactErrors(outcome.report.errors)
    let res: GenerateResponse | TransportFailure
    try {
      res = await timed('repair', `Fixing ${errs.length} problem${errs.length === 1 ? '' : 's'} (attempt ${repairs} of ${MAX_REPAIR_ATTEMPTS})`, () => call('repair', { previous: raw, errors: errs }), (r) => (isFailure(r) ? r.code : r.ok ? 'received a corrected design' : r.code))
    } catch {
      stoppedBecause = 'The AI service could not be reached for the repair.'
      break
    }
    if (isFailure(res) || !res.ok) {
      stoppedBecause = isFailure(res) ? res.message : res.message
      break
    }
    add(res)
    res.models.forEach((m) => !models.includes(m) && models.push(m))
    const next = res.envelope.status === 'ok' ? (kind === 'blueprint' ? res.envelope.blueprint : res.envelope.patch) : undefined
    if (!next) {
      stoppedBecause = 'The AI answered the repair with a question instead of a fix.'
      break
    }
    raw = stampIt(next, models[models.length - 1])
    const h = hash53(JSON.stringify(raw))
    if (seenRaw.has(h)) {
      stoppedBecause = 'The repair returned exactly the same output, so I stopped instead of looping.'
      break
    }
    seenRaw.add(h)
    outcome = await timed('validate', 'Checking the design again', () => validate(raw), (o) => (o.report.ok ? 'all checks passed' : `${o.report.errors.length} problem(s) remain`))
  }
  if (!outcome.report.ok && !stoppedBecause) stoppedBecause = `Still ${outcome.report.errors.length} problem(s) after ${repairs} repair attempt${repairs === 1 ? '' : 's'}. Nothing was applied.`

  // ---- 8. prepare the proposal (a draft nobody has accepted yet) ---------------------------------------------------------
  const { proposal } = await timed(
    'prepare',
    'Preparing the preview',
    () =>
      submitProposal(
        ws,
        { kind: kind === 'blueprint' ? 'build' : 'patch', raw, request, intent, summary: env.summary, assumptions: [...(env.assumptions ?? []), ...pre.assumptions], questions: [], correlationId, usage, models, repairAttempts: repairs },
        { now: asOf },
      ),
    (r) => `${r.proposal.changes.length} change${r.proposal.changes.length === 1 ? '' : 's'}`,
  )
  if (kind === 'blueprint' && outcome.blueprint) g().patchMemory(ws, (m) => ({ ...m, domain: outcome.blueprint!.meta.domain, assumptions: [...m.assumptions, ...(env.assumptions ?? [])].slice(-20) }))
  return { ...base, intent, route, kind: 'proposal', proposal, outcome, valid: outcome.report.ok, deterministic: false, stoppedBecause }
}