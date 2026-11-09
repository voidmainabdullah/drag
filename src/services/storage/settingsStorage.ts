import type { PermissionKey, Role, Settings, User, Workspace } from '#/types'
import { KEYS, readJson, writeJson } from './storageService'

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  viewModules: 'View modules',
  createRecords: 'Create records',
  editRecords: 'Edit records',
  deleteRecords: 'Delete records',
  exportData: 'Export data',
  manageFields: 'Manage fields',
  manageForms: 'Manage forms',
  manageWorkflows: 'Manage workflows',
  manageDashboards: 'Manage dashboards',
  accessSettings: 'Access settings',
}

export const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS) as PermissionKey[]

function perms(keys: PermissionKey[]): Record<PermissionKey, boolean> {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, keys.includes(k)])) as Record<PermissionKey, boolean>
}

export function defaultRoles(): Role[] {
  return [
    { id: 'role_owner', name: 'Owner', builtin: true, description: 'Full access to everything', permissions: perms(PERMISSION_KEYS) },
    { id: 'role_admin', name: 'Administrator', builtin: true, description: 'Manage the workspace and its data', permissions: perms(PERMISSION_KEYS) },
    {
      id: 'role_manager',
      name: 'Manager',
      builtin: true,
      description: 'Manage records, forms and dashboards',
      permissions: perms(['viewModules', 'createRecords', 'editRecords', 'deleteRecords', 'exportData', 'manageForms', 'manageDashboards', 'manageWorkflows']),
    },
    { id: 'role_member', name: 'Member', builtin: true, description: 'Create and edit records', permissions: perms(['viewModules', 'createRecords', 'editRecords']) },
    { id: 'role_viewer', name: 'Viewer', builtin: true, description: 'Read-only access', permissions: perms(['viewModules']) },
  ]
}

export function defaultSettings(): Settings {
  return {
    brand: {
      brandName: 'Xcrm',
      primary: '#7B68EE',
      accent: '#FD71AF',
      theme: 'light',
      density: 'comfortable',
      formRadius: 12,
    },
    nav: {},
    favourites: {},
    recents: {},
    integrations: [],
    autosave: true,
  }
}

export const settingsStorage = {
  loadSettings: (): Settings => {
    const def = defaultSettings()
    const v = readJson<Partial<Settings> | null>(KEYS.settings, null)
    if (!v || typeof v !== 'object') return def
    return { ...def, ...v, brand: { ...def.brand, ...(v.brand ?? {}) } }
  },
  saveSettings: (s: Settings) => writeJson(KEYS.settings, s),
  loadWorkspaces: (): Workspace[] => {
    const v = readJson<unknown>(KEYS.workspaces, [])
    return Array.isArray(v) ? (v as Workspace[]) : []
  },
  saveWorkspaces: (w: Workspace[]) => writeJson(KEYS.workspaces, w),
  loadUsers: (): User[] => {
    const v = readJson<unknown>(KEYS.users, [])
    return Array.isArray(v) ? (v as User[]) : []
  },
  saveUsers: (u: User[]) => writeJson(KEYS.users, u),
  loadRoles: (): Role[] => {
    const v = readJson<unknown>(KEYS.roles, [])
    const roles = Array.isArray(v) ? (v as Role[]) : []
    return roles.length ? roles : defaultRoles()
  },
  saveRoles: (r: Role[]) => writeJson(KEYS.roles, r),
}
