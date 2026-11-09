import { useUiStore, type ConfirmOptions } from '#/stores/uiStore'

export const toast = {
  success: (title: string, message?: string) => useUiStore.getState().pushToast({ kind: 'success', title, message }),
  error: (title: string, message?: string) => useUiStore.getState().pushToast({ kind: 'error', title, message }),
  info: (title: string, message?: string) => useUiStore.getState().pushToast({ kind: 'info', title, message }),
  warning: (title: string, message?: string) => useUiStore.getState().pushToast({ kind: 'warning', title, message }),
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return useUiStore.getState().askConfirm(o)
}
