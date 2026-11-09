import type { ConfigModel } from '../config/model'
import { canonicalJson, hash53, isAiRole } from '../config/model'
import type { AnyOp } from '../compiler/apply'
import { storeId } from '../compiler/ids'
import type { ComponentKey, ComponentKind, ComponentSet, KeyChange } from './types'

const key = (kind: ComponentKind, id: string): ComponentKey => `${kind}:${id}`

/** Fingerprint of every component in a workspace configuration. Manual and AI edits change them equally. */
export function fingerprints(cfg: ConfigModel): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of cfg.modules) out[key('module', m.id)] = hash53(canonicalJson(m))
  for (const f of cfg.forms) out[key('form', f.id)] = hash53(canonicalJson(f))
  for (const v of cfg.views) out[key('view', v.id)] = hash53(canonicalJson(v))
  for (const w of cfg.workflows) out[key('workflow', w.id)] = hash53(canonicalJson(w))
  for (const d of cfg.dashboards) out[key('dashboard', d.id)] = hash53(canonicalJson(d))
  for (const r of cfg.roles) if (isAiRole(r)) out[key('role', r.id)] = hash53(canonicalJson(r))
  return out
}

export function diffKeys(before: Record<string, string>, after: Record<string, string>): KeyChange[] {
  const out: KeyChange[] = []
  for (const k of Object.keys(after)) {
    if (!(k in before)) out.push({ key: k as ComponentKey, op: 'add' })
    else if (before[k] !== after[k]) out.push({ key: k as ComponentKey, op: 'update' })
  }
  for (const k of Object.keys(before)) if (!(k in after)) out.push({ key: k as ComponentKey, op: 'remove' })
  return out
}

export function pickComponents(cfg: ConfigModel, keys: string[]): ComponentSet {
  const set = new Set(keys)
  return structuredClone({
    modules: cfg.modules.filter((m) => set.has(key('module', m.id))),
    forms: cfg.forms.filter((m) => set.has(key('form', m.id))),
    views: cfg.views.filter((m) => set.has(key('view', m.id))),
    workflows: cfg.workflows.filter((m) => set.has(key('workflow', m.id))),
    dashboards: cfg.dashboards.filter((m) => set.has(key('dashboard', m.id))),
    roles: cfg.roles.filter((m) => isAiRole(m) && set.has(key('role', m.id))),
  })
}

/** Which components could an operation list modify? (used to decide whether a stale patch can still be applied) */
export function touchedKeys(ops: AnyOp[], cfg: ConfigModel, workspaceId: string): string[] {
  const out = new Set<string>()
  const mod = (ref: string | undefined) => {
    if (!ref) return
    const m = cfg.modules.find((x) => x.id === ref) ?? cfg.modules.find((x) => x.id === storeId('module', workspaceId, ref))
    out.add(key('module', m?.id ?? storeId('module', workspaceId, ref)))
  }
  const byId = <T extends { id: string }>(list: T[], kind: ComponentKind, ref: string, bpKind: Parameters<typeof storeId>[0]) => {
    const f = list.find((x) => x.id === ref) ?? list.find((x) => x.id === storeId(bpKind, workspaceId, ref))
    out.add(key(kind, f?.id ?? storeId(bpKind, workspaceId, ref)))
    return f
  }
  for (const op of ops) {
    switch (op.op) {
      case 'add_module':
        mod(op.module.id)
        break
      case 'update_module':
      case 'remove_module':
        mod(op.id)
        break
      case 'add_field':
      case 'update_field':
      case 'remove_field':
        mod(op.moduleId)
        break
      case 'add_relationship':
        mod(op.relationship.sourceModuleId)
        break
      case 'update_relationship':
      case 'remove_relationship':
        if ('moduleId' in op && op.moduleId) mod(op.moduleId)
        else for (const m of cfg.modules) if (m.fields.some((f) => f.id === op.id)) out.add(key('module', m.id))
        break
      case 'add_formula':
        mod(op.formula.moduleId)
        break
      case 'add_pipeline':
        mod(op.pipeline.moduleId)
        break
      case 'update_formula':
      case 'remove_formula':
      case 'update_pipeline':
      case 'remove_pipeline':
        if ('moduleId' in op && op.moduleId) mod(op.moduleId)
        else for (const m of cfg.modules) if (m.fields.some((f) => f.id === op.id)) out.add(key('module', m.id))
        break
      case 'add_form':
        mod(op.form.moduleId)
        out.add(key('form', storeId('form', workspaceId, op.form.id)))
        break
      case 'update_form':
      case 'remove_form':
        byId(cfg.forms, 'form', op.id, 'form')
        break
      case 'add_view':
        mod(op.view.moduleId)
        out.add(key('view', storeId('view', workspaceId, op.view.id)))
        break
      case 'update_view':
      case 'remove_view':
        byId(cfg.views, 'view', op.id, 'view')
        break
      case 'add_workflow':
        mod(op.workflow.moduleId)
        out.add(key('workflow', storeId('workflow', workspaceId, op.workflow.id)))
        break
      case 'update_workflow':
      case 'remove_workflow':
      case 'enable_workflow':
      case 'disable_workflow':
        byId(cfg.workflows, 'workflow', op.id, 'workflow')
        break
      case 'add_dashboard':
        out.add(key('dashboard', storeId('dashboard', workspaceId, op.dashboard.id)))
        break
      case 'update_dashboard':
      case 'remove_dashboard':
        byId(cfg.dashboards, 'dashboard', op.id, 'dashboard')
        break
      case 'update_permissions':
        mod(op.rule.moduleId)
        break
      case 'add_role':
        out.add(key('role', storeId('role', workspaceId, op.role.id)))
        break
      case 'update_layout':
        mod(op.layout.moduleId)
        break
    }
  }
  return [...out]
}
