import type { DataFlowLink, Field, ID, Template, Widget } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { validateFlow } from '#/utils/dataflow'
import { useModuleStore } from '#/stores/moduleStore'
import { useFormStore, useViewStore, useWorkflowStore, useDashboardStore, useDataFlowStore } from '#/stores/collections'
import { logActivity } from '#/stores/activityStore'
import { createModule, placeModuleInNav } from './moduleService'
import { defaultPublicSettings, emptyViewConfig } from './defaults'
import { ensureCategory } from './navService'

export interface InstallResult {
  moduleIds: ID[]
  moduleCount: number
  formCount: number
  viewCount: number
  workflowCount: number
  flowCount: number
}

export interface InstallOptions {
  /** the workspace that receives everything; no other workspace is read or written */
  workspaceId: ID
  navParentLabel?: string
  silent?: boolean
  /** false => modules are created but get no sidebar entry (still listed under All Modules) */
  showInNav?: boolean
}

/**
 * The ONE generic installer. Every template (built-in, duplicated or saved from a workspace)
 * is plain data and goes through here. Nothing is locked after install.
 */
export function installTemplate(t: Template, opts: InstallOptions): InstallResult {
  const ws = opts.workspaceId
  const showInNav = opts.showInNav !== false
  const keyToId = new Map<string, ID>()
  const existingIds = new Set(useModuleStore.getState().modules.filter((m) => m.workspaceId === ws).map((m) => m.id))
  // a hidden install must not leave an empty category behind in the sidebar
  const category = showInNav ? ensureCategory(ws, opts.navParentLabel ?? t.category, t.icon || 'Folder') : undefined

  // pass 1: create modules (ids first so relationships can be remapped)
  const created: { key: string; id: ID }[] = []
  for (const tm of t.modules) {
    const m = createModule({ workspaceId: ws, name: tm.name, description: tm.description, icon: tm.icon, color: tm.color, category: t.category, fields: [{ ...tm.fields[0] }], skipNav: true, showInNav })
    keyToId.set(tm.key, m.id)
    created.push({ key: tm.key, id: m.id })
  }
  // pass 2: real fields with remapped relations
  for (const tm of t.modules) {
    const id = keyToId.get(tm.key)!
    const fields: Field[] = []
    for (const f of tm.fields) {
      const copy: Field = structuredClone(f)
      if (copy.relation) {
        const target = keyToId.get(copy.relation.moduleId) ?? (existingIds.has(copy.relation.moduleId) ? copy.relation.moduleId : undefined)
        if (!target) continue
        copy.relation.moduleId = target
      }
      fields.push(copy)
    }
    useModuleStore.getState().update(id, { fields: fields.map((f, i) => ({ ...f, order: i })), titleFieldId: tm.titleFieldId })
    if (category) placeModuleInNav(useModuleStore.getState().modules.find((m) => m.id === id)!, category.id)
  }

  const t0 = nowIso()
  // forms
  const formsByModule = new Set(t.forms.map((f) => f.moduleKey))
  for (const key of formsByModule) useFormStore.getState().removeWhere((f) => f.moduleId === keyToId.get(key))
  for (const f of t.forms) {
    const moduleId = keyToId.get(f.moduleKey)
    if (!moduleId) continue
    useFormStore.getState().add({
      id: uid('form'),
      workspaceId: ws,
      moduleId,
      name: f.name,
      sections: f.sections.map((s) => ({ ...s, id: uid('sec'), items: [...s.items] })),
      submitLabel: f.submitLabel ?? 'Submit',
      public: defaultPublicSettings(f.name),
      createdAt: t0,
      updatedAt: t0,
    })
  }
  // views
  const viewsByModule = new Set(t.views.map((v) => v.moduleKey))
  for (const key of viewsByModule) useViewStore.getState().removeWhere((v) => v.moduleId === keyToId.get(key))
  t.views.forEach((v, i) => {
    const moduleId = keyToId.get(v.moduleKey)
    if (!moduleId) return
    useViewStore.getState().add({
      id: uid('view'),
      workspaceId: ws,
      moduleId,
      name: v.name,
      type: v.type,
      config: { ...emptyViewConfig(), ...structuredClone(v.config) },
      order: i,
      createdAt: t0,
      updatedAt: t0,
    })
  })
  // workflows
  let wfCount = 0
  for (const w of t.workflows) {
    const moduleId = keyToId.get(w.moduleKey)
    if (!moduleId) continue
    useWorkflowStore.getState().add({
      id: uid('wf'),
      workspaceId: ws,
      moduleId,
      name: w.name,
      enabled: true,
      trigger: structuredClone(w.trigger),
      conditions: w.conditions.map((c) => ({ ...c, id: uid('cnd') })),
      actions: w.actions.map((a) => ({ ...structuredClone(a), id: uid('act'), moduleId: a.moduleId ? (keyToId.get(a.moduleId) ?? a.moduleId) : undefined })),
      createdAt: t0,
      updatedAt: t0,
    })
    wfCount++
  }
  // module-to-module data flows (module keys -> new ids; flows that lost a module or field on the way are skipped)
  let flowCount = 0
  const installedModules = useModuleStore.getState().modules.filter((m) => m.workspaceId === ws)
  for (const df of t.dataflows ?? []) {
    const sourceModuleId = keyToId.get(df.sourceKey) ?? (existingIds.has(df.sourceKey) ? df.sourceKey : undefined)
    const targetModuleId = keyToId.get(df.targetKey) ?? (existingIds.has(df.targetKey) ? df.targetKey : undefined)
    if (!sourceModuleId || !targetModuleId) continue
    const { sourceKey: _s, targetKey: _t, ...rest } = structuredClone(df)
    const link: DataFlowLink = {
      ...rest,
      id: uid('flow'),
      workspaceId: ws,
      sourceModuleId,
      targetModuleId,
      conditions: rest.conditions.map((c) => ({ ...c, id: uid('cnd') })),
      action: { ...rest.action, mappings: rest.action.mappings.map((m) => ({ ...m, id: uid('map') })), sets: rest.action.sets.map((s) => ({ ...s, id: uid('set') })) },
      createdAt: t0,
      updatedAt: t0,
    }
    if (validateFlow(link, installedModules).length) continue
    useDataFlowStore.getState().add(link)
    flowCount++
  }
  // dashboard
  if (t.dashboard) {
    const widgets: Widget[] = t.dashboard.widgets
      .map((w) => ({ ...structuredClone(w), id: uid('wid'), moduleId: w.moduleId ? keyToId.get(w.moduleId) : undefined }))
      .filter((w) => !['stat', 'bar', 'line', 'pie', 'table', 'recentRecords', 'pipeline', 'revenue', 'metric', 'progress'].includes(w.type) || w.moduleId) as Widget[]
    useDashboardStore.getState().add({ id: uid('dash'), workspaceId: ws, name: t.dashboard.name, widgets, createdAt: t0, updatedAt: t0 })
  }
  if (!opts.silent) {
    logActivity({ workspaceId: ws, action: 'template_installed', entity: 'template', description: `Installed template "${t.name}" (${t.modules.length} modules)` })
  }
  return { moduleIds: created.map((c) => c.id), moduleCount: t.modules.length, formCount: t.forms.length, viewCount: t.views.length, workflowCount: wfCount, flowCount }
}

/** "Save my CRM as template": serialise the workspace structure (never records) into template data. */
export function workspaceToTemplate(ws: ID, meta: { name: string; category: string; description: string; icon?: string }): Template {
  const modules = useModuleStore.getState().modules.filter((m) => m.workspaceId === ws && !m.system && !m.archived)
  const ids = new Set(modules.map((m) => m.id))
  const forms = useFormStore.getState().items.filter((f) => ids.has(f.moduleId))
  const views = useViewStore.getState().items.filter((v) => ids.has(v.moduleId))
  const workflows = useWorkflowStore.getState().items.filter((w) => ids.has(w.moduleId))
  const dash = useDashboardStore.getState().items.find((d) => d.workspaceId === ws)
  const flows = useDataFlowStore.getState().items.filter((f) => f.workspaceId === ws && ids.has(f.sourceModuleId) && ids.has(f.targetModuleId))
  return {
    id: uid('tpl'),
    name: meta.name,
    category: meta.category,
    description: meta.description,
    icon: meta.icon ?? 'LayoutTemplate',
    createdAt: nowIso(),
    modules: modules.map((m) => ({
      key: m.id,
      name: m.name,
      description: m.description,
      icon: m.icon,
      color: m.color,
      titleFieldId: m.titleFieldId,
      fields: m.fields.filter((f) => !f.relation || ids.has(f.relation.moduleId)).map((f) => structuredClone(f)),
    })),
    forms: forms.map((f) => ({ moduleKey: f.moduleId, name: f.name, sections: structuredClone(f.sections), submitLabel: f.submitLabel })),
    views: views.map((v) => ({ moduleKey: v.moduleId, name: v.name, type: v.type, config: structuredClone(v.config) })),
    workflows: workflows.map((w) => ({ name: w.name, moduleKey: w.moduleId, trigger: structuredClone(w.trigger), conditions: structuredClone(w.conditions), actions: structuredClone(w.actions) })),
    dataflows: flows.map((f) => {
      const { id: _id, workspaceId: _w, sourceModuleId, targetModuleId, createdAt: _c, updatedAt: _u, ...rest } = structuredClone(f)
      return { ...rest, sourceKey: sourceModuleId, targetKey: targetModuleId }
    }),
    dashboard: dash
      ? { name: dash.name, widgets: dash.widgets.filter((w) => !w.moduleId || ids.has(w.moduleId)).map(({ id: _id, ...w }) => structuredClone(w)) }
      : undefined,
  }
}
