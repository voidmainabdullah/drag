import type { Module } from '#/types'
import type { ConfigModel } from '../config/model'
import { revisionOf } from '../config/model'
import { canModule, fieldAccess, type Actor } from '../permissions/policy'
import { projectIdFor } from '../compiler/ids'
import type { GeniusVersion, ProjectMemory } from '../state/types'
import { TenantCache } from './cache'

/**
 * Per-tenant compact project summary. This is the "memory of the CRM" sent with every request instead of the whole
 * configuration: names, ids and counts only, never record data, never anything the actor may not see. It is
 * summarised again whenever the configuration revision changes, and cached per (tenant, workspace, revision, role).
 */
export interface ModuleSummary {
  id: string
  name: string
  kind?: string
  fields: number
  /** ids of fields that are relationships -> target module id */
  links: { field: string; to: string }[]
  formulas: string[]
  pipeline?: string
}

export interface ProjectSummary {
  tenantId: string
  workspaceId: string
  projectId: string
  revision: string
  domain?: string
  modules: ModuleSummary[]
  workflows: { id: string; name: string; module: string; trigger: string; enabled: boolean }[]
  dashboards: { id: string; name: string; widgets: number }[]
  roles: { id: string; name: string }[]
  recentChanges: string[]
}

const cache = new TenantCache<ProjectSummary>(100, 15 * 60_000)

/** the actor's slice of the configuration: only modules they may open */
export function visibleConfig(cfg: ConfigModel, actor: Actor): ConfigModel {
  const modules = cfg.modules.filter((m) => !m.archived && canModule(actor.role, m, 'view'))
  const ids = new Set(modules.map((m) => m.id))
  return {
    ...cfg,
    modules,
    forms: cfg.forms.filter((f) => ids.has(f.moduleId)),
    views: cfg.views.filter((v) => ids.has(v.moduleId)),
    workflows: cfg.workflows.filter((w) => ids.has(w.moduleId)),
    dashboards: cfg.dashboards.filter((d) => d.widgets.every((w) => !w.moduleId || ids.has(w.moduleId))),
  }
}

const summariseModule = (m: Module, actor: Actor): ModuleSummary => {
  const fields = m.fields.filter((f) => fieldAccess(actor.role, f) !== 'hidden')
  return {
    id: m.id,
    name: m.name,
    kind: m.kind,
    fields: fields.length,
    links: fields.filter((f) => f.relation).map((f) => ({ field: f.id, to: f.relation!.moduleId })),
    formulas: fields.filter((f) => f.type === 'formula').map((f) => f.id),
    pipeline: fields.find((f) => f.pipeline)?.id,
  }
}

export function summarizeProject(tenantId: string, cfg: ConfigModel, actor: Actor, memory?: Pick<ProjectMemory, 'domain'>, versions: GeniusVersion[] = []): ProjectSummary {
  const revision = revisionOf(cfg)
  const roleKey = actor.role?.id ?? 'none'
  const hit = cache.get(tenantId, cfg.workspaceId, revision, roleKey)
  if (hit) return hit
  const vis = visibleConfig(cfg, actor)
  const summary: ProjectSummary = {
    tenantId,
    workspaceId: cfg.workspaceId,
    projectId: projectIdFor(tenantId, cfg.workspaceId),
    revision,
    domain: memory?.domain,
    modules: vis.modules.filter((m) => !m.system).map((m) => summariseModule(m, actor)),
    workflows: vis.workflows.map((w) => ({ id: w.id, name: w.name, module: w.moduleId, trigger: w.trigger.type, enabled: w.enabled })),
    dashboards: vis.dashboards.map((d) => ({ id: d.id, name: d.name, widgets: d.widgets.length })),
    roles: cfg.roles.map((r) => ({ id: r.id, name: r.name })),
    recentChanges: versions
      .filter((v) => v.workspaceId === cfg.workspaceId && !v.undone)
      .slice(-5)
      .map((v) => `v${v.number} ${v.kind}: ${v.summary}`.slice(0, 160)),
  }
  cache.set(tenantId, cfg.workspaceId, [revision, roleKey], summary)
  return summary
}

export const invalidateSummary = (tenantId: string, workspaceId: string) => cache.invalidateWorkspace(tenantId, workspaceId)

/** Remembered requirements/answers, trimmed for the prompt. */
export function memoryForPrompt(m: ProjectMemory | undefined) {
  if (!m) return undefined
  return {
    domain: m.domain,
    requirements: m.requirements.slice(-12),
    answers: m.answers.slice(-12).map((a) => ({ id: a.questionId, question: a.question, answer: a.answer })),
    assumptions: m.assumptions.slice(-8),
  }
}
