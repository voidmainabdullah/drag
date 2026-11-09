import { create } from 'zustand'
import type { Activity, ID } from '#/types'
import { uid, nowIso } from '#/utils/id'
import { useSettingsStore } from './settingsStore'

const MAX = 3000

interface ActivityState {
  activities: Activity[]
  setAll: (a: Activity[]) => void
  log: (a: Omit<Activity, 'id' | 'timestamp' | 'userId'> & { userId?: ID }) => void
  clearWorkspace: (ws: ID) => void
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  setAll: (activities) => set({ activities }),
  log: (a) =>
    set((s) => ({
      activities: [
        { id: uid('act'), timestamp: nowIso(), userId: a.userId ?? useSettingsStore.getState().settings.currentUserId, ...a },
        ...s.activities,
      ].slice(0, MAX),
    })),
  clearWorkspace: (ws) => set((s) => ({ activities: s.activities.filter((a) => a.workspaceId !== ws) })),
}))

export const logActivity = (a: Omit<Activity, 'id' | 'timestamp' | 'userId'> & { userId?: ID }) => useActivityStore.getState().log(a)
