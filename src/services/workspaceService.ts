import type { ID, Workspace } from '#/types'
import { coreTemplate } from '#/templates'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useActivityStore, logActivity } from '#/stores/activityStore'
import { useFormStore, useViewStore, useDashboardStore, useWorkflowStore, useRunStore, useDataFlowStore } from '#/stores/collections'
import { installTemplate } from './installer'
import { NAV_REV, buildDefaultNav } from './navService'
import { ensureTasksModule } from './moduleService'

export function bootstrapWorkspace(ws: ID, withDefaults = true) {
  useSettingsStore.getState().setNav(ws, buildDefaultNav())
  if (withDefaults) installTemplate(coreTemplate, { workspaceId: ws, navParentLabel: 'Business Management', silent: true })
  ensureTasksModule(ws)
}

/** A completely blank workspace: no default modules, no default sidebar items, no system modules. */
export function bootstrapBlankWorkspace(ws: ID) {
  useSettingsStore.getState().setNav(ws, [])
}

export function createWorkspace(input: { name: string; description?: string; icon?: string; color?: string; withDefaults?: boolean; empty?: boolean }): Workspace {
  const ws = useWorkspaceStore.getState().add({ name: input.name.trim() || 'Untitled workspace', description: input.description, icon: input.icon ?? 'Briefcase', color: input.color ?? '#7B68EE', blank: input.empty ? true : undefined, navRev: NAV_REV })
  if (input.empty) bootstrapBlankWorkspace(ws.id)
  else bootstrapWorkspace(ws.id, input.withDefaults !== false)
  useWorkspaceStore.getState().setCurrent(ws.id)
  logActivity({ workspaceId: ws.id, action: 'workspace_created', entity: 'workspace', description: `Created workspace "${ws.name}"` })
  return ws
}

export function renameWorkspace(id: ID, patch: Partial<Pick<Workspace, 'name' | 'description' | 'icon' | 'color'>>) {
  useWorkspaceStore.getState().update(id, patch)
}

export function deleteWorkspace(id: ID): boolean {
  const st = useWorkspaceStore.getState()
  if (st.workspaces.length <= 1) return false
  const recIds = useRecordStore.getState().records.filter((r) => r.workspaceId === id).map((r) => r.id)
  useRecordStore.getState().purge(recIds)
  useRecordStore.getState().removeByWorkspace(id)
  useModuleStore.getState().removeByWorkspace(id)
  useFormStore.getState().removeByWorkspace(id)
  useViewStore.getState().removeByWorkspace(id)
  useDashboardStore.getState().removeByWorkspace(id)
  useWorkflowStore.getState().removeByWorkspace(id)
  useDataFlowStore.getState().removeByWorkspace(id)
  useRunStore.getState().removeByWorkspace(id)
  useActivityStore.getState().clearWorkspace(id)
  useSettingsStore.getState().removeWorkspaceData(id)
  st.remove(id)
  return true
}
