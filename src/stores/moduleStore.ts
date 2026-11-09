import { create } from 'zustand'
import type { Field, ID, Module } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { logActivity } from './activityStore'

interface ModuleState {
  modules: Module[]
  setAll: (m: Module[]) => void
  add: (m: Module) => void
  update: (id: ID, patch: Partial<Module>) => void
  remove: (id: ID) => void
  removeByWorkspace: (ws: ID) => void
  reorder: (ws: ID, orderedIds: ID[]) => void
  addField: (moduleId: ID, field: Field) => void
  updateField: (moduleId: ID, fieldId: string, patch: Partial<Field>) => void
  removeField: (moduleId: ID, fieldId: string) => void
  reorderFields: (moduleId: ID, orderedIds: string[]) => void
  duplicateField: (moduleId: ID, fieldId: string) => Field | undefined
  bumpCounter: (moduleId: ID, fieldId: string) => number
}

const touch = (m: Module, patch: Partial<Module>): Module => ({ ...m, ...patch, updatedAt: nowIso() })

export const useModuleStore = create<ModuleState>((set, get) => ({
  modules: [],
  setAll: (modules) => set({ modules }),
  add: (m) => set((s) => ({ modules: [...s.modules, m] })),
  update: (id, patch) => set((s) => ({ modules: s.modules.map((m) => (m.id === id ? touch(m, patch) : m)) })),
  remove: (id) => set((s) => ({ modules: s.modules.filter((m) => m.id !== id).map((m) => (m.parentId === id ? { ...m, parentId: undefined } : m)) })),
  removeByWorkspace: (ws) => set((s) => ({ modules: s.modules.filter((m) => m.workspaceId !== ws) })),
  reorder: (ws, orderedIds) =>
    set((s) => ({
      modules: s.modules.map((m) => (m.workspaceId === ws && orderedIds.includes(m.id) ? { ...m, order: orderedIds.indexOf(m.id) } : m)),
    })),
  addField: (moduleId, field) => {
    const m = get().modules.find((x) => x.id === moduleId)
    if (!m) return
    get().update(moduleId, { fields: [...m.fields, { ...field, order: m.fields.length }] })
    logActivity({ workspaceId: m.workspaceId, action: 'field_added', entity: 'field', moduleId, description: `Added field "${field.label}" to ${m.name}` })
  },
  updateField: (moduleId, fieldId, patch) => {
    const m = get().modules.find((x) => x.id === moduleId)
    if (!m) return
    get().update(moduleId, { fields: m.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) })
  },
  removeField: (moduleId, fieldId) => {
    const m = get().modules.find((x) => x.id === moduleId)
    const f = m?.fields.find((x) => x.id === fieldId)
    if (!m || !f) return
    get().update(moduleId, {
      fields: m.fields.filter((x) => x.id !== fieldId).map((x, i) => ({ ...x, order: i })),
      titleFieldId: m.titleFieldId === fieldId ? undefined : m.titleFieldId,
    })
    logActivity({ workspaceId: m.workspaceId, action: 'field_removed', entity: 'field', moduleId, description: `Removed field "${f.label}" from ${m.name}` })
  },
  reorderFields: (moduleId, orderedIds) => {
    const m = get().modules.find((x) => x.id === moduleId)
    if (!m) return
    const byId = new Map(m.fields.map((f) => [f.id, f]))
    const next = orderedIds.map((id) => byId.get(id)).filter((f): f is Field => !!f)
    m.fields.forEach((f) => {
      if (!orderedIds.includes(f.id)) next.push(f)
    })
    get().update(moduleId, { fields: next.map((f, i) => ({ ...f, order: i })) })
  },
  duplicateField: (moduleId, fieldId) => {
    const m = get().modules.find((x) => x.id === moduleId)
    const f = m?.fields.find((x) => x.id === fieldId)
    if (!m || !f) return undefined
    const copy: Field = { ...f, id: uid('fld'), label: `${f.label} (copy)`, name: `${f.name}_copy`, unique: false }
    const idx = m.fields.findIndex((x) => x.id === fieldId)
    const fields = [...m.fields]
    fields.splice(idx + 1, 0, copy)
    get().update(moduleId, { fields: fields.map((x, i) => ({ ...x, order: i })) })
    return copy
  },
  bumpCounter: (moduleId, fieldId) => {
    const m = get().modules.find((x) => x.id === moduleId)
    const next = ((m?.counters ?? {})[fieldId] ?? 0) + 1
    if (m) get().update(moduleId, { counters: { ...(m.counters ?? {}), [fieldId]: next } })
    return next
  },
}))
