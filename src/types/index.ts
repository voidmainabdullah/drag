import type { FormulaSpec } from '#/genius/formula/ast'

export type ID = string

export interface Workspace {
  id: ID
  name: string
  description?: string
  icon: string
  color: string
  /** created as an empty workspace: no default modules and no default sidebar items */
  blank?: boolean
  /** bumped when new default sidebar pages are rolled out to existing workspaces */
  navRev?: number
  createdAt: string
  updatedAt: string
}

export type FieldType =
  | 'shortText'
  | 'longText'
  | 'number'
  | 'currency'
  | 'email'
  | 'phone'
  | 'website'
  | 'date'
  | 'datetime'
  | 'dropdown'
  | 'multiSelect'
  | 'radio'
  | 'checkboxes'
  | 'yesNo'
  | 'address'
  | 'file'
  | 'image'
  | 'document'
  | 'signature'
  | 'user'
  | 'relationship'
  | 'formula'
  | 'autoId'
  | 'rating'
  | 'percentage'
  | 'tags'
  | 'time'
  | 'color'
  | 'password'

export interface SelectOption {
  id: string
  label: string
  color?: string
}

export type FilterOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater'
  | 'less'
  | 'empty'
  | 'not_empty'

export interface Filter {
  id: ID
  fieldId: string
  op: FilterOp
  value?: unknown
}

export type FieldAccess = 'edit' | 'view' | 'hidden'
export type Cardinality = 'one-to-one' | 'many-to-one' | 'one-to-many' | 'many-to-many'
export type DeletePolicy = 'restrict' | 'cascade' | 'set_null'

/** Pipeline behaviour attached to a dropdown "stage" field (set by the Genius AI builder or by hand). */
export interface PipelineConfig {
  /** option ids that are allowed as the next stage, per current stage; absent => any move is allowed */
  transitions?: Record<string, string[]>
  /** field ids that must be filled before a record may enter the stage */
  requiredFields?: Record<string, string[]>
  /** record the time a record entered its current stage (CrmRecord.stageEnteredAt) */
  trackTimeInStage?: boolean
}

export interface Field {
  id: string
  /** API / formula name (slug of label) */
  name: string
  label: string
  type: FieldType
  placeholder?: string
  description?: string
  required?: boolean
  defaultValue?: unknown
  options?: SelectOption[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  readOnly?: boolean
  unique?: boolean
  width: 'full' | 'half' | 'third'
  order: number
  group?: string
  condition?: { fieldId: string; op: FilterOp; value?: unknown }
  /** relationship config. moduleId is a module id (or module key inside a template) */
  relation?: { moduleId: string; cardinality: Cardinality; lookupFieldId?: string; deletePolicy?: DeletePolicy; required?: boolean }
  formula?: string
  /** deterministic decimal formula (AST engine in src/genius/formula). When set it takes precedence over `formula`. */
  formulaSpec?: FormulaSpec
  pipeline?: PipelineConfig
  /** decimal places for number/currency/percentage values */
  precision?: number
  dateMin?: string
  dateMax?: string
  /** required only when another field of the same record matches */
  requiredWhen?: { fieldId: string; op: FilterOp; value?: unknown }
  idPrefix?: string
  currency?: string
  /** per-role access: roleId -> access level */
  permissions?: Record<string, FieldAccess>
}

export interface ModuleAccess {
  view: boolean
  create: boolean
  edit: boolean
  delete: boolean
}

export type ModuleKind = 'entity' | 'transaction' | 'log' | 'ledger' | 'junction'
/** which records of a module a role may see: everything, only the ones it created, or none */
export type RecordScope = 'all' | 'own' | 'none'

export interface Module {
  id: ID
  workspaceId: ID
  name: string
  description?: string
  icon: string
  color: string
  /** free-text grouping label shown on the modules page */
  category?: string
  /** parent module id => this is a submodule */
  parentId?: ID
  /** folder label */
  folder?: string
  fields: Field[]
  titleFieldId?: string
  visible: boolean
  /** false => the module was created/kept out of the sidebar (still listed under All Modules) */
  showInNav?: boolean
  /** position of the module's node on the Data Flow canvas */
  flowPos?: { x: number; y: number }
  archived: boolean
  order: number
  system?: 'tasks'
  /** roleId -> access overrides */
  permissions?: Record<string, ModuleAccess>
  /** roleId -> which records are visible (default 'all') */
  recordScope?: Record<string, RecordScope>
  /** what the module is: pipelines make no sense on a 'log' or 'ledger' */
  kind?: ModuleKind
  /** several fields that must be unique *together* (e.g. a junction module's two links) */
  constraints?: { uniqueTogether?: string[][] }
  /** fields that the record search looks at (default: all text fields) */
  searchFieldIds?: string[]
  /** id of the Genius AI project that created the module (informational) */
  aiProject?: string
  /** singular label ("Student" for a module called "Students") */
  singularName?: string
  counters?: Record<string, number>
  createdAt: string
  updatedAt: string
}

export interface FileMeta {
  id: string
  name: string
  size: number
  type: string
}

export interface CrmRecord {
  id: ID
  workspaceId: ID
  moduleId: ID
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
  createdBy?: ID
  archived?: boolean
  /** soft deleted (trash) */
  deletedAt?: string
  source?: string
  /** set when a data flow created this record from another module's record */
  origin?: { linkId: ID; recordId: ID }
  attachments?: FileMeta[]
  /** pipeline stage field id -> ISO time the record entered its current stage */
  stageEnteredAt?: Record<string, string>
}

export interface FormItem {
  fieldId: string
}

export interface FormSection {
  id: string
  title: string
  description?: string
  columns: 1 | 2 | 3
  items: FormItem[]
}

export interface PublicFormSettings {
  enabled: boolean
  title: string
  description: string
  submitLabel: string
  thankYouTitle: string
  thankYouMessage: string
  redirectUrl?: string
  accent: string
  background: string
  radius: number
  showBranding: boolean
}

export interface Form {
  id: ID
  workspaceId: ID
  moduleId: ID
  name: string
  description?: string
  sections: FormSection[]
  submitLabel: string
  public: PublicFormSettings
  createdAt: string
  updatedAt: string
}

export type ViewType = 'table' | 'kanban' | 'list' | 'calendar' | 'timeline' | 'gallery' | 'card'

export interface SortRule {
  id: ID
  fieldId: string
  dir: 'asc' | 'desc'
}

export interface ViewConfig {
  filters: Filter[]
  sorts: SortRule[]
  groupBy?: string
  hiddenFieldIds: string[]
  fieldOrder: string[]
  columnWidths: Record<string, number>
  dateFieldId?: string
  endDateFieldId?: string
  imageFieldId?: string
}

export interface View {
  id: ID
  workspaceId: ID
  moduleId: ID
  name: string
  type: ViewType
  config: ViewConfig
  order: number
  createdAt: string
  updatedAt: string
}

export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type WidgetType =
  | 'stat'
  | 'bar'
  | 'line'
  | 'pie'
  | 'table'
  | 'recentRecords'
  | 'recentActivities'
  | 'tasks'
  | 'calendar'
  | 'progress'
  | 'pipeline'
  | 'revenue'
  | 'metric'

export type DateRange = 'all' | '7d' | '30d' | '90d' | 'year'

export interface Widget {
  id: ID
  type: WidgetType
  title: string
  moduleId?: ID
  agg: Agg
  fieldId?: string
  groupBy?: string
  dateField?: string
  dateRange: DateRange
  filters: Filter[]
  limit?: number
  target?: number
  w: 1 | 2 | 3 | 4
  h: 1 | 2 | 3
  /** what the number measures and over which basis/period (shown on the widget) */
  definition?: string
  refresh?: 'live' | 'on_load'
}

export interface Dashboard {
  id: ID
  workspaceId: ID
  name: string
  widgets: Widget[]
  createdAt: string
  updatedAt: string
}

export type TriggerType =
  | 'record_created'
  | 'record_updated'
  | 'record_deleted'
  | 'field_changed'
  | 'status_changed'
  | 'date_reached'
  | 'manual'
  | 'relation_created'
  | 'relation_updated'
  | 'scheduled'

export interface WorkflowTrigger {
  type: TriggerType
  fieldId?: string
  /** optional: only fire when the field changes to this value */
  value?: unknown
  offsetDays?: number
  /** scheduled: run for every record of the module every N minutes (>= 5) */
  everyMinutes?: number
}

export interface WorkflowCondition {
  id: ID
  fieldId: string
  op: FilterOp
  value?: unknown
}

export type ActionType =
  | 'update_record'
  | 'change_status'
  | 'create_record'
  | 'create_task'
  | 'assign_user'
  | 'add_tag'
  | 'notify'
  | 'create_followup'

export interface WorkflowAction {
  id: ID
  type: ActionType
  fieldId?: string
  value?: unknown
  moduleId?: ID
  /** create_record: fieldId -> value template */
  values?: Record<string, string>
  title?: string
  days?: number
  userId?: ID
  message?: string
}

export interface Workflow {
  id: ID
  workspaceId: ID
  moduleId: ID
  name: string
  description?: string
  enabled: boolean
  trigger: WorkflowTrigger
  conditions: WorkflowCondition[]
  actions: WorkflowAction[]
  /** created by the Genius AI builder (AI workflows start disabled) */
  origin?: 'ai' | 'manual'
  /** touches financial data or acts outside the record: needs explicit approval before it can be enabled */
  consequential?: boolean
  approval?: { by: ID; at: string; note?: string; hash: string }
  /** scheduled triggers: last time the schedule fired (persisted so restarts do not repeat it) */
  lastScheduledAt?: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowStep {
  actionId: ID
  type: ActionType
  status: 'ok' | 'error' | 'skipped'
  message: string
}

export interface WorkflowRun {
  id: ID
  workspaceId: ID
  workflowId: ID
  workflowName: string
  recordId?: ID
  moduleId?: ID
  status: 'success' | 'skipped' | 'error'
  message: string
  at: string
  key?: string
  /** per-action outcome; a retry never repeats a step that already succeeded */
  steps?: WorkflowStep[]
  attempt?: number
  /** AI-built or consequential workflow: the entry can never be cleared (append-only) */
  frozen?: boolean
  /** 'dataflow' runs come from a module-to-module data flow link (workflowId is the link id) */
  kind?: 'workflow' | 'dataflow'
}

export type FlowTriggerType = 'record_created' | 'record_updated' | 'record_deleted' | 'field_changed'
export type FlowActionType = 'create_linked' | 'update_linked' | 'link_records'

/** which module owns the relationship field used to connect the two modules */
export interface FlowLinkField {
  side: 'source' | 'target'
  fieldId: string
}

export interface FlowFieldMap {
  id: ID
  sourceFieldId: string
  targetFieldId: string
}

export interface FlowSetValue {
  id: ID
  targetFieldId: string
  mode: 'copy' | 'value'
  sourceFieldId?: string
  value?: unknown
}

export interface DataFlowAction {
  type: FlowActionType
  /** create_linked: source field -> target field */
  mappings: FlowFieldMap[]
  /** create_linked: default values for target fields (raw, may contain {{tokens}} in text) */
  defaults: Record<string, unknown>
  /** relationship field that connects source and target records */
  linkField?: FlowLinkField
  /** update_linked: fields to set on the linked target records */
  sets: FlowSetValue[]
  /** link_records: find target records whose field equals a field of the source record */
  matchSourceFieldId?: string
  matchTargetFieldId?: string
}

export interface DataFlowLink {
  id: ID
  workspaceId: ID
  name: string
  enabled: boolean
  sourceModuleId: ID
  targetModuleId: ID
  trigger: { type: FlowTriggerType; fieldId?: string; value?: unknown }
  conditions: WorkflowCondition[]
  action: DataFlowAction
  createdAt: string
  updatedAt: string
}

export interface TemplateDataFlow extends Omit<DataFlowLink, 'id' | 'workspaceId' | 'sourceModuleId' | 'targetModuleId' | 'createdAt' | 'updatedAt'> {
  sourceKey: string
  targetKey: string
}

export interface TemplateModule {
  key: string
  name: string
  description?: string
  icon: string
  color?: string
  fields: Field[]
  titleFieldId?: string
}

export interface TemplateForm {
  moduleKey: string
  name: string
  sections: FormSection[]
  submitLabel?: string
}

export interface TemplateView {
  moduleKey: string
  name: string
  type: ViewType
  config: Partial<ViewConfig>
}

export interface TemplateWorkflow {
  name: string
  moduleKey: string
  trigger: WorkflowTrigger
  conditions: WorkflowCondition[]
  actions: WorkflowAction[]
}

export interface TemplateDashboard {
  name: string
  widgets: Omit<Widget, 'id'>[]
}

export interface Template {
  id: ID
  name: string
  category: string
  description: string
  icon: string
  color?: string
  builtin?: boolean
  modules: TemplateModule[]
  forms: TemplateForm[]
  views: TemplateView[]
  workflows: TemplateWorkflow[]
  dataflows?: TemplateDataFlow[]
  dashboard?: TemplateDashboard
  createdAt?: string
}

export interface Activity {
  id: ID
  workspaceId: ID
  action: string
  entity: 'record' | 'module' | 'field' | 'form' | 'view' | 'template' | 'dashboard' | 'workflow' | 'workspace' | 'system' | 'user'
  moduleId?: ID
  recordId?: ID
  description: string
  timestamp: string
  userId?: ID
}

export type PermissionKey =
  | 'viewModules'
  | 'createRecords'
  | 'editRecords'
  | 'deleteRecords'
  | 'exportData'
  | 'manageFields'
  | 'manageForms'
  | 'manageWorkflows'
  | 'manageDashboards'
  | 'accessSettings'

export interface Role {
  id: ID
  name: string
  description?: string
  builtin?: boolean
  permissions: Record<PermissionKey, boolean>
}

export interface User {
  id: ID
  name: string
  email: string
  roleId: ID
  color: string
  createdAt: string
}

export type NavItemType = 'category' | 'folder' | 'route' | 'module' | 'link'

export interface NavItem {
  id: ID
  label: string
  icon: string
  type: NavItemType
  /** for route items */
  path?: string
  moduleId?: ID
  parentId?: ID | null
  hidden?: boolean
  collapsed?: boolean
  order: number
  /** stable key for default routes */
  key?: string
}

export interface BrandSettings {
  brandName: string
  logo?: string
  primary: string
  accent: string
  theme: 'light' | 'dark'
  density: 'comfortable' | 'compact'
  formRadius: number
  formAccent?: string
}

export interface IntegrationConfig {
  id: ID
  type: 'webhook' | 'api'
  name: string
  url: string
  secret?: string
  events: string[]
  enabled: boolean
}

export interface Settings {
  brand: BrandSettings
  nav: Record<ID, NavItem[]>
  favourites: Record<ID, { moduleId?: ID; recordId?: ID; label: string }[]>
  recents: Record<ID, { moduleId: ID; recordId?: ID; label: string; at: string }[]>
  integrations: IntegrationConfig[]
  currentUserId?: ID
  currentWorkspaceId?: ID
  lastBackupAt?: string
  autosave: boolean
}
