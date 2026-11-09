# PROMPT 3 of 3 — Workflow Engine, Formula Engine, Dashboards, Permissions, Genius AI UI, End-to-End Tests

PROJECT: MODULES — GENIUS AI CRM BUILDER
PREREQUISITE: Prompts 1 and 2 are complete (GROQ layer, blueprint, validator, compiler, versioning). Reuse them and the existing Modules scheduler, auth, audit log and design system. Do not build parallel infrastructure.

## PART A — Formula Engine (deterministic & safe)
- AI outputs formulas as a restricted expression format / AST — NEVER JavaScript, Python or SQL, and never executed via eval.
- Each formula declares: target field or report metric, source fields, result type, null behavior, precision, rounding rule, dependencies.
- Decimal-safe arithmetic for money/percentages (no binary floats), explicit currency codes, no mixing currencies without a configured exchange-rate source and date.
- Division-by-zero protection, conditional expressions, totals/counts/percentages, aggregates across related records.
- Dependency graph with circular-dependency detection; recalculation order; prevent stale totals, double counting and duplicated payments.
- "Parses" ≠ "correct": run deterministic test cases and compare against expected values.
- Required test scenarios: Outstanding = Total Fees + Fines − Payments (paid, partially paid, unpaid, overdue, refunded, overpaid); Percentage = Obtained / Total × 100 (including total = 0); commission calculation changes; monthly profit after expenses.
- Explaining a calculation returns the real formula and source fields — not an invented narrative.

## PART B — Workflow Engine
- Triggers: record-created, record-updated, field-changed, status-changed, relation-created/updated, date-reached, scheduled, manual, and registered external events (as the existing architecture supports).
- Conditions type-checked against real field definitions (no incompatible comparisons).
- Actions: only registered actions with documented parameter schemas and permission checks (create/update record, assign, notify, change status, scheduled follow-up, etc.). Integrations are explicit capabilities, never guessed.
- Server-side execution, tenant-aware authorization, immutable execution log.
- Delayed/scheduled work uses the existing scheduler or a reliable job service; due times and state are persisted and survive restarts.
- Loop prevention, idempotency keys / duplicate-execution protection (duplicate webhooks, repeated scheduled ticks), bounded retries, retry/investigate failed jobs without repeating completed actions.
- Dry-run mode: show which records match, which actions would run, and what would change — without applying anything.
- Activation of workflows that send external messages, touch financial data or are otherwise consequential requires explicit user authorization. Never send messages/charge payments in preview or sandbox.
- Example to support: "add a follow-up if a lead has not replied after two days"; "when a tenant pays rent, update the property's income".

## PART C — Dashboards, reports & analytics
- Each component declares data source, aggregation, filters, grouping, date field, refresh behavior, currency behavior, permission scope.
- Built from real authorized data only. Respect record-level and field-level permissions so totals/charts can't leak restricted info.
- Metric definitions are inspectable (e.g. "monthly income" states whether it uses received payments or issued invoices, and the period).
- Query performance measured; deterministic caching with tenant-safe keys and proper invalidation.

## PART D — Permissions & security
- Role-based (and attribute-based where the product supports it) rules for modules, actions, records, fields, exports, reports, workflow activation, admin settings; ownership/team/assigned/private/shared records, field masking, read-only.
- Enforce tenant isolation in server queries, background jobs, workflow execution, files, exports, analytics and AI context retrieval.
- AI-generated config can never exceed the requesting user's authority, change platform-level settings, or weaken mandatory controls.
- Example: "only managers can access landlord records".
- Don't claim legal/regulatory compliance unless actually implemented and verified.
- Optional controlled CSV/Excel import: column mapping (AI may suggest from headers + small authorized sample), server-side validation, user-approved duplicate rules, error preview, recoverable import log.

## PART E — Genius AI Builder UI (same visual language and access model as Modules)
- Natural-language workspace: create a new CRM, extend one, change a rule, ask a question, undo.
- Example prompts for inspiration (never forced templates).
- GENUINE progress states tied to real backend steps (understanding → designing → validating → preparing preview → saving). No fake percentages; "done" only after the server confirms.
- Proposed-changes preview with diff vs current version; accept/reject; build summary listing created / modified / preserved / not implementable / assumptions / what needs approval.
- Clarifying questions UI that remembers earlier answers.
- Generated modules appear in the same navigation/components as manual modules; manual editing, visual workflow editor, formula editor, version history, undo, publish/activate controls, validation/error report.
- Clear status badge: draft / validated / published / active, and whether any external automation is enabled.
- Honest limitations: no "100% error-free" promises; explain limits and offer safe alternatives.
- Desktop + mobile usable, keyboard navigation, accessible labels.

## PART F — Automated tests
Integration: natural-language request (mocked GROQ) → compile → real records → relations → workflows → formulas → dashboard from test data → tenant isolation.
Negative: malformed JSON, invalid refs, unsupported actions, circular formulas, workflow loops, permission escalation, cross-tenant IDs, stale revisions, duplicate webhook events, repeated scheduled tasks, provider failures, model timeouts.

FIRST MILESTONE (must pass end-to-end): "School academy CRM" → generate → create real students/classes → mark attendance → calculate fees (all payment cases) → fire fee reminder (dry-run, then approved) → show real analytics. Second scenario: letting/real-estate CRM (landlord with multiple properties, multiple enquiries per property, tenant linked to tenancy, tenancy ending, payment allocation).

## Deliverable
Working, integrated, tested implementation. No TODOs, fake success, hardcoded demo data or placeholders. End with a concise factual report: files changed, migrations, supported capabilities, tests run and results, actual models/config used, token measurements (input/output/cached), remaining limitations. Preserve all existing user records and features.
