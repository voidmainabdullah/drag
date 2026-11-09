import { create } from 'zustand'
import type { ID, Workspace } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { useSettingsStore } from './settingsStore'

interface WorkspaceState {
  workspaces: Workspace[]
  currentId: ID | null
  ready: boolean
  setAll: (w: Workspace[], current: ID | null) => void
  setReady: (v: boolean) => void
  add: (w: Omit<Workspace, 'id' | 'createdAt' | 'updatedAt'>) => Workspace
  update: (id: ID, patch: Partial<Workspace>) => void
  remove: (id: ID) => void
  setCurrent: (id: ID) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  currentId: null,
  ready: false,
  setAll: (workspaces, current) => set({ workspaces, currentId: current && workspaces.some((w) => w.id === current) ? current : (workspaces[0]?.id ?? null) }),
  setReady: (ready) => set({ ready }),
  add: (w) => {
    const ws: Workspace = { ...w, id: uid('ws'), createdAt: nowIso(), updatedAt: nowIso() }
    set((s) => ({ workspaces: [...s.workspaces, ws] }))
    return ws
  },
  update: (id, patch) => set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: nowIso() } : w)) })),
  remove: (id) => {
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id)
      return { workspaces, currentId: s.currentId === id ? (workspaces[0]?.id ?? null) : s.currentId }
    })
    useSettingsStore.getState().setCurrentWorkspace(get().currentId ?? undefined)
  },
  setCurrent: (id) => {
    set({ currentId: id })
    useSettingsStore.getState().setCurrentWorkspace(id)
  },
}))
