# PROMPT 1 of 3 — Codebase Audit + Secure GROQ Intelligence Layer

PROJECT: MODULES — GENIUS AI CRM BUILDER
ROLE: You are the principal software architect and AI systems engineer integrating Genius AI Builder into the EXISTING Modules CRM application.

This is an integration into an existing project, not a new application. Do not create a parallel CRM, a second source of truth, or mock implementations. Do not remove or break existing features. Do not claim a capability is implemented when it only exists in the UI.

## Core principle
GROQ designs and reasons. Modules executes. The model is never the database, runtime, permission system, workflow executor, formula evaluator, or source of truth. The model never writes raw SQL or arbitrary production code.

## PART A — Codebase audit (do this first, before writing any code)
Inspect the whole project and produce a short written audit (save as `docs/genius-ai/audit.md`) covering:
1. Architecture, language/framework, routing, auth, tenant/workspace model.
2. Database schema and migration system.
3. How custom modules, fields, forms, layouts, views, pipelines, workflows, dashboards and permissions are CURRENTLY defined, stored and rendered by the existing CRM Builder.
4. Existing field-type registry, existing APIs and backend services, existing scheduler/background job system, existing audit log.
5. Existing design system and UI components.
6. A gap list: what the AI builder needs that does not exist yet, and what can be reused.
Use the existing mechanism for custom modules/fields/etc. The AI compiler must adapt to it, not replace it.

## PART B — Provider abstraction + GROQ integration
Implement server-side only (never in browser code):
- `LLMProvider` interface (generate structured output, usage reporting, error normalization) with a `GroqProvider` implementation, so the vendor can be swapped later.
- Endpoint: `https://api.groq.com/openai/v1/chat/completions`.
- `GROQ_API_KEY` from server env / existing secret manager only. Add `.env.example` with placeholders and document every variable. Never expose the key in client code, logs, errors, or blueprints.
- Model IDs configurable via env/config (e.g. `GENIUS_MODEL_FAST`, `GENIUS_MODEL_STRONG`). Do not hardcode model availability, pricing, caching or strict-schema support — check current Groq docs (see links file) and make support a config flag per model.
- Use Structured Outputs with strict JSON Schema where the selected model supports it; otherwise use the strongest constrained-output option, parse defensively and validate locally. Strict mode guarantees schema shape, NOT business correctness.
- Low temperature, per-operation `max_tokens`, request timeouts.
- Bounded retry with exponential backoff for 429/5xx/network errors; no retry for invalid requests. Handle truncated output, empty responses, refusals, content-filter responses, overload.
- On failure: friendly user message, and the user's request is preserved so they can retry without retyping.

## PART C — Intelligence components (clear separation, no needless microservices)
- `ai-core`: static system instructions + static JSON schemas (byte-for-byte identical across requests so Groq prompt caching can hit; put ALL variable content at the END of the prompt).
- `intent-parser`: classify each request as one of: new_build, modify, question, explain_calculation, simulate_workflow, repair, restore_version, delete_or_deactivate. Question/explain operations must never modify config or records.
- `context-manager`: maintains a compact per-workspace project summary (domain, module IDs, key field IDs, relationships, workflow IDs, formula IDs, roles, config version, pending questions, recent approved changes). Strictly tenant-scoped.
- `context-retriever`: given the classified intent, selects ONLY the relevant modules/fields/relations/workflows/formulas/permissions/dashboards plus the dependencies the validator needs. Never send the full repo, full schema, all records, or full chat history.
- `token-optimizer`: estimates/measures request size, trims irrelevant context, never removes constraints the validator needs.
- `model-router`: simple ops (rename/add field/add module/simple form) → fast model or deterministic logic with no LLM; relations/simple workflows → medium; initial multi-module builds, ambiguous requirements, advanced workflows, financial formulas, repairs → strong model.
- Clarification policy: if an essential business rule cannot be safely inferred, ask the FEWEST focused questions and retain understood requirements so the user never repeats themselves. For low-risk ambiguity choose a documented safe default.

## PART D — Observability
- Record per request: input tokens, output tokens, cached input tokens, cache hit rate, latency, model used, validation failures, repair attempts (from Groq `usage`).
- Structured logs with a correlation ID traceable across intent parser → GROQ call → validation → compiler → persistence.
- Do not put PII or record contents in prompts or logs unless strictly necessary; mask when needed.

## Tests for this prompt
- Mocked GROQ provider tests: timeout, 429, 5xx, malformed JSON, empty response, truncated output, refusal.
- Test that the static prompt prefix is identical across requests.
- Test that context retrieval returns required dependencies (compare full-context vs relevant-context prompts and assert nothing required was omitted).
- Test tenant isolation of project summaries and caches.

## Deliverable
Working code + tests + `docs/genius-ai/audit.md` + `.env.example`. Finish with a factual report: files changed, what works, tests run and results, limitations. No TODO placeholders presented as complete.
