import { z } from 'zod'

/**
 * Genius CRM Blueprint, schema version 1.
 * The contract between the model ("designs and reasons") and Modules ("executes"):
 * the model only ever produces data in this shape; the compiler is the only thing that writes the CRM.
 *
 * Conventions
 *  - Every component has a stable snake_case `id`; components reference each other by id, never by display name.
 *  - Existing (manually built) modules/fields appear under their real store ids.
 *  - No compact/short-key representation is used: everything is fully typed and expanded.
 *  - `strictObject` everywhere: unknown properties are rejected, never ignored.
 */
export const SCHEMA_VERSION = 1
export const BLUEPRINT_VERSION = '1.0.0'

export const LIMITS = {
  modules: 40,
  fieldsPerModule: 80,
  relationships: 80,
  forms: 60,
  views: 120,
  pipelines: 20,
  workflows: 60,
  formulas: 80,
  dashboards: 10,
  componentsPerDashboard: 24,
  roles: 12,
  options: 60,
  patchOps: 80,
  testsPerFormula: 20,
} as const

export const Id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'ids are lowercase snake_case, start with a letter, max 64 chars')
const Label = z.string().min(1).max(80)
const Text = z.string().max(400)
export const Scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()])
const Currency = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code, e.g. GBP')
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** Field types the app's registry supports and the AI may create. `password` is deliberately absent; `relationship` comes from `relationships`. */
export const FIELD_TYPES_AI = [
  'shortText', 'longText', 'number', 'currency', 'email', 'phone', 'website', 'date', 'datetime', 'dropdown', 'multiSelect',
  'radio', 'checkboxes', 'yesNo', 'address', 'file', 'image', 'document', 'signature', 'user', 'autoId', 'rating',
  'percentage', 'tags', 'time', 'color',
] as const
export const FieldTypeEnum = z.enum(FIELD_TYPES_AI)

export const FilterOpEnum = z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater', 'less', 'empty', 'not_empty'])

/**
 * Defaults keep the difference between "no default", null, blank, zero, false and an empty collection:
 *  - property absent            => no default
 *  - { kind: 'null' }           => explicitly empty/unknown
 *  - { kind: 'blank' }          => empty string
 *  - { kind: 'empty_collection' } => []
 *  - { kind: 'value', value }   => value (0 and false are real values)
 */
export const DefaultDef = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('null') }),
  z.strictObject({ kind: z.literal('blank') }),
  z.strictObject({ kind: z.literal('empty_collection') }),
  z.strictObject({ kind: z.literal('value'), value: Scalar }),
])

export const OptionDef = z.strictObject({ id: Id, label: Label, color: Color.optional() })

export const FormulaTestDef = z.strictObject({
  name: Label,
  /** values of the tested record by field id */
  record: z.array(z.strictObject({ fieldId: Id, value: Scalar })).max(40),
  /** related records, each row's `links` lists relationship fields that point back at the tested record */
  related: z
    .array(
      z.strictObject({
        moduleId: Id,
        values: z.array(z.strictObject({ fieldId: Id, value: Scalar })).max(40),
        linksToSelfVia: z.array(Id).max(4),
      }),
    )
    .max(40),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected: z.union([z.string(), z.boolean(), z.null()]),
})

export const RoundingEnum = z.enum(['half_up', 'half_even', 'down', 'up', 'floor', 'ceil'])
export const ResultTypeEnum = z.enum(['decimal', 'money', 'percentage', 'integer', 'text', 'boolean', 'date'])

export const FormulaDef = z.strictObject({
  /** id of the target formula field (created, or updated if it already is a formula field) */
  id: Id,
  /** module that owns the target field */
  moduleId: Id,
  label: Label,
  /** restricted expression language; never JavaScript/SQL */
  expression: z.string().min(1).max(1500),
  resultType: ResultTypeEnum,
  currency: Currency.optional(),
  precision: z.number().int().min(0).max(8),
  rounding: RoundingEnum,
  nullBehavior: z.enum(['zero', 'null', 'error']),
  divByZero: z.enum(['null', 'zero', 'error']),
  /** the fields the expression reads (checked against what the expression really reads) */
  sources: z.array(z.strictObject({ moduleId: Id, fieldId: Id })).max(40),
  description: Text.optional(),
  tests: z.array(FormulaTestDef).max(LIMITS.testsPerFormula),
})

export const FieldDef = z.strictObject({
  id: Id,
  label: Label,
  type: FieldTypeEnum,
  description: Text.optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  unique: z.boolean().optional(),
  defaultValue: DefaultDef.optional(),
  options: z.array(OptionDef).max(LIMITS.options).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(1).max(20000).optional(),
  /** decimal places for number / currency / percentage */
  precision: z.number().int().min(0).max(8).optional(),
  currency: Currency.optional(),
  dateMin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateMax: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requiredWhen: z.strictObject({ fieldId: Id, op: FilterOpEnum, value: Scalar.optional() }).optional(),
  idPrefix: z.string().max(8).optional(),
  group: Label.optional(),
  width: z.enum(['full', 'half', 'third']).optional(),
})

export const ModuleKindEnum = z.enum(['entity', 'transaction', 'log', 'ledger', 'junction'])

export const ModuleDef = z.strictObject({
  id: Id,
  singular: Label,
  plural: Label,
  description: Text.optional(),
  icon: z.string().max(40).optional(),
  color: Color.optional(),
  /** entity: people/things; transaction: money/events with a lifecycle; log/ledger: append-only history (no pipeline); junction: link table */
  kind: ModuleKindEnum,
  displayFieldId: Id.optional(),
  /** e.g. "{first_name} {last_name}"; creates a text formula field used as the record title */
  titleTemplate: z.string().max(200).optional(),
  defaultSort: z.strictObject({ fieldId: Id, dir: z.enum(['asc', 'desc']) }).optional(),
  searchFieldIds: z.array(Id).max(20).optional(),
  /** archive = records can be archived/soft-deleted (the app always keeps a trash) */
  archive: z.boolean().optional(),
  capabilities: z.strictObject({ create: z.boolean(), edit: z.boolean(), delete: z.boolean() }).optional(),
  navigation: z.strictObject({ group: Label.optional(), show: z.boolean().optional() }).optional(),
  parentModuleId: Id.optional(),
  uniqueTogether: z.array(z.array(Id).min(2).max(4)).max(4).optional(),
  fields: z.array(FieldDef).max(LIMITS.fieldsPerModule),
})

export const CardinalityEnum = z.enum(['one-to-one', 'many-to-one', 'one-to-many', 'many-to-many'])
export const DeletePolicyEnum = z.enum(['restrict', 'cascade', 'set_null'])

export const RelationshipDef = z.strictObject({
  /** id of the relationship field created in the source module */
  id: Id,
  label: Label,
  /** module that holds the relationship field */
  sourceModuleId: Id,
  targetModuleId: Id,
  /** many-to-one: many source records point at one target (e.g. payments -> fee) */
  cardinality: CardinalityEnum,
  required: z.boolean().optional(),
  deletePolicy: DeletePolicyEnum,
  /** shown on the target module's related-records panel (the reverse side is derived by the app) */
  reverseLabel: Label.optional(),
  /** field of the target shown when picking a record */
  lookupFieldId: Id.optional(),
})

export const FormSectionDef = z.strictObject({ id: Id, title: Label, columns: z.union([z.literal(1), z.literal(2), z.literal(3)]), fieldIds: z.array(Id).max(80) })
export const FormDef = z.strictObject({
  id: Id,
  moduleId: Id,
  name: Label,
  description: Text.optional(),
  submitLabel: Label.optional(),
  sections: z.array(FormSectionDef).min(1).max(12),
})

export const LayoutDef = z.strictObject({
  moduleId: Id,
  groups: z.array(z.strictObject({ title: Label, fieldIds: z.array(Id).max(80) })).max(12),
})

export const ViewTypeEnum = z.enum(['table', 'kanban', 'list', 'calendar', 'timeline', 'gallery', 'card'])
export const ViewDef = z.strictObject({
  id: Id,
  moduleId: Id,
  name: Label,
  type: ViewTypeEnum,
  filters: z.array(z.strictObject({ fieldId: Id, op: FilterOpEnum, value: Scalar.optional() })).max(12),
  sorts: z.array(z.strictObject({ fieldId: Id, dir: z.enum(['asc', 'desc']) })).max(4),
  groupByFieldId: Id.optional(),
  dateFieldId: Id.optional(),
  endDateFieldId: Id.optional(),
  hiddenFieldIds: z.array(Id).max(80).optional(),
})

export const PipelineDef = z.strictObject({
  /** id of the dropdown field holding the stage (created if absent): the pipeline's identity */
  id: Id,
  moduleId: Id,
  stageFieldLabel: Label.optional(),
  stages: z.array(z.strictObject({ id: Id, label: Label, color: Color.optional(), requiredFieldIds: z.array(Id).max(20).optional() })).min(2).max(20),
  /** allowed moves; empty/absent = any move between stages */
  transitions: z.array(z.strictObject({ from: Id, to: Id })).max(100).optional(),
  trackTimeInStage: z.boolean().optional(),
})

export const TriggerTypeEnum = z.enum([
  'record_created', 'record_updated', 'record_deleted', 'field_changed', 'status_changed', 'relation_created', 'relation_updated', 'date_reached', 'scheduled', 'manual', 'external_event',
])
export const ActionTypeEnum = z.enum(['update_record', 'change_status', 'create_record', 'create_task', 'assign_user', 'add_tag', 'notify', 'create_followup', 'send_message'])

export const WorkflowDef = z.strictObject({
  id: Id,
  moduleId: Id,
  name: Label,
  description: Text.optional(),
  trigger: z.strictObject({
    type: TriggerTypeEnum,
    fieldId: Id.optional(),
    value: Scalar.optional(),
    offsetDays: z.number().int().min(-365).max(365).optional(),
    everyMinutes: z.number().int().min(5).max(525600).optional(),
    /** external_event: id of a registered event (none exist in this app, so it is always rejected) */
    event: z.string().max(60).optional(),
  }),
  conditions: z.array(z.strictObject({ id: Id, fieldId: Id, op: FilterOpEnum, value: Scalar.optional() })).max(10),
  actions: z
    .array(
      z.strictObject({
        id: Id,
        type: ActionTypeEnum,
        fieldId: Id.optional(),
        value: Scalar.optional(),
        moduleId: Id.optional(),
        values: z.array(z.strictObject({ fieldId: Id, value: z.string().max(300) })).max(30).optional(),
        title: z.string().max(200).optional(),
        days: z.number().int().min(0).max(3650).optional(),
        userId: z.string().max(64).optional(),
        message: z.string().max(500).optional(),
        /** send_message only: channel (email/sms/whatsapp). No channel is registered in this app. */
        channel: z.string().max(30).optional(),
      }),
    )
    .min(1)
    .max(10),
})

export const AggEnum = z.enum(['count', 'sum', 'avg', 'min', 'max'])
export const WidgetTypeEnum = z.enum(['stat', 'bar', 'line', 'pie', 'table', 'recentRecords', 'progress', 'pipeline', 'metric'])
export const DateRangeEnum = z.enum(['all', '7d', '30d', '90d', 'year'])

export const DashboardDef = z.strictObject({
  id: Id,
  name: Label,
  components: z
    .array(
      z.strictObject({
        id: Id,
        title: Label,
        type: WidgetTypeEnum,
        moduleId: Id,
        agg: AggEnum,
        fieldId: Id.optional(),
        groupByFieldId: Id.optional(),
        dateFieldId: Id.optional(),
        dateRange: DateRangeEnum,
        filters: z.array(z.strictObject({ fieldId: Id, op: FilterOpEnum, value: Scalar.optional() })).max(8),
        limit: z.number().int().min(1).max(50).optional(),
        w: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        h: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        /** inspectable definition: what the number measures and over which period/basis */
        definition: z.string().min(5).max(300),
        refresh: z.enum(['live', 'on_load']),
      }),
    )
    .min(1)
    .max(LIMITS.componentsPerDashboard),
})

export const PermissionKeyEnum = z.enum([
  'viewModules', 'createRecords', 'editRecords', 'deleteRecords', 'exportData', 'manageFields', 'manageForms', 'manageWorkflows', 'manageDashboards', 'accessSettings',
])
export const RoleDef = z.strictObject({
  id: Id,
  name: Label,
  description: Text.optional(),
  /** keys granted; everything not listed is denied */
  grants: z.array(PermissionKeyEnum).max(10),
})

export const PermissionRule = z.strictObject({
  roleId: z.string().min(1).max(64),
  moduleId: Id,
  access: z.strictObject({ view: z.boolean(), create: z.boolean(), edit: z.boolean(), delete: z.boolean() }).optional(),
  recordScope: z.enum(['all', 'own', 'none']).optional(),
  fieldAccess: z.array(z.strictObject({ fieldId: Id, access: z.enum(['edit', 'view', 'hidden']) })).max(80).optional(),
})

export const MetaDef = z.strictObject({
  name: Label,
  description: Text.optional(),
  domain: z.string().min(2).max(60),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  currency: Currency,
  timezone: z.string().min(3).max(60),
  blueprintVersion: z.string().max(12),
  schemaVersion: z.number().int(),
  projectId: z.string().max(80),
  /** the config revision this blueprint was designed against */
  revisionId: z.string().max(80),
  generation: z
    .strictObject({
      model: z.string().max(80),
      provider: z.string().max(30),
      generatedAt: z.string().max(40),
      correlationId: z.string().max(80),
      intent: z.string().max(40),
    })
    .optional(),
})

export const Blueprint = z.strictObject({
  meta: MetaDef,
  modules: z.array(ModuleDef).max(LIMITS.modules),
  relationships: z.array(RelationshipDef).max(LIMITS.relationships),
  forms: z.array(FormDef).max(LIMITS.forms),
  layouts: z.array(LayoutDef).max(LIMITS.modules),
  views: z.array(ViewDef).max(LIMITS.views),
  pipelines: z.array(PipelineDef).max(LIMITS.pipelines),
  workflows: z.array(WorkflowDef).max(LIMITS.workflows),
  formulas: z.array(FormulaDef).max(LIMITS.formulas),
  dashboards: z.array(DashboardDef).max(LIMITS.dashboards),
  roles: z.array(RoleDef).max(LIMITS.roles),
  permissions: z.array(PermissionRule).max(200),
})
export type Blueprint = z.infer<typeof Blueprint>
export type ModuleDef = z.infer<typeof ModuleDef>
export type FieldDef = z.infer<typeof FieldDef>
export type RelationshipDef = z.infer<typeof RelationshipDef>
export type FormDef = z.infer<typeof FormDef>
export type ViewDef = z.infer<typeof ViewDef>
export type PipelineDef = z.infer<typeof PipelineDef>
export type WorkflowDef = z.infer<typeof WorkflowDef>
export type FormulaDef = z.infer<typeof FormulaDef>
export type DashboardDef = z.infer<typeof DashboardDef>
export type RoleDef = z.infer<typeof RoleDef>
export type PermissionRule = z.infer<typeof PermissionRule>
export type LayoutDef = z.infer<typeof LayoutDef>

// ---------------------------------------------------------------------------------------------
// Patch operations: the model returns a MINIMAL patch for changes, never the whole blueprint.
// ---------------------------------------------------------------------------------------------

const ModuleChanges = z.strictObject({
  singular: Label.optional(),
  plural: Label.optional(),
  description: Text.optional(),
  icon: z.string().max(40).optional(),
  color: Color.optional(),
  displayFieldId: Id.optional(),
  titleTemplate: z.string().max(200).optional(),
  searchFieldIds: z.array(Id).max(20).optional(),
  archive: z.boolean().optional(),
  capabilities: z.strictObject({ create: z.boolean(), edit: z.boolean(), delete: z.boolean() }).optional(),
})
const FieldChanges = FieldDef.omit({ id: true, type: true }).partial()
const RelChanges = RelationshipDef.pick({ label: true, required: true, deletePolicy: true, reverseLabel: true, lookupFieldId: true }).partial()
const FormChanges = FormDef.omit({ id: true, moduleId: true }).partial()
const ViewChanges = ViewDef.omit({ id: true, moduleId: true }).partial()
const PipelineChanges = PipelineDef.omit({ id: true, moduleId: true }).partial()
const WorkflowChanges = WorkflowDef.omit({ id: true, moduleId: true }).partial()
const FormulaChanges = FormulaDef.omit({ id: true, moduleId: true }).partial()
const DashboardChanges = DashboardDef.omit({ id: true }).partial()

const remove = <T extends string>(op: T) => z.strictObject({ op: z.literal(op), id: Id, moduleId: Id.optional() })

export const PatchOp = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add_module'), module: ModuleDef }),
  z.strictObject({ op: z.literal('update_module'), id: Id, changes: ModuleChanges }),
  z.strictObject({ op: z.literal('remove_module'), id: Id, mode: z.enum(['archive', 'delete']) }),
  z.strictObject({ op: z.literal('add_field'), moduleId: Id, field: FieldDef }),
  z.strictObject({ op: z.literal('update_field'), moduleId: Id, id: Id, changes: FieldChanges }),
  z.strictObject({ op: z.literal('remove_field'), moduleId: Id, id: Id }),
  z.strictObject({ op: z.literal('add_relationship'), relationship: RelationshipDef }),
  z.strictObject({ op: z.literal('update_relationship'), id: Id, moduleId: Id.optional(), changes: RelChanges }),
  remove('remove_relationship'),
  z.strictObject({ op: z.literal('add_form'), form: FormDef }),
  z.strictObject({ op: z.literal('update_form'), id: Id, changes: FormChanges }),
  remove('remove_form'),
  z.strictObject({ op: z.literal('add_view'), view: ViewDef }),
  z.strictObject({ op: z.literal('update_view'), id: Id, changes: ViewChanges }),
  remove('remove_view'),
  z.strictObject({ op: z.literal('add_pipeline'), pipeline: PipelineDef }),
  z.strictObject({ op: z.literal('update_pipeline'), id: Id, moduleId: Id.optional(), changes: PipelineChanges }),
  remove('remove_pipeline'),
  z.strictObject({ op: z.literal('add_workflow'), workflow: WorkflowDef }),
  z.strictObject({ op: z.literal('update_workflow'), id: Id, changes: WorkflowChanges }),
  remove('remove_workflow'),
  z.strictObject({ op: z.literal('enable_workflow'), id: Id }),
  z.strictObject({ op: z.literal('disable_workflow'), id: Id }),
  z.strictObject({ op: z.literal('add_formula'), formula: FormulaDef }),
  z.strictObject({ op: z.literal('update_formula'), id: Id, moduleId: Id.optional(), changes: FormulaChanges }),
  remove('remove_formula'),
  z.strictObject({ op: z.literal('add_dashboard'), dashboard: DashboardDef }),
  z.strictObject({ op: z.literal('update_dashboard'), id: Id, changes: DashboardChanges }),
  remove('remove_dashboard'),
  z.strictObject({ op: z.literal('update_permissions'), rule: PermissionRule }),
  z.strictObject({ op: z.literal('add_role'), role: RoleDef }),
])
export type PatchOp = z.infer<typeof PatchOp>

export const Patch = z.strictObject({
  schemaVersion: z.number().int(),
  /** the config revision the patch was designed against; a different live revision forces reconciliation */
  expected_revision: z.string().min(1).max(80),
  summary: z.string().max(300),
  ops: z.array(PatchOp).min(1).max(LIMITS.patchOps),
})
export type Patch = z.infer<typeof Patch>

// ---------------------------------------------------------------------------------------------
// Model response envelopes (what the LLM returns per operation)
// ---------------------------------------------------------------------------------------------

export const Question = z.strictObject({
  id: Id,
  question: z.string().min(3).max(300),
  why: z.string().max(200),
  /** suggested answers; empty for free text */
  options: z.array(z.string().max(80)).max(6),
  /** what Genius will assume if the user does not answer (low-risk ambiguity only) */
  safeDefault: z.string().max(120).optional(),
})
export type Question = z.infer<typeof Question>

export const BlueprintResponse = z.strictObject({
  status: z.enum(['ok', 'needs_clarification']),
  summary: z.string().max(400),
  assumptions: z.array(z.string().max(240)).max(12),
  questions: z.array(Question).max(4),
  blueprint: Blueprint.optional(),
})
export const PatchResponse = z.strictObject({
  status: z.enum(['ok', 'needs_clarification']),
  summary: z.string().max(400),
  assumptions: z.array(z.string().max(240)).max(12),
  questions: z.array(Question).max(4),
  patch: Patch.optional(),
})
export const AnswerResponse = z.strictObject({
  status: z.enum(['ok', 'refused']),
  answer: z.string().max(2500),
  /** ids of the modules/fields/workflows/formulas the answer is based on */
  references: z.array(z.string().max(80)).max(20),
})
export type BlueprintResponse = z.infer<typeof BlueprintResponse>
export type PatchResponse = z.infer<typeof PatchResponse>
export type AnswerResponse = z.infer<typeof AnswerResponse>
