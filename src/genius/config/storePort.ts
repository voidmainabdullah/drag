import type { Dashboard, Form, ID, Module, NavItem, Role, View, Workflow } from '#/types'
import { useDashboardStore, useFormStore, useViewStore, useWorkflowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUserStore } from '#/stores/userStore'
import { ensureCategory, addModuleNav } from '#/services/navService'
import type { CrmRecord } from '#/types'
import type { NavAdd } from '../compiler/apply'
import { isAiRole, type ConfigModel } from './model'

/**
 * The adapter between the pure configuration model and the REAL zustand stores that Modules already uses.
 * The AI builder writes through here and nowhere else, so manual edits and AI edits share one canonical config.
 */

export function readConfig(workspaceId: ID): ConfigModel {
  return {
    workspaceId,
    modules: useModuleStore.getState().modules.filter((m) => m.workspaceId === workspaceId),
    forms: useFormStore.getState().items.filter((m) => m.workspaceId === workspaceId),
    views: useViewStore.getState().items.filter((m) => m.workspaceId === workspaceId),
    workflows: useWorkflowStore.getState().items.filter((m) => m.workspaceId === workspaceId),
    dashboards: useDashboardStore.getState().items.filter((m) => m.workspaceId === workspaceId),
    roles: useUserStore.getState().roles,
  }
}

export const readRecords = (workspaceId: ID): CrmRecord[] => useRecordStore.getState().records.filter((r) => r.workspaceId === workspaceId && !r.deletedAt)
export const recordsOfModule = (moduleId: ID): CrmRecord[] => useRecordStore.getState().records.filter((r) => r.moduleId === moduleId && !r.deletedAt)

export interface StoreSnapshot {
  workspaceId: ID
  modules: Module[]
  forms: Form[]
  views: View[]
  workflows: Workflow[]
  dashboards: Dashboard[]
  roles: Role[]
  nav: NavItem[]
}

/** Store arrays are replaced, never mutated, so keeping the references IS a consistent snapshot. */
export function snapshotStores(workspaceId: ID): StoreSnapshot {
  return {
    workspaceId,
    modules: useModuleStore.getState().modules,
    forms: useFormStore.getState().items,
    views: useViewStore.getState().items,
    workflows: useWorkflowStore.getState().items,
    dashboards: useDashboardStore.getState().items,
    roles: useUserStore.getState().roles,
    nav: useSettingsStore.getState().getNav(workspaceId),
  }
}

export function restoreStores(s: StoreSnapshot) {
  useModuleStore.getState().setAll(s.modules)
  useFormStore.getState().setAll(s.forms)
  useViewStore.getState().setAll(s.views)
  useWorkflowStore.getState().setAll(s.workflows)
  useDashboardStore.getState().setAll(s.dashboards)
  const us = useUserStore.getState()
  us.setAll(us.users, s.roles)
  useSettingsStore.getState().setNav(s.workspaceId, s.nav)
}

function merge<T extends { id: string; workspaceId: string }>(all: T[], ws: string, next: T[]): T[] {
  const nextById = new Map(next.map((x) => [x.id, x]))
  const used = new Set<string>()
  const out: T[] = []
  for (const x of all) {
    if (x.workspaceId !== ws) out.push(x)
    else if (nextById.has(x.id)) {
      out.push(nextById.get(x.id)!)
      used.add(x.id)
    }
  }
  for (const x of next) if (!used.has(x.id)) out.push(x)
  return out
}

/** Replace a workspace's configuration. Other workspaces, records and non-AI roles are never touched. */
export function writeConfig(cfg: ConfigModel) {
  const ws = cfg.workspaceId
  useModuleStore.getState().setAll(merge(useModuleStore.getState().modules, ws, cfg.modules))
  useFormStore.getState().setAll(merge(useFormStore.getState().items, ws, cfg.forms))
  useViewStore.getState().setAll(merge(useViewStore.getState().items, ws, cfg.views))
  useWorkflowStore.getState().setAll(merge(useWorkflowStore.getState().items, ws, cfg.workflows))
  useDashboardStore.getState().setAll(merge(useDashboardStore.getState().items, ws, cfg.dashboards))
  const us = useUserStore.getState()
  us.setAll(us.users, [...us.roles.filter((r) => !isAiRole(r)), ...cfg.roles.filter(isAiRole)])
}

/** Put new modules in the sidebar next to manual ones; returns what changed so undo can reverse it. */
export function placeNav(workspaceId: ID, adds: NavAdd[], removes: string[], modules: Module[]): { added: string[]; removed: NavItem[] } {
  const st = useSettingsStore.getState()
  const before = st.getNav(workspaceId)
  const removed: NavItem[] = []
  for (const id of removes) {
    const items = useSettingsStore.getState().getNav(workspaceId).filter((i) => i.moduleId === id)
    removed.push(...items)
    if (items.length) useSettingsStore.getState().removeModuleNav(workspaceId, id)
  }
  for (const a of adds) {
    if (!a.show) continue
    const m = modules.find((x) => x.id === a.moduleId)
    if (!m) continue
    const parent = ensureCategory(workspaceId, a.group ?? 'AI-built', 'Sparkles')
    addModuleNav(workspaceId, m.id, m.name, m.icon, parent.id)
  }
  const afterIds = new Set(useSettingsStore.getState().getNav(workspaceId).map((i) => i.id))
  const beforeIds = new Set(before.map((i) => i.id))
  return { added: [...afterIds].filter((i) => !beforeIds.has(i)), removed }
}
