import type { Field, ID, Module } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { useModuleStore } from '#/stores/moduleStore'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { useRecordStore } from '#/stores/recordStore'
import { useFormStore, useViewStore, useWorkflowStore, useDashboardStore } from '#/stores/collections'
import { useSettingsStore } from '#/stores/settingsStore'
import { logActivity } from '#/stores/activityStore'
import { newForm, newView, tasksFields } from './defaults'
import { cleanFlowsForField, removeFlowsForModule } from './dataFlowService'
import { addModuleNav, ensureCategory } from './navService'

export interface CreateModuleInput {
  workspaceId: ID
  name: string
  description?: string
  icon?: string
  color?: string
  category?: string
  parentId?: ID
  folder?: string
  fields?: Field[]
  /** nav item id (category or folder) to place the module under */
  navParentId?: ID
  system?: 'tasks'
  skipNav?: boolean
  /** false => create the module but keep it out of the sidebar (still listed under All Modules) */
  showInNav?: boolean
}

export function createModule(input: CreateModuleInput): Module {
  const ms = useModuleStore.getState()
  const t = nowIso()
  const siblings = ms.modules.filter((m) => m.workspaceId === input.workspaceId)
  const fields: Field[] = (input.fields ?? [{ id: 'name', name: 'name', label: 'Name', type: 'shortText', required: true, width: 'full', order: 0 }]).map((f, i) => ({ ...f, order: i }))
  const mod: Module = {
    id: uid('mod'),
    workspaceId: input.workspaceId,
    name: input.name.trim() || 'Untitled module',
    description: input.description,
    icon: input.icon ?? 'Box',
    color: input.color ?? '#7B68EE',
    category: input.category,
    parentId: input.parentId,
    folder: input.folder,
    fields,
    visible: true,
    showInNav: input.showInNav === false ? false : undefined,
    archived: false,
    order: siblings.length ? Math.max(...siblings.map((m) => m.order)) + 1 : 0,
    system: input.system,
    createdAt: t,
    updatedAt: t,
  }
  ms.add(mod)
  useFormStore.getState().add(newForm(mod.workspaceId, mod))
  useViewStore.getState().add(newView(mod.workspaceId, mod, 'All records', 'table'))
  if (!input.skipNav && input.showInNav !== false) placeModuleInNav(mod, input.navParentId)
  logActivity({ workspaceId: mod.workspaceId, action: 'module_created', entity: 'module', moduleId: mod.id, description: `Created module "${mod.name}"` })
  return mod
}

export function placeModuleInNav(mod: Module, navParentId?: ID) {
  const st = useSettingsStore.getState()
  const nav = st.getNav(mod.workspaceId)
  let parent: ID | null | undefined = navParentId
  if (!parent && mod.parentId) parent = nav.find((i) => i.moduleId === mod.parentId)?.id
  if (!parent) {
    // blank workspaces have no default categories: modules sit at the top level of their sidebar
    const blank = useWorkspaceStore.getState().workspaces.find((w) => w.id === mod.workspaceId)?.blank
    parent = blank ? null : ensureCategory(mod.workspaceId, 'Business Management', 'Building2').id
  }
  addModuleNav(mod.workspaceId, mod.id, mod.name, mod.icon, parent)
}

export function isModuleInSidebar(ws: ID, moduleId: ID): boolean {
  return useSettingsStore.getState().getNav(ws).some((i) => i.moduleId === moduleId)
}

/** Adds or removes a module's sidebar entry. The module itself and its data are never touched. */
export function setModuleInSidebar(id: ID, show: boolean) {
  const mod = useModuleStore.getState().modules.find((m) => m.id === id)
  if (!mod) return
  if (show) {
    useModuleStore.getState().update(id, { showInNav: undefined })
    placeModuleInNav(mod)
  } else {
    useSettingsStore.getState().removeModuleNav(mod.workspaceId, id)
    useModuleStore.getState().update(id, { showInNav: false })
  }
}

export function ensureTasksModule(ws: ID): Module {
  const existing = useModuleStore.getState().modules.find((m) => m.workspaceId === ws && m.system === 'tasks')
  if (existing) return existing
  const mod = createModule({ workspaceId: ws, name: 'Tasks', icon: 'CheckSquare', color: '#2DB67D', description: 'Tasks created by you or by workflows. Shown on My Tasks.', fields: tasksFields(), system: 'tasks', skipNav: true })
  const views = useViewStore.getState()
  views.add(newView(ws, mod, 'Board', 'kanban', { groupBy: 'status' }, 1))
  views.add(newView(ws, mod, 'Calendar', 'calendar', { dateFieldId: 'due' }, 2))
  return mod
}

export function deleteModule(id: ID) {
  const ms = useModuleStore.getState()
  const mod = ms.modules.find((m) => m.id === id)
  if (!mod || mod.system) return
  useRecordStore.getState().removeByModule(id)
  useFormStore.getState().removeWhere((f) => f.moduleId === id)
  useViewStore.getState().removeWhere((v) => v.moduleId === id)
  useWorkflowStore.getState().removeWhere((w) => w.moduleId === id)
  useDashboardStore.getState().items.forEach((d) => {
    if (d.widgets.some((w) => w.moduleId === id)) useDashboardStore.getState().update(d.id, { widgets: d.widgets.filter((w) => w.moduleId !== id) })
  })
  removeFlowsForModule(id)
  // drop relationship fields that pointed here
  ms.modules.forEach((m) => {
    if (m.id !== id && m.fields.some((f) => f.relation?.moduleId === id)) {
      m.fields.filter((f) => f.relation?.moduleId === id).forEach((f) => cleanFlowsForField(m.id, f.id))
      ms.update(m.id, { fields: m.fields.filter((f) => f.relation?.moduleId !== id) })
    }
  })
  useSettingsStore.getState().removeModuleNav(mod.workspaceId, id)
  const st = useSettingsStore.getState()
  const favs = st.settings.favourites[mod.workspaceId] ?? []
  favs.filter((f) => f.moduleId === id).forEach((f) => st.toggleFavourite(mod.workspaceId, f))
  ms.remove(id)
  logActivity({ workspaceId: mod.workspaceId, action: 'module_deleted', entity: 'module', description: `Deleted module "${mod.name}"` })
}

export function duplicateModule(id: ID, withRecords = false): Module | null {
  const ms = useModuleStore.getState()
  const src = ms.modules.find((m) => m.id === id)
  if (!src || src.system) return null
  const copy = createModule({
    workspaceId: src.workspaceId,
    name: `${src.name} (copy)`,
    description: src.description,
    icon: src.icon,
    color: src.color,
    category: src.category,
    parentId: src.parentId,
    folder: src.folder,
    fields: src.fields.map((f) => ({ ...f })),
    showInNav: src.showInNav === false ? false : undefined,
    navParentId: useSettingsStore.getState().getNav(src.workspaceId).find((i) => i.moduleId === src.id)?.parentId ?? undefined,
  })
  useModuleStore.getState().update(copy.id, { titleFieldId: src.titleFieldId, permissions: src.permissions, counters: withRecords ? src.counters : {} })
  // replace the auto-created defaults with copies of source forms & views
  useFormStore.getState().removeWhere((f) => f.moduleId === copy.id)
  useViewStore.getState().removeWhere((v) => v.moduleId === copy.id)
  const t = nowIso()
  useFormStore.getState().addMany(useFormStore.getState().items.filter((f) => f.moduleId === src.id).map((f) => ({ ...structuredClone(f), id: uid('form'), moduleId: copy.id, createdAt: t, updatedAt: t })))
  useViewStore.getState().addMany(useViewStore.getState().items.filter((v) => v.moduleId === src.id).map((v) => ({ ...structuredClone(v), id: uid('view'), moduleId: copy.id, createdAt: t, updatedAt: t })))
  if (withRecords) {
    useRecordStore.getState().setAll([
      ...useRecordStore.getState().records,
      ...useRecordStore.getState().records.filter((r) => r.moduleId === src.id && !r.deletedAt).map((r) => ({ ...structuredClone(r), id: uid('rec'), moduleId: copy.id, attachments: [] })),
    ])
  }
  return copy
}

export function setModuleArchived(id: ID, archived: boolean) {
  const mod = useModuleStore.getState().modules.find((m) => m.id === id)
  if (!mod) return
  useModuleStore.getState().update(id, { archived })
  logActivity({ workspaceId: mod.workspaceId, action: archived ? 'module_archived' : 'module_restored', entity: 'module', moduleId: id, description: `${archived ? 'Archived' : 'Restored'} module "${mod.name}"` })
}

export function renameModule(id: ID, name: string) {
  const mod = useModuleStore.getState().modules.find((m) => m.id === id)
  if (!mod || !name.trim()) return
  useModuleStore.getState().update(id, { name: name.trim() })
  const st = useSettingsStore.getState()
  st.getNav(mod.workspaceId).filter((i) => i.moduleId === id).forEach((i) => st.updateNavItem(mod.workspaceId, i.id, { label: name.trim() }))
}

export function removeFieldCascade(moduleId: ID, fieldId: string) {
  useModuleStore.getState().removeField(moduleId, fieldId)
  cleanFlowsForField(moduleId, fieldId)
  useFormStore.getState().items.filter((f) => f.moduleId === moduleId).forEach((f) => {
    useFormStore.getState().update(f.id, { sections: f.sections.map((s) => ({ ...s, items: s.items.filter((i) => i.fieldId !== fieldId) })) })
  })
  useViewStore.getState().items.filter((v) => v.moduleId === moduleId).forEach((v) => {
    const c = v.config
    useViewStore.getState().update(v.id, {
      config: {
        ...c,
        filters: c.filters.filter((x) => x.fieldId !== fieldId),
        sorts: c.sorts.filter((x) => x.fieldId !== fieldId),
        groupBy: c.groupBy === fieldId ? undefined : c.groupBy,
        dateFieldId: c.dateFieldId === fieldId ? undefined : c.dateFieldId,
        endDateFieldId: c.endDateFieldId === fieldId ? undefined : c.endDateFieldId,
        imageFieldId: c.imageFieldId === fieldId ? undefined : c.imageFieldId,
        hiddenFieldIds: c.hiddenFieldIds.filter((x) => x !== fieldId),
        fieldOrder: c.fieldOrder.filter((x) => x !== fieldId),
      },
    })
  })
}
