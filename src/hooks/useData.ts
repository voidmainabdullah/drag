import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Activity, CrmRecord, DataFlowLink, Dashboard, Form, Module, Role, User, View, Workflow, Workspace, PermissionKey, Field, FieldAccess } from '#/types'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useUserStore } from '#/stores/userStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useActivityStore } from '#/stores/activityStore'
import { useFormStore, useViewStore, useDashboardStore, useWorkflowStore, useDataFlowStore } from '#/stores/collections'
import { makeCtx, type Ctx } from '#/utils/records'

const noop = () => () => {}
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false)
}

export function useWorkspace(): Workspace | null {
  const list = useWorkspaceStore((s) => s.workspaces)
  const id = useWorkspaceStore((s) => s.currentId)
  return useMemo(() => list.find((w) => w.id === id) ?? null, [list, id])
}

export function useWsId(): string {
  return useWorkspaceStore((s) => s.currentId) ?? ''
}

export function useModules(opts: { includeArchived?: boolean; includeSystem?: boolean } = {}): Module[] {
  const ws = useWsId()
  const all = useModuleStore((s) => s.modules)
  return useMemo(
    () =>
      all
        .filter((m) => m.workspaceId === ws && (opts.includeArchived || !m.archived) && (opts.includeSystem || !m.system))
        .sort((a, b) => a.order - b.order),
    [all, ws, opts.includeArchived, opts.includeSystem],
  )
}

export function useAllModules(): Module[] {
  const ws = useWsId()
  const all = useModuleStore((s) => s.modules)
  return useMemo(() => all.filter((m) => m.workspaceId === ws).sort((a, b) => a.order - b.order), [all, ws])
}

export function useModule(id: string | undefined): Module | undefined {
  const all = useModuleStore((s) => s.modules)
  return useMemo(() => all.find((m) => m.id === id), [all, id])
}

export function useRecords(moduleId?: string, opts: { deleted?: boolean } = {}): CrmRecord[] {
  const all = useRecordStore((s) => s.records)
  const ws = useWsId()
  return useMemo(
    () => all.filter((r) => r.workspaceId === ws && (!moduleId || r.moduleId === moduleId) && (opts.deleted ? !!r.deletedAt : !r.deletedAt)),
    [all, ws, moduleId, opts.deleted],
  )
}

export function useUsers(): User[] {
  return useUserStore((s) => s.users)
}
export function useRoles(): Role[] {
  return useUserStore((s) => s.roles)
}

export function useCtx(): Ctx {
  const modules = useAllModules()
  const all = useRecordStore((s) => s.records)
  const ws = useWsId()
  const users = useUsers()
  return useMemo(
    () =>
      makeCtx(
        modules,
        all.filter((r) => r.workspaceId === ws),
        users,
      ),
    [modules, all, ws, users],
  )
}

function useWsItems<T extends { workspaceId: string }>(items: T[]): T[] {
  const ws = useWsId()
  return useMemo(() => items.filter((i) => i.workspaceId === ws), [items, ws])
}

export const useForms = (moduleId?: string): Form[] => {
  const items = useWsItems(useFormStore((s) => s.items))
  return useMemo(() => (moduleId ? items.filter((f) => f.moduleId === moduleId) : items), [items, moduleId])
}
export const useViews = (moduleId?: string): View[] => {
  const items = useWsItems(useViewStore((s) => s.items))
  return useMemo(() => (moduleId ? items.filter((f) => f.moduleId === moduleId) : items).sort((a, b) => a.order - b.order), [items, moduleId])
}
export const useDashboards = (): Dashboard[] => useWsItems(useDashboardStore((s) => s.items))
export const useWorkflows = (moduleId?: string): Workflow[] => {
  const items = useWsItems(useWorkflowStore((s) => s.items))
  return useMemo(() => (moduleId ? items.filter((f) => f.moduleId === moduleId) : items), [items, moduleId])
}
/** Data flow links of the current workspace; with a module id only those that start or end there. */
export const useDataFlows = (moduleId?: string): DataFlowLink[] => {
  const items = useWsItems(useDataFlowStore((s) => s.items))
  return useMemo(() => (moduleId ? items.filter((f) => f.sourceModuleId === moduleId || f.targetModuleId === moduleId) : items), [items, moduleId])
}
export function useActivities(): Activity[] {
  const all = useActivityStore((s) => s.activities)
  return useWsItems(all)
}

export function useCurrentUser(): User | undefined {
  const users = useUsers()
  const id = useSettingsStore((s) => s.settings.currentUserId)
  return useMemo(() => users.find((u) => u.id === id) ?? users[0], [users, id])
}

export interface Perms {
  role: Role | undefined
  can: (k: PermissionKey) => boolean
  canModule: (m: Module | undefined, action: 'view' | 'create' | 'edit' | 'delete') => boolean
  fieldAccess: (f: Field) => FieldAccess
}

const MODULE_PERM: Record<'view' | 'create' | 'edit' | 'delete', PermissionKey> = {
  view: 'viewModules',
  create: 'createRecords',
  edit: 'editRecords',
  delete: 'deleteRecords',
}

export function usePerms(): Perms {
  const user = useCurrentUser()
  const roles = useRoles()
  return useMemo(() => {
    const role = roles.find((r) => r.id === user?.roleId)
    const can = (k: PermissionKey) => !!role?.permissions[k]
    return {
      role,
      can,
      canModule: (m, action) => {
        if (!role) return false
        const o = m?.permissions?.[role.id]
        if (o && o[action] !== undefined) return o[action]
        return can(MODULE_PERM[action])
      },
      fieldAccess: (f) => (role ? (f.permissions?.[role.id] ?? 'edit') : 'hidden'),
    }
  }, [user, roles])
}

export function useBriefLoading(key: string, ms = 380): boolean {
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), ms)
    return () => clearTimeout(t)
  }, [key, ms])
  return loading
}

export function usePageTitle(title: string) {
  useEffect(() => {
    if (typeof document !== 'undefined' && title) document.title = title
  }, [title])
}
