# Genius AI Builder — codebase audit

Written from the code as it stood before any Genius AI work (commit `3a91227` + the uncommitted "Modules/Xcrm" CRM builder in the working tree). Every statement below was checked against files in `src/`.

## 1. Architecture

| Area | Reality |
|---|---|
| Stack | TanStack Start 1.169 (file routes in `src/routes`, generated `routeTree.gen.ts`), React 19, Tailwind 4, zustand 5, zod 4, recharts, dnd-kit, date-fns, xlsx. |
| Hosting | Cloudflare Worker through `@cloudflare/vite-plugin` + the Whop Vite plugin (`vite.config.ts`, `wrangler.jsonc`, `whop.app.json`). No filesystem, no Postgres, no daemon. |
| Routing | One thin route file per page; every page component lives in `src/pages/*`. Public forms at `/f/$formId`; everything else is wrapped in `AppShell` by `routes/__root.tsx`. |
| Rendering | SSR renders only a skeleton. `AppBoot` (`components/layout/AppShell.tsx`) calls `initApp()` on the client, which hydrates every zustand store from `localStorage`. |
| Auth | **None.** `userStore` holds local "team members" (name/email/role); the Topbar user switcher just changes `settings.currentUserId`. `RolesPage` itself states permissions are UI-only. |
| Tenancy | **None server-side.** The unit is the *workspace* (`Workspace`, `workspaceId` on every module/record/form/view/dashboard/workflow). All workspaces of a browser profile share the same `crm:*` localStorage keys. |
| Server code | No server functions existed. |

## 2. Database and migrations

There is no database. The canonical store is browser storage behind `src/services/storage/*`:

* `storageService.ts` — `KEYS` (`crm:modules`, `crm:records`, `crm:forms`, `crm:views`, `crm:dashboards`, `crm:workflows`, `crm:workflowRuns`, `crm:dataflows`, `crm:settings`, `crm:users`, `crm:roles`, `crm:activities`, `crm:workspaces`, `crm:templates`), quota/corruption handling, and a numbered migration runner (`CURRENT_VERSION = 3`, `migrations[n]`).
* `moduleStorage`, `recordStorage`, `settingsStorage`, `templateStorage` — typed load/save per collection.
* `stores/index.ts` — debounced autosave per store (250 ms), cross-tab `storage` event reload, `flushAll()`.
* `fileStorage.ts` — attachments in IndexedDB.
* `backupService.ts` — JSON backup/restore over `DATA_KEYS`.

## 3. How CRM structure is defined, stored and rendered today

| Concept | Definition (`src/types/index.ts`) | Store / service | Rendered by |
|---|---|---|---|
| Module | `Module` (id, workspaceId, name, icon, fields[], titleFieldId, permissions per role, parentId, counters, archived, system) | `useModuleStore`, `moduleService.createModule/deleteModule/renameModule/removeFieldCascade` | `ModulePage`, `RecordsView` (table/kanban/list/calendar/timeline/gallery/card), `NavTree` |
| Field | `Field` (id, name slug, type, options, min/max, required, unique, defaultValue, condition, relation, formula, currency, per-role `permissions`) | `moduleStore.addField/updateField/...` | `FieldInput`, `FieldValue`, `FormRenderer`, `FieldConfigPanel` |
| Field-type registry | `FIELD_TYPES` / `FieldType` in `utils/fieldTypes.ts` (29 types) + `buildFieldSchema` (zod per field) | — | Field manager |
| Relationship | `Field.relation {moduleId, cardinality, lookupFieldId}`; reverse links are computed by scanning relation fields (related-record panels in `ModulePanels`) | `RelationPicker` | related panels |
| Form | `Form` (sections → fieldIds, public settings) | `useFormStore`, `formService` | `FormBuilder`, `PublicFormPage` |
| View | `View` (type + `ViewConfig`: filters, sorts, groupBy, hidden fields, date fields) | `useViewStore` | `RecordsView` |
| Pipeline | **No entity.** A "pipeline" is a kanban view grouped by a dropdown field. No transitions, required-per-stage or time-in-stage. | — | `KanbanView` |
| Workflow | `Workflow` (trigger, conditions, actions; `enabled`) and `WorkflowRun` log (capped at 1500) | `useWorkflowStore`, `useRunStore`, `workflowEngine.ts` | `WorkflowEditor`, `WorkflowsPage` |
| Data flow | `DataFlowLink` module-to-module automation | `dataFlowEngine.ts` | `DataFlowWorkspace` |
| Dashboard | `Dashboard` → `Widget[]` (stat/bar/line/pie/table/…, agg, filters, groupBy, dateRange) | `useDashboardStore`, `utils/metrics.ts` | `WidgetView`, `DashboardsPage` |
| Permissions | `Role.permissions` (10 booleans), `Module.permissions[roleId]`, `Field.permissions[roleId]` | `userStore`, `hooks/useData.usePerms` | UI gating only |
| Templates | `Template` data installed by the single generic `services/installer.ts` | `useTemplateStore` | `TemplatesPage` |

Formulas: `Field.type === 'formula'` holds a string expression; `utils/formula.ts` is a safe tokenizer/parser/evaluator (no `eval`), but it uses **binary floats**, runs on a single record, and has no aggregates across related records and no dependency/cycle check.

## 4. Existing APIs, services, scheduler, audit log

* APIs/back-end services: none. All "services" are client modules mutating zustand stores.
* Scheduler: `workflowEngine.startWorkflowEngine()` — a `setInterval(60 s)` in the open tab for `date_reached` triggers, de-duplicated via `WorkflowRun.key`. There is no scheduler that runs while the app is closed.
* Loop protection: depth counter (`MAX_DEPTH = 3`) only.
* Outbound messaging: **none.** `IntegrationsPage` stores webhook configs and can send one manual test request; automatic delivery is explicitly not implemented. So no action in the engine can contact anybody outside the browser.
* Audit log: `activityStore` (`Activity`, last 3000, human-readable descriptions). Not tamper-evident, no actor/tenant fields beyond `userId`.

## 5. Design system and UI

Tailwind 4 tokens in `src/styles.css` (`--primary`, `--surface`, `--line`, `gradient-brand`, dark mode). Components: `ui/Button`, `ui/controls` (inputs, Select, Checkbox, SearchInput, Field), `ui/Modal`, `ui/Overlays` (toasts, confirm), `ui/misc` (`Badge`, `Card`, `EmptyState`, `Notice`, `PageHeader`, `Tabs`, `Skeleton`), `layout/Page`. Sidebar items come from `navService.DEFAULT_SECTIONS` (`NAV_REV` upgrades existing workspaces).

## 6. Gap list

| Needed by the AI builder | Exists? | Plan |
|---|---|---|
| Login / tenant identity | No | Supabase email+password (`@supabase/supabase-js`, publishable key only); Supabase user id = tenant; storage keys namespaced per user id; legacy un-namespaced data is adopted once by the first account that signs in (copy, never deleted). |
| Server-side AI | No server code | `createServerFn` + `.validator()` handlers; Groq key only from the `GROQ_API_KEY` binding; Supabase access token verified on every call. |
| Provider abstraction, router, caching-friendly prompts, usage metrics | No | `src/genius/ai/*`. |
| Versioned blueprint + patch ops, stable IDs | No | `src/genius/blueprint/*` (zod). |
| Validation stages, bounded repair | `buildFieldSchema` only for records | `src/genius/validation/*`. |
| Atomic compiler into existing stores | `installer.ts` installs templates but is not atomic/idempotent | Pure "apply blueprint to a config model" + a commit step with snapshot/rollback that writes through the existing stores. Manual and AI configs use the same stores. |
| Revision / version history / diff / undo | No | Content-hash revision of the workspace config + versions stored through the storage layer (new `crm:genius` key, included in backups). Undo restores config, never deletes records (modules that hold records are archived). |
| Pipelines with transitions | No | Optional `Field.pipeline` (stages' required fields, allowed transitions) enforced in `validateRecordData`. |
| Decimal-safe formulas, aggregates over related records, dependency graph | No | `src/genius/formula/*` (own BigInt decimal, AST, no eval). Existing float formulas keep working; AI formulas use `Field.formulaSpec`. |
| Workflow dry-run, approval gate, idempotency keys, step log, richer loop prevention | Partial (log, depth limit, run keys) | Extend `workflowEngine.ts` + `src/genius/workflow/*`. |
| Permission ceiling for AI configs | UI-only role booleans | Pure policy module reused by `usePerms`; compiler refuses escalation. |
| Dashboards respecting permissions | `metrics.ts` has no permission awareness | Permission-scoped metric evaluation with inspectable definitions. |
| Server-side execution of workflows / queries | Impossible: records live in the browser | Documented limitation; the app-side engine remains the executor. |
| External messages (email/WhatsApp) | No | Not implemented; blueprints that ask for them get a "not implementable" report. |

## 7. Reuse vs. new

Reused unchanged: all stores, `installer`-style nav placement (`placeModuleInNav`), `validateRecordData`, `valueOf`, `metrics.ts`, `activityStore`, UI kit, templates. Extended minimally and backwards-compatibly: `Field` (`pipeline`, `formulaSpec`, relation `deletePolicy`), `Module` (`kind`, `constraints`, `searchFieldIds`), `Workflow` (`origin`, `consequential`, `approval`), `WorkflowRun` (`steps`, `attempt`), `storageService` (namespace).
