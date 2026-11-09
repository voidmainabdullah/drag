import { z } from 'zod'
import type { ActionType, FieldType, PermissionKey, TriggerType } from '#/types'

/**
 * What the engines will actually execute. Anything not listed here is "not implementable" and is reported
 * to the user instead of being guessed at (integrations are explicit capabilities).
 */
export interface ActionSpec {
  type: ActionType
  label: string
  description: string
  /** zod schema of the action's parameters */
  params: z.ZodType
  /** permission the workflow's owner needs to use it */
  permission: PermissionKey
  /** changes data other than the triggering record, or is otherwise worth a human look before it runs */
  consequential: boolean
  /** writes to records (used for loop analysis): which module/fields */
  writes: 'self_field' | 'other_module' | 'task' | 'none'
}

const id = z.string().min(1)

export const ACTION_REGISTRY: Record<ActionType, ActionSpec> = {
  update_record: { type: 'update_record', label: 'Update a field', description: 'Sets one field on the triggering record.', params: z.object({ fieldId: id, value: z.unknown() }), permission: 'editRecords', consequential: false, writes: 'self_field' },
  change_status: { type: 'change_status', label: 'Change status', description: 'Sets a dropdown/radio status field on the triggering record.', params: z.object({ fieldId: id, value: z.unknown() }), permission: 'editRecords', consequential: false, writes: 'self_field' },
  assign_user: { type: 'assign_user', label: 'Assign a user', description: 'Sets a user field on the triggering record.', params: z.object({ fieldId: id, userId: id }), permission: 'editRecords', consequential: false, writes: 'self_field' },
  add_tag: { type: 'add_tag', label: 'Add a tag', description: 'Adds a tag/option to a tags, multi-select or checkboxes field.', params: z.object({ fieldId: id, value: id }), permission: 'editRecords', consequential: false, writes: 'self_field' },
  create_record: { type: 'create_record', label: 'Create a record', description: 'Creates a record in another module from templates of the triggering record.', params: z.object({ moduleId: id, values: z.record(z.string(), z.string()).optional() }), permission: 'createRecords', consequential: true, writes: 'other_module' },
  create_task: { type: 'create_task', label: 'Create a task', description: 'Creates a task in My Tasks.', params: z.object({ title: z.string().optional(), days: z.number().int().min(0).optional(), userId: z.string().optional() }), permission: 'createRecords', consequential: false, writes: 'task' },
  create_followup: { type: 'create_followup', label: 'Schedule a follow-up', description: 'Creates a follow-up task due after N days.', params: z.object({ title: z.string().optional(), days: z.number().int().min(0).optional(), userId: z.string().optional() }), permission: 'createRecords', consequential: false, writes: 'task' },
  notify: { type: 'notify', label: 'Notify in the app', description: 'Shows an in-app notification and writes an activity entry. It never leaves the app.', params: z.object({ message: z.string().optional() }), permission: 'viewModules', consequential: false, writes: 'none' },
}

export const isRegisteredAction = (t: string): t is ActionType => t in ACTION_REGISTRY

/** Triggers the engine can fire. `external_event` has no registered events in this app. */
export const SUPPORTED_TRIGGERS: Record<TriggerType | 'external_event', { supported: boolean; note?: string }> = {
  record_created: { supported: true },
  record_updated: { supported: true },
  record_deleted: { supported: true },
  field_changed: { supported: true },
  status_changed: { supported: true },
  relation_created: { supported: true },
  relation_updated: { supported: true },
  date_reached: { supported: true, note: 'Evaluated while the app is open (once a minute); due dates are stored on the records.' },
  scheduled: { supported: true, note: 'Evaluated while the app is open; the last run time is persisted so a restart never repeats a tick.' },
  manual: { supported: true },
  external_event: { supported: false, note: 'No external event sources are registered in this app (no webhooks in, no integrations).' },
}

/** Field types the AI may create and which stored value shapes they accept. */
export const NUMERIC_FIELD_TYPES: FieldType[] = ['number', 'currency', 'percentage', 'rating']
export const TEXT_FIELD_TYPES: FieldType[] = ['shortText', 'longText', 'email', 'phone', 'website', 'color', 'time']
export const CHOICE_FIELD_TYPES: FieldType[] = ['dropdown', 'radio', 'multiSelect', 'checkboxes']
export const COLLECTION_FIELD_TYPES: FieldType[] = ['multiSelect', 'checkboxes', 'tags', 'file', 'image', 'document']
export const DATE_FIELD_TYPES: FieldType[] = ['date', 'datetime']

/** Ids the platform owns on every record; a blueprint may not define them. */
export const RESERVED_FIELD_IDS = new Set(['id', 'created_at', 'updated_at', 'created_by', 'last_edited_by', 'owner_id', 'workspace_id', 'module_id', 'deleted_at'])

/** Property names that are platform/account level and can never appear in a blueprint. */
export const PLATFORM_KEYS = new Set(['settings', 'brand', 'integrations', 'webhooks', 'billing', 'users', 'auth', 'secrets', 'apiKeys', 'api_key', 'password', 'token', 'tenant', 'tenantId', 'workspace', 'workspaceId'])

/** Built-in roles that can never be restricted or replaced by AI configuration (lock-out protection). */
export const PROTECTED_ROLE_IDS = new Set(['role_owner', 'role_admin'])
