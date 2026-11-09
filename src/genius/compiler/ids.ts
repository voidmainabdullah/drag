import { hash53 } from '../config/model'

/**
 * Stable, deterministic store ids for blueprint components.
 *
 * A blueprint talks about `students`; the store holds `mod_<ws>_students`. Because the mapping is a pure function of
 * (workspace, blueprint id), re-running a build maps to the SAME ids, finds the components it already created and
 * updates them instead of duplicating them. Ids never depend on display names, so renaming a module cannot break
 * a reference.
 */
export type IdKind = 'module' | 'form' | 'view' | 'workflow' | 'dashboard' | 'role'
const PREFIX: Record<IdKind, string> = { module: 'mod', form: 'form', view: 'view', workflow: 'wf', dashboard: 'dash', role: 'role_ai' }

export const workspaceTag = (workspaceId: string) => hash53(workspaceId).slice(0, 6)

export function storeId(kind: IdKind, workspaceId: string, bpId: string): string {
  if (kind === 'role') return `role_ai_${bpId}`
  return `${PREFIX[kind]}_${workspaceTag(workspaceId)}_${bpId}`
}

export function projectIdFor(tenantId: string, workspaceId: string): string {
  return `prj_${hash53(`${tenantId}:${workspaceId}`)}`
}

/** Display-name slug for a field's API name (used in formulas typed by humans). */
export function slugName(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  )
}
