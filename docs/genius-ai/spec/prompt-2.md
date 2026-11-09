# PROMPT 2 of 3 — Blueprint Engine, Validation & Repair, CRM Compiler, Versioning

PROJECT: MODULES — GENIUS AI CRM BUILDER
PREREQUISITE: Prompt 1 is complete (audit done, GROQ provider, context manager, intent parser, model router exist). Reuse them. Read `docs/genius-ai/audit.md` first.

Integrate into the EXISTING Modules storage model and runtime. Manual CRM configs and AI-created configs must use the same data model and the same canonical configuration. Do not create a second source of truth.

## PART A — Versioned CRM Blueprint (the contract between GROQ and Modules)
Define a stable, machine-readable, versioned schema (JSON Schema + typed internal objects) supporting:
- Metadata: name, description, domain, locale, currency, timezone, blueprint version, schema version, project ID, revision ID, generation metadata, dependency info.
- Modules (singular/plural labels, display field, title template, default sort, searchable fields, archive/soft delete, record capabilities, navigation), submodules where supported.
- Fields: only types in the app's controlled type registry; options, required rules, defaults, min/max length, numeric ranges, precision, formats, allowed values, uniqueness, date bounds, conditional required. Distinguish null / blank / missing / zero / false / empty collection. Money and percentages are decimal-safe with currency codes. Map unsupported types only if meaning is preserved, otherwise report the limitation.
- System-managed fields (id, created/updated, creator, last editor, owner, status) added automatically.
- Relationships: source/target module and field, cardinality, required behavior, label, delete policy (restrict/cascade/set null), reverse relations, junction modules created explicitly with uniqueness constraints.
- Forms, record layouts, list views, kanban views, saved filters, search config.
- Pipelines/stages: order, required fields per transition, allowed transitions, stage actions, time-in-stage. Never create a pipeline where it makes no sense (e.g. attendance, ledger). Keep record status, workflow execution status and payment status distinct.
- Workflows, formulas, dashboards, reports, roles, permissions (formulas/workflows/dashboards/permissions are detailed in Prompt 3 — define their schema slots now).
- Compact internal representation is allowed ONLY with documented, unambiguous short keys; always expand into fully typed objects before persistence. Never shorten IDs or drop info that makes units, currency, timezone or mappings ambiguous.
- Stable IDs: components referenced by ID, never by display name (renaming a module must not break references). Safe handling of name collisions.
- Reject unknown/unsupported structures unless an explicit compatibility policy allows them.

## PART B — Patch (incremental) operations
Support operations: add/update/remove for module, field, relationship, form, pipeline, workflow, formula, dashboard; enable_workflow / disable_workflow; update_permissions.
- AI returns a MINIMAL patch, never the full blueprint, for modifications ("add a WhatsApp follow-up field to leads" → one add_field op).
- A patch carries `expected_revision`. If the live revision differs, reload relevant context and reconcile — never blindly overwrite newer user/manual changes.
- Validate that every referenced existing component exists, belongs to the same workspace, and that removals don't break dependencies elsewhere.
- Manual edits and AI edits update the same canonical config; the AI must not revert manual changes because of a stale summary.

## PART C — Validation & Repair Engine
Multi-stage, with structured errors: stable error code, component path, description, severity, repair guidance.
1. JSON-schema validation (types, required props).
2. Reference validation (modules, fields, relations, roles, dependencies; same-tenant).
3. Business-logic validation (relation cardinality, pipeline transitions, formula/field type compatibility, workflow condition typing, permission sanity).
4. Cycle detection (relationship cycles, formula dependency cycles, workflow trigger loops).
5. Security validation: reject permission escalation (blueprint cannot grant more authority than the requesting user has), platform-level settings, cross-tenant references, unsafe/executable content, unregistered integration actions.
6. Sandbox / dry-run with synthetic test records (never copy real customer data unless explicitly authorized and policy-permitted). If sandbox isn't available for a feature, say so and block unsafe auto-activation.
7. Automatic repair: send ONLY the specific errors + the minimal relevant context to the model for a minimal patch. Bounded attempts. If the repair returns the same invalid config, detect it and STOP — no loops.
Never deploy because JSON was produced.

## PART D — CRM Compiler (trusted application-side adapter)
- Convert an approved, validated blueprint into the existing Modules infrastructure (modules, fields, relations, forms, views, pipelines, etc.).
- Atomic deployment: transaction or equivalent so no partial build is ever visible. Partially generated components are never active modules. If a build fails, the previous working CRM stays intact and the user gets actionable errors.
- Explicit, safe migrations for type/constraint changes with backup/recovery strategy; historical records preserved when labels/layouts change.
- Idempotent/resumable jobs: retrying a failed build must not duplicate components.
- Generated modules must support real CRUD, search, filter, sorting, relations, related-record panels, relation pickers, and permissions through existing APIs/services. No hardcoded demo data, no fake success responses.
- Forms validate server-side, hide restricted fields, and preview mode must NOT create production records or trigger side effects.

## PART E — Versioning & audit
- Every deployed config records compiler version + schema version + revision.
- Version history, diff between proposed and current, accept/reject, undo/rollback to a previous version (restores config; records are preserved).
- Optimistic concurrency/revision checks for concurrent editors.
- Audit log entries for config changes, permission changes, destructive actions, consequential AI operations.
- States visible to user: draft → validated → published → active.
- Enforced limits for very large blueprints: explain the constraint and offer an alternative; never silently drop requirements. Large builds may be split internally but are validated as a whole.

## Tests for this prompt
- Controlled/mocked GROQ response → blueprint → validate → compile → real records created/updated/linked.
- Negative: malformed JSON, missing fields, invalid references, unsupported types, circular relations/formulas, permission escalation, cross-tenant IDs, stale revision, repeated failed repair, failed compile leaves old CRM intact, retry doesn't duplicate.
- Rename module via stable ID keeps references working; manual edit not overwritten by AI patch.

## Deliverable
Working code, migrations, tests, and a factual report (files changed, migrations, supported capabilities, test results, limitations). No placeholders presented as done.
