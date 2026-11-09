import { defaultRoles } from '#/services/storage/settingsStorage'
import { useActivityStore } from '#/stores/activityStore'
import { useDashboardStore, useFormStore, useRunStore, useViewStore, useWorkflowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUserStore } from '#/stores/userStore'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { projectIdFor } from '#/genius/compiler/ids'
import { emptyConfig } from '#/genius/config/model'
import { readConfig } from '#/genius/config/storePort'
import { emptyGenius } from '#/genius/state/types'
import { useGeniusStore } from '#/genius/state/geniusStore'
import { setTenantId } from '#/genius/tenant'
import type { ValidateContext } from '#/genius/validation'
import type { Role } from '#/types'

export const WS = 'ws_test'
export const TENANT = 'user_tenant_a'

export const roleById = (id: string): Role => defaultRoles().find((r) => r.id === id)!

/** Reset every real store to a clean, signed-in single-workspace state (no persistence layer involved). */
export function resetWorld(opts: { tenant?: string; ws?: string; roleId?: string } = {}) {
  const ws = opts.ws ?? WS
  setTenantId(opts.tenant ?? TENANT)
  useModuleStore.getState().setAll([])
  useRecordStore.getState().setAll([])
  useFormStore.getState().setAll([])
  useViewStore.getState().setAll([])
  useDashboardStore.getState().setAll([])
  useWorkflowStore.getState().setAll([])
  useRunStore.getState().setAll([])
  useActivityStore.getState().setAll([])
  useUserStore.getState().setAll([{ id: 'usr_owner', name: 'Owner', email: 'owner@example.com', roleId: opts.roleId ?? 'role_owner', color: '#000', createdAt: '2026-01-01T00:00:00.000Z' }], defaultRoles())
  useSettingsStore.getState().setCurrentUser('usr_owner')
  useSettingsStore.getState().setNav(ws, [])
  useWorkspaceStore.getState().setAll([{ id: ws, name: 'Test', icon: 'Briefcase', color: '#000', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as never], ws)
  useGeniusStore.getState().setAll(emptyGenius())
  return ws
}

export function ctxFor(cfg = emptyConfig(WS, defaultRoles()), over: Partial<ValidateContext> = {}): ValidateContext {
  return { config: cfg, tenantId: TENANT, workspaceId: WS, projectId: projectIdFor(TENANT, WS), actor: { userId: 'usr_owner', role: roleById('role_owner') }, now: '2026-02-01T09:00:00.000Z', skipSandbox: false, ...over }
}

export const liveConfig = () => readConfig(WS)

/** Build the school CRM from the (mocked) model output through the real validate -> accept path. */
export async function buildSchoolWorld(opts: { tenant?: string; roleId?: string } = {}) {
  const { schoolBlueprint } = await import('./fixtures/school')
  const { submitProposal, acceptProposal } = await import('#/genius/service/builder')
  resetWorld(opts)
  const { proposal } = submitProposal(WS, { kind: 'build', raw: schoolBlueprint(projectIdFor(opts.tenant ?? TENANT, WS), 'rev_none'), request: 'Create a CRM for my school academy', intent: 'new_build' })
  const res = acceptProposal(proposal.id)
  if (!res.ok) throw new Error(`school build failed: ${res.error}`)
  return readConfig(WS)
}
