import { create } from 'zustand'
import { uid } from '#/utils/id'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info' | 'warning'
  title: string
  message?: string
}

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  danger?: boolean
  /** if set the user must type this text to confirm */
  requireText?: string
}

interface ConfirmState extends ConfirmOptions {
  resolve: (v: boolean) => void
}

interface UiState {
  toasts: Toast[]
  confirmState: ConfirmState | null
  mobileNavOpen: boolean
  navEditing: boolean
  commandOpen: boolean
  openRecord: { moduleId: string; recordId: string } | null
  newRecordModuleId: string | null
  newRecordInitial: Record<string, unknown> | undefined
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  askConfirm: (o: ConfirmOptions) => Promise<boolean>
  closeConfirm: (v: boolean) => void
  setMobileNav: (v: boolean) => void
  setNavEditing: (v: boolean) => void
  setCommandOpen: (v: boolean) => void
  showRecord: (moduleId: string, recordId: string) => void
  closeRecord: () => void
  startNewRecord: (moduleId: string | null, initial?: Record<string, unknown>) => void
}

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  confirmState: null,
  mobileNavOpen: false,
  navEditing: false,
  commandOpen: false,
  openRecord: null,
  newRecordModuleId: null,
  newRecordInitial: undefined,
  pushToast: (t) => {
    const id = uid('toast')
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }))
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 7000 : 3800)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  askConfirm: (o) =>
    new Promise<boolean>((resolve) => {
      get().confirmState?.resolve(false)
      set({ confirmState: { ...o, resolve } })
    }),
  closeConfirm: (v) => {
    const c = get().confirmState
    if (c) c.resolve(v)
    set({ confirmState: null })
  },
  setMobileNav: (v) => set({ mobileNavOpen: v }),
  setNavEditing: (v) => set({ navEditing: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),
  showRecord: (moduleId, recordId) => set({ openRecord: { moduleId, recordId } }),
  closeRecord: () => set({ openRecord: null }),
  startNewRecord: (moduleId, initial) => set({ newRecordModuleId: moduleId, newRecordInitial: initial }),
}))
