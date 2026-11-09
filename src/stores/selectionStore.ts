import { create } from 'zustand'

/** Remembers what each builder page is working on so other pages can deep-link into them. */
interface SelectionState {
  moduleId: string | null
  formId: string | null
  viewId: string | null
  workflowId: string | null
  dashboardId: string | null
  set: (p: Partial<Omit<SelectionState, 'set'>>) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  moduleId: null,
  formId: null,
  viewId: null,
  workflowId: null,
  dashboardId: null,
  set: (p) => set(p),
}))
