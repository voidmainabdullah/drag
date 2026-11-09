import type { CrmRecord, Field, FieldAccess, Module, ModuleAccess, PermissionKey, RecordScope, Role } from '#/types'

/**
 * Pure permission policy: the single implementation behind the UI hook `usePerms`, the compiler's escalation
 * check, AI context retrieval, dashboards and exports. No store access, no globals.
 */
const MODULE_PERM: Record<keyof ModuleAccess, PermissionKey> = {
  view: 'viewModules',
  create: 'createRecords',
  edit: 'editRecords',
  delete: 'deleteRecords',
}

export const can = (role: Role | undefined, key: PermissionKey): boolean => !!role?.permissions[key]

export function canModule(role: Role | undefined, m: Module | undefined, action: keyof ModuleAccess): boolean {
  if (!role) return false
  const o = m?.permissions?.[role.id]
  if (o && o[action] !== undefined) return o[action]
  return can(role, MODULE_PERM[action])
}

export function fieldAccess(role: Role | undefined, f: Field): FieldAccess {
  return role ? (f.permissions?.[role.id] ?? 'edit') : 'hidden'
}

export function recordScope(role: Role | undefined, m: Module): RecordScope {
  if (!role) return 'none'
  return m.recordScope?.[role.id] ?? 'all'
}

export interface Actor {
  userId: string
  role: Role | undefined
}

/** Can this actor see this record at all (module access + record scope)? */
export function canSeeRecord(actor: Actor, m: Module, r: CrmRecord): boolean {
  if (!canModule(actor.role, m, 'view')) return false
  const scope = recordScope(actor.role, m)
  if (scope === 'none') return false
  if (scope === 'own') return r.createdBy === actor.userId
  return true
}

/** Fields the actor may read in this module. */
export function readableFields(actor: Actor, m: Module): Field[] {
  if (!canModule(actor.role, m, 'view')) return []
  return m.fields.filter((f) => fieldAccess(actor.role, f) !== 'hidden')
}

/** Record data with every field the actor may not read removed (masking). */
export function maskRecordData(actor: Actor, m: Module, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of readableFields(actor, m)) if (f.id in data) out[f.id] = data[f.id]
  return out
}

/** Keys an AI-built role may never be granted, whoever asks. */
export const NEVER_GRANTABLE_BY_AI: PermissionKey[] = ['accessSettings']

/** A builder run may only grant what the requesting user holds, and never platform-level keys. */
export function canGrant(actor: Actor, key: PermissionKey): boolean {
  return !NEVER_GRANTABLE_BY_AI.includes(key) && can(actor.role, key)
}

/** Which global permission an actor needs to change a kind of configuration. */
export const CONFIG_PERMISSION = {
  module: 'manageFields',
  field: 'manageFields',
  relationship: 'manageFields',
  formula: 'manageFields',
  pipeline: 'manageFields',
  form: 'manageForms',
  view: 'manageForms',
  workflow: 'manageWorkflows',
  dashboard: 'manageDashboards',
  role: 'accessSettings',
  permission: 'accessSettings',
} as const satisfies Record<string, PermissionKey>
export type ConfigKind = keyof typeof CONFIG_PERMISSION
