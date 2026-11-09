import { create } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import { runMigrations, storageAvailable, isOwnStorageKey, KEYS } from '#/services/storage/storageService'
import { moduleStorage } from '#/services/storage/moduleStorage'
import { recordStorage } from '#/services/storage/recordStorage'
import { templateStorage } from '#/services/storage/templateStorage'
import { settingsStorage, defaultRoles } from '#/services/storage/settingsStorage'
import { bootstrapWorkspace } from '#/services/workspaceService'
import { NAV_REV, upgradeDefaultNav } from '#/services/navService'
import { startWorkflowEngine } from '#/services/workflowEngine'
import { nowIso, uid } from '#/utils/id'
import { useSettingsStore } from './settingsStore'
import { useUserStore } from './userStore'
import { useWorkspaceStore } from './workspaceStore'
import { useModuleStore } from './moduleStore'
import { useRecordStore } from './recordStore'
import { useActivityStore } from './activityStore'
import { geniusStorage } from '#/services/storage/geniusStorage'
import { useGeniusStore } from '#/genius/state/geniusStore'
import { useFormStore, useViewStore, useDashboardStore, useWorkflowStore, useRunStore, useTemplateStore, useDataFlowStore } from './collections'

export const useSaveStatus = create<{ savedAt: number | null; pending: boolean; failed: boolean }>(() => ({ savedAt: null, pending: false, failed: false }))

let hydrated = false
let suppress = false
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const savers = new Map<string, () => boolean>()

function schedule(name: string, fn: () => boolean, delay = 250) {
  if (!hydrated || suppress) return
  savers.set(name, fn)
  clearTimeout(timers.get(name))
  useSaveStatus.setState({ pending: true })
  timers.set(
    name,
    setTimeout(() => flush(name), delay),
  )
}

function flush(name: string) {
  const fn = savers.get(name)
  if (!fn) return
  clearTimeout(timers.get(name))
  timers.delete(name)
  savers.delete(name)
  const ok = fn()
  useSaveStatus.setState({ pending: timers.size > 0, failed: !ok, savedAt: ok ? Date.now() : useSaveStatus.getState().savedAt })
}

export function flushAll() {
  ;[...savers.keys()].forEach(flush)
}

function watch<S, T>(store: UseBoundStore<StoreApi<S>>, select: (s: S) => T, save: (v: T) => boolean, name: string) {
  store.subscribe((s, prev) => {
    if (select(s) !== select(prev)) schedule(name, () => save(select(store.getState())))
  })
}

let autosaveReady = false
function setupAutosave() {
  if (autosaveReady) return
  autosaveReady = true
  watch(useWorkspaceStore, (s) => s.workspaces, settingsStorage.saveWorkspaces, 'workspaces')
  watch(useModuleStore, (s) => s.modules, moduleStorage.saveModules, 'modules')
  watch(useRecordStore, (s) => s.records, recordStorage.saveRecords, 'records')
  watch(useFormStore, (s) => s.items, moduleStorage.saveForms, 'forms')
  watch(useViewStore, (s) => s.items, moduleStorage.saveViews, 'views')
  watch(useDashboardStore, (s) => s.items, moduleStorage.saveDashboards, 'dashboards')
  watch(useWorkflowStore, (s) => s.items, moduleStorage.saveWorkflows, 'workflows')
  watch(useDataFlowStore, (s) => s.items, moduleStorage.saveDataFlows, 'dataflows')
  watch(useRunStore, (s) => s.runs, moduleStorage.saveRuns, 'runs')
  watch(useTemplateStore, (s) => s.templates, templateStorage.save, 'templates')
  watch(useActivityStore, (s) => s.activities, recordStorage.saveActivities, 'activities')
  watch(useSettingsStore, (s) => s.settings, settingsStorage.saveSettings, 'settings')
  useGeniusStore.subscribe((s, p) => {
    if (s.versions !== p.versions || s.proposals !== p.proposals || s.audit !== p.audit || s.memory !== p.memory) schedule('genius', () => geniusStorage.save(useGeniusStore.getState()))
  })
  useUserStore.subscribe((s, p) => {
    if (s.users !== p.users) schedule('users', () => settingsStorage.saveUsers(useUserStore.getState().users))
    if (s.roles !== p.roles) schedule('roles', () => settingsStorage.saveRoles(useUserStore.getState().roles))
  })
  window.addEventListener('beforeunload', flushAll)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
  })
  // keep several tabs of the same browser in sync
  window.addEventListener('storage', (e) => {
    if (!e.key || !isOwnStorageKey(e.key)) return
    loadFromStorage()
  })
}

function loadFromStorage() {
  const prev = suppress
  suppress = true
  try {
    const settings = settingsStorage.loadSettings()
    useSettingsStore.getState().setAll(settings)
    const roles = settingsStorage.loadRoles()
    useUserStore.getState().setAll(settingsStorage.loadUsers(), roles)
    useModuleStore.getState().setAll(moduleStorage.loadModules())
    useRecordStore.getState().setAll(recordStorage.loadRecords())
    useFormStore.getState().setAll(moduleStorage.loadForms())
    useViewStore.getState().setAll(moduleStorage.loadViews())
    useDashboardStore.getState().setAll(moduleStorage.loadDashboards())
    useWorkflowStore.getState().setAll(moduleStorage.loadWorkflows())
    useDataFlowStore.getState().setAll(moduleStorage.loadDataFlows())
    useRunStore.getState().setAll(moduleStorage.loadRuns())
    useTemplateStore.getState().setAll(templateStorage.load())
    useActivityStore.getState().setAll(recordStorage.loadActivities())
    useGeniusStore.getState().setAll(geniusStorage.load())
    useWorkspaceStore.getState().setAll(settingsStorage.loadWorkspaces(), settings.currentWorkspaceId ?? null)
  } finally {
    suppress = prev
  }
}

/** Reload every store from localStorage (used after restoring a backup). */
export function reloadFromStorage() {
  loadFromStorage()
  ensureDefaults()
}

function ensureDefaults() {
  const settings = useSettingsStore.getState()
  // users + roles
  const us = useUserStore.getState()
  let users = us.users
  if (!users.length) {
    users = [{ id: uid('usr'), name: 'You', email: 'owner@local', roleId: 'role_owner', color: '#7B68EE', createdAt: nowIso() }]
    us.setAll(users, us.roles.length ? us.roles : defaultRoles())
  }
  if (!users.some((u) => u.id === settings.settings.currentUserId)) settings.setCurrentUser(users[0].id)
  // workspace
  const wsStore = useWorkspaceStore.getState()
  if (!wsStore.workspaces.length) {
    const ws = wsStore.add({ name: 'My Workspace', description: 'Your first workspace', icon: 'Briefcase', color: '#7B68EE' })
    bootstrapWorkspace(ws.id, true)
    wsStore.update(ws.id, { navRev: NAV_REV })
    wsStore.setCurrent(ws.id)
  } else {
    for (const w of wsStore.workspaces) {
      // blank workspaces intentionally have no default sidebar; everyone else always gets one
      if (w.blank) continue
      if (!settings.getNav(w.id).length) bootstrapWorkspace(w.id, false)
      else if ((w.navRev ?? 1) < NAV_REV) upgradeDefaultNav(w.id, w.navRev ?? 1)
      if ((w.navRev ?? 1) < NAV_REV) wsStore.update(w.id, { navRev: NAV_REV })
    }
  }
  useSettingsStore.getState().setCurrentWorkspace(useWorkspaceStore.getState().currentId ?? undefined)
}

let initialised = false

export function initApp() {
  if (initialised || typeof window === 'undefined') return
  initialised = true
  if (!storageAvailable()) {
    // runs in memory only; storageService shows the toast on first write failure
    useSaveStatus.setState({ failed: true })
  }
  runMigrations()
  loadFromStorage()
  ensureDefaults()
  setupAutosave()
  hydrated = true
  // persist anything the defaults just created
  const all: [string, () => boolean][] = [
    ['workspaces', () => settingsStorage.saveWorkspaces(useWorkspaceStore.getState().workspaces)],
    ['modules', () => moduleStorage.saveModules(useModuleStore.getState().modules)],
    ['forms', () => moduleStorage.saveForms(useFormStore.getState().items)],
    ['views', () => moduleStorage.saveViews(useViewStore.getState().items)],
    ['dashboards', () => moduleStorage.saveDashboards(useDashboardStore.getState().items)],
    ['workflows', () => moduleStorage.saveWorkflows(useWorkflowStore.getState().items)],
    ['dataflows', () => moduleStorage.saveDataFlows(useDataFlowStore.getState().items)],
    ['users', () => settingsStorage.saveUsers(useUserStore.getState().users)],
    ['roles', () => settingsStorage.saveRoles(useUserStore.getState().roles)],
    ['settings', () => settingsStorage.saveSettings(useSettingsStore.getState().settings)],
    ['activities', () => recordStorage.saveActivities(useActivityStore.getState().activities)],
    ['genius', () => geniusStorage.save(useGeniusStore.getState())],
  ]
  all.forEach(([n, fn]) => savers.set(n, fn))
  flushAll()
  startWorkflowEngine()
  useWorkspaceStore.getState().setReady(true)
}

export { KEYS }
