import { create } from 'zustand'
import type { BrandSettings, ID, IntegrationConfig, NavItem, Settings } from '#/types'
import { defaultSettings } from '#/services/storage/settingsStorage'
import { uid } from '#/utils/id'

interface SettingsState {
  settings: Settings
  setAll: (s: Settings) => void
  setBrand: (b: Partial<BrandSettings>) => void
  resetBrand: () => void
  setCurrentUser: (id: ID | undefined) => void
  setCurrentWorkspace: (id: ID | undefined) => void
  // navigation
  getNav: (ws: ID) => NavItem[]
  setNav: (ws: ID, items: NavItem[]) => void
  addNavItem: (ws: ID, item: Omit<NavItem, 'id' | 'order'> & { id?: ID; order?: number }) => NavItem
  updateNavItem: (ws: ID, id: ID, patch: Partial<NavItem>) => void
  removeNavItem: (ws: ID, id: ID) => void
  removeModuleNav: (ws: ID, moduleId: ID) => void
  moveNavItem: (ws: ID, id: ID, parentId: ID | null, index?: number) => void
  reorderNav: (ws: ID, parentId: ID | null, orderedIds: ID[]) => void
  // favourites & recents
  toggleFavourite: (ws: ID, fav: { moduleId?: ID; recordId?: ID; label: string }) => void
  addRecent: (ws: ID, r: { moduleId: ID; recordId?: ID; label: string }) => void
  clearRecents: (ws: ID) => void
  removeWorkspaceData: (ws: ID) => void
  // integrations
  saveIntegration: (c: IntegrationConfig) => void
  removeIntegration: (id: ID) => void
}

const sameFav = (a: { moduleId?: ID; recordId?: ID }, b: { moduleId?: ID; recordId?: ID }) =>
  a.moduleId === b.moduleId && a.recordId === b.recordId

function descendants(items: NavItem[], id: ID): Set<ID> {
  const out = new Set<ID>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const i of items) {
      if (i.parentId && out.has(i.parentId) && !out.has(i.id)) {
        out.add(i.id)
        changed = true
      }
    }
  }
  return out
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  setAll: (settings) => set({ settings }),
  setBrand: (b) => set((s) => ({ settings: { ...s.settings, brand: { ...s.settings.brand, ...b } } })),
  resetBrand: () => set((s) => ({ settings: { ...s.settings, brand: defaultSettings().brand } })),
  setCurrentUser: (id) => set((s) => ({ settings: { ...s.settings, currentUserId: id } })),
  setCurrentWorkspace: (id) => set((s) => ({ settings: { ...s.settings, currentWorkspaceId: id } })),

  getNav: (ws) => get().settings.nav[ws] ?? [],
  setNav: (ws, items) => set((s) => ({ settings: { ...s.settings, nav: { ...s.settings.nav, [ws]: items } } })),
  addNavItem: (ws, item) => {
    const items = get().getNav(ws)
    const siblings = items.filter((i) => (i.parentId ?? null) === (item.parentId ?? null))
    const full: NavItem = {
      ...item,
      id: item.id ?? uid('nav'),
      order: item.order ?? (siblings.length ? Math.max(...siblings.map((s) => s.order)) + 1 : 0),
    }
    get().setNav(ws, [...items, full])
    return full
  },
  updateNavItem: (ws, id, patch) => get().setNav(ws, get().getNav(ws).map((i) => (i.id === id ? { ...i, ...patch } : i))),
  removeNavItem: (ws, id) => {
    const items = get().getNav(ws)
    const gone = descendants(items, id)
    get().setNav(ws, items.filter((i) => !gone.has(i.id)))
  },
  removeModuleNav: (ws, moduleId) => {
    const items = get().getNav(ws)
    const target = items.filter((i) => i.moduleId === moduleId).map((i) => i.id)
    // re-parent children of removed items to the removed item's parent
    let next = items
    for (const id of target) {
      const it = next.find((i) => i.id === id)
      next = next.filter((i) => i.id !== id).map((i) => (i.parentId === id ? { ...i, parentId: it?.parentId ?? null } : i))
    }
    get().setNav(ws, next)
  },
  moveNavItem: (ws, id, parentId, index) => {
    const items = get().getNav(ws)
    if (parentId && descendants(items, id).has(parentId)) return
    const siblings = items
      .filter((i) => (i.parentId ?? null) === parentId && i.id !== id)
      .sort((a, b) => a.order - b.order)
    const moving = items.find((i) => i.id === id)
    if (!moving) return
    const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length))
    siblings.splice(at, 0, { ...moving, parentId })
    const orderMap = new Map(siblings.map((s, i) => [s.id, i]))
    get().setNav(
      ws,
      items.map((i) => {
        if (i.id === id) return { ...i, parentId, order: orderMap.get(id) ?? 0 }
        if ((i.parentId ?? null) === parentId) return { ...i, order: orderMap.get(i.id) ?? i.order }
        return i
      }),
    )
  },
  reorderNav: (ws, parentId, orderedIds) => {
    const idx = new Map(orderedIds.map((id, i) => [id, i]))
    get().setNav(
      ws,
      get()
        .getNav(ws)
        .map((i) => ((i.parentId ?? null) === parentId && idx.has(i.id) ? { ...i, order: idx.get(i.id)! } : i)),
    )
  },

  toggleFavourite: (ws, fav) =>
    set((s) => {
      const list = s.settings.favourites[ws] ?? []
      const exists = list.some((f) => sameFav(f, fav))
      const next = exists ? list.filter((f) => !sameFav(f, fav)) : [...list, fav]
      return { settings: { ...s.settings, favourites: { ...s.settings.favourites, [ws]: next } } }
    }),
  addRecent: (ws, r) =>
    set((s) => {
      const list = s.settings.recents[ws] ?? []
      const filtered = list.filter((x) => !sameFav(x, r))
      const next = [{ ...r, at: new Date().toISOString() }, ...filtered].slice(0, 30)
      return { settings: { ...s.settings, recents: { ...s.settings.recents, [ws]: next } } }
    }),
  clearRecents: (ws) => set((s) => ({ settings: { ...s.settings, recents: { ...s.settings.recents, [ws]: [] } } })),
  removeWorkspaceData: (ws) =>
    set((s) => {
      const { [ws]: _n, ...nav } = s.settings.nav
      const { [ws]: _f, ...favourites } = s.settings.favourites
      const { [ws]: _r, ...recents } = s.settings.recents
      return { settings: { ...s.settings, nav, favourites, recents } }
    }),

  saveIntegration: (c) =>
    set((s) => {
      const exists = s.settings.integrations.some((i) => i.id === c.id)
      return {
        settings: {
          ...s.settings,
          integrations: exists ? s.settings.integrations.map((i) => (i.id === c.id ? c : i)) : [...s.settings.integrations, c],
        },
      }
    }),
  removeIntegration: (id) => set((s) => ({ settings: { ...s.settings, integrations: s.settings.integrations.filter((i) => i.id !== id) } })),
}))
