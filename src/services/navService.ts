import type { ID, NavItem } from '#/types'
import { useSettingsStore } from '#/stores/settingsStore'
import { uid } from '#/utils/id'

type R = { label: string; icon: string; path: string; key: string }
const route = (key: string, label: string, icon: string, path: string): R => ({ key, label, icon, path })

export const DEFAULT_SECTIONS: { key: string; label: string; icon: string; items: R[] }[] = [
  {
    key: 'workspace',
    label: 'Workspace',
    icon: 'LayoutGrid',
    items: [
      route('overview', 'Overview', 'LayoutDashboard', '/'),
      route('my-workspace', 'My Workspace', 'Briefcase', '/my-workspace'),
      route('recent', 'Recent Items', 'History', '/recent'),
      route('favourites', 'Favourites', 'Star', '/favourites'),
      route('tasks', 'My Tasks', 'CheckSquare', '/tasks'),
      route('calendar', 'Calendar', 'Calendar', '/calendar'),
    ],
  },
  {
    key: 'builder',
    label: 'CRM Builder',
    icon: 'Blocks',
    items: [
      route('genius', 'Genius AI', 'Sparkles', '/genius'),
      route('modules', 'All Modules', 'Boxes', '/modules'),
      route('module-builder', 'Module Builder', 'Hammer', '/module-builder'),
      route('forms', 'Form Builder', 'FormInput', '/forms'),
      route('fields', 'Field Manager', 'Rows3', '/fields'),
      route('views', 'View Builder', 'Table2', '/views'),
      route('workflows', 'Workflow Builder', 'Workflow', '/workflows'),
      route('data-flow', 'Data Flow', 'Network', '/data-flow'),
      route('templates', 'Template Library', 'LayoutTemplate', '/templates'),
    ],
  },
  { key: 'business', label: 'Business Management', icon: 'Building2', items: [] },
  {
    key: 'analytics',
    label: 'Analytics',
    icon: 'BarChart3',
    items: [
      route('dashboards', 'Dashboards', 'PieChart', '/dashboards'),
      route('reports', 'Reports', 'FileBarChart', '/reports'),
      route('analytics', 'Data Analytics', 'LineChart', '/analytics'),
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: 'ShieldCheck',
    items: [
      route('team', 'Team Members', 'Users', '/team'),
      route('roles', 'Roles & Permissions', 'Lock', '/roles'),
      route('customisation', 'Customisation', 'Paintbrush', '/customisation'),
      route('integrations', 'Integrations', 'Plug', '/integrations'),
      route('import-export', 'Import & Export', 'ArrowUpDown', '/import-export'),
      route('settings', 'Settings', 'Settings', '/settings'),
    ],
  },
]

/** Bump when a new default sidebar page should be offered to workspaces that already exist. */
export const NAV_REV = 3

/** Pages shown in the compact launcher of a blank workspace (its sidebar has no default items). */
export const BLANK_TOOL_KEYS = ['overview', 'genius', 'modules', 'templates', 'data-flow', 'settings']

/**
 * Adds default pages introduced after a workspace was created (once per revision; never re-adds a page the user removed
 * after upgrading, because the workspace's navRev is bumped afterwards).
 */
export function upgradeDefaultNav(ws: ID, fromRev = 1) {
  const st = useSettingsStore.getState()
  const nav = st.getNav(ws)
  const has = (key: string, path: string) => nav.some((i) => i.key === key || i.path === path)
  const wf = nav.find((i) => i.key === 'workflows')
  const cat = nav.find((i) => i.type === 'category' && i.key === 'builder') ?? (wf?.parentId ? nav.find((i) => i.id === wf.parentId) : undefined)
  if (!cat) return
  if (fromRev < 2 && !has('data-flow', '/data-flow')) st.addNavItem(ws, { key: 'data-flow', label: 'Data Flow', icon: 'Network', type: 'route', path: '/data-flow', parentId: cat.id, order: wf ? wf.order + 0.5 : undefined })
  if (fromRev < 3 && !has('genius', '/genius')) st.addNavItem(ws, { key: 'genius', label: 'Genius AI', icon: 'Sparkles', type: 'route', path: '/genius', parentId: cat.id, order: -1 })
}

export function buildDefaultNav(): NavItem[] {
  const out: NavItem[] = []
  DEFAULT_SECTIONS.forEach((sec, si) => {
    const cat: NavItem = { id: uid('nav'), key: sec.key, label: sec.label, icon: sec.icon, type: 'category', parentId: null, order: si }
    out.push(cat)
    sec.items.forEach((it, i) => {
      out.push({ id: uid('nav'), key: it.key, label: it.label, icon: it.icon, type: 'route', path: it.path, parentId: cat.id, order: i })
    })
  })
  return out
}

/** Finds a top-level category by label (case-insensitive) or creates it. */
export function ensureCategory(ws: ID, label: string, icon = 'Folder'): NavItem {
  const st = useSettingsStore.getState()
  const found = st.getNav(ws).find((i) => i.type === 'category' && i.label.toLowerCase() === label.toLowerCase())
  if (found) return found
  return st.addNavItem(ws, { label, icon, type: 'category', parentId: null })
}

export function addModuleNav(ws: ID, moduleId: ID, label: string, icon: string, parentId: ID | null) {
  const st = useSettingsStore.getState()
  if (st.getNav(ws).some((i) => i.moduleId === moduleId)) return
  st.addNavItem(ws, { label, icon, type: 'module', moduleId, parentId })
}
