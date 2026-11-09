import type { Form, ID, Module } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { useFormStore } from '#/stores/collections'
import { logActivity } from '#/stores/activityStore'
import { newForm } from './defaults'

export function createForm(m: Module, name?: string): Form {
  const f = newForm(m.workspaceId, m, name)
  useFormStore.getState().add(f)
  logActivity({ workspaceId: m.workspaceId, action: 'form_created', entity: 'form', moduleId: m.id, description: `Created form "${f.name}" for ${m.name}` })
  return f
}

export function duplicateForm(id: ID): Form | null {
  const src = useFormStore.getState().items.find((f) => f.id === id)
  if (!src) return null
  const t = nowIso()
  const copy: Form = { ...structuredClone(src), id: uid('form'), name: `${src.name} (copy)`, createdAt: t, updatedAt: t }
  copy.sections = copy.sections.map((s) => ({ ...s, id: uid('sec') }))
  copy.public = { ...copy.public, enabled: false }
  useFormStore.getState().add(copy)
  logActivity({ workspaceId: src.workspaceId, action: 'form_duplicated', entity: 'form', moduleId: src.moduleId, description: `Duplicated form "${src.name}"` })
  return copy
}

export function deleteForm(id: ID) {
  const f = useFormStore.getState().items.find((x) => x.id === id)
  if (!f) return
  useFormStore.getState().remove(id)
  logActivity({ workspaceId: f.workspaceId, action: 'form_deleted', entity: 'form', moduleId: f.moduleId, description: `Deleted form "${f.name}"` })
}
