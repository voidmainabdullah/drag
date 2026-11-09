import { create } from 'zustand'
import type { DataFlowLink, Dashboard, Form, ID, Template, View, Workflow, WorkflowRun } from '#/types'
import { nowIso } from '#/utils/id'

interface Coll<T extends { id: ID; workspaceId: ID }> {
  items: T[]
  setAll: (i: T[]) => void
  add: (i: T) => void
  addMany: (i: T[]) => void
  update: (id: ID, patch: Partial<T>) => void
  remove: (id: ID) => void
  removeWhere: (pred: (i: T) => boolean) => void
  removeByWorkspace: (ws: ID) => void
}

function makeColl<T extends { id: ID; workspaceId: ID; updatedAt: string }>() {
  return create<Coll<T>>((set) => ({
    items: [],
    setAll: (items) => set({ items }),
    add: (i) => set((s) => ({ items: [...s.items, i] })),
    addMany: (i) => set((s) => ({ items: [...s.items, ...i] })),
    update: (id, patch) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: nowIso() } : x)) })),
    remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
    removeWhere: (pred) => set((s) => ({ items: s.items.filter((x) => !pred(x)) })),
    removeByWorkspace: (ws) => set((s) => ({ items: s.items.filter((x) => x.workspaceId !== ws) })),
  }))
}

export const useFormStore = makeColl<Form>()
export const useViewStore = makeColl<View>()
export const useDashboardStore = makeColl<Dashboard>()
export const useWorkflowStore = makeColl<Workflow>()
export const useDataFlowStore = makeColl<DataFlowLink>()

interface RunState {
  runs: WorkflowRun[]
  setAll: (r: WorkflowRun[]) => void
  add: (r: WorkflowRun) => void
  clear: (ws: ID, workflowId?: ID) => void
  removeByWorkspace: (ws: ID) => void
}

export const useRunStore = create<RunState>((set) => ({
  runs: [],
  setAll: (runs) => set({ runs }),
  add: (r) => set((s) => ({ runs: [r, ...s.runs].slice(0, 1500) })),
  clear: (ws, workflowId) =>
    set((s) => ({ runs: s.runs.filter((r) => r.frozen || !(r.workspaceId === ws && (!workflowId || r.workflowId === workflowId))) })),
  removeByWorkspace: (ws) => set((s) => ({ runs: s.runs.filter((r) => r.workspaceId !== ws) })),
}))

interface TemplateState {
  templates: Template[]
  setAll: (t: Template[]) => void
  add: (t: Template) => void
  update: (id: ID, patch: Partial<Template>) => void
  remove: (id: ID) => void
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templates: [],
  setAll: (templates) => set({ templates }),
  add: (t) => set((s) => ({ templates: [...s.templates, t] })),
  update: (id, patch) => set((s) => ({ templates: s.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  remove: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),
}))
