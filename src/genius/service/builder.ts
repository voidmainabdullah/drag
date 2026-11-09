import type { ID, Role, Workflow } from '#/types'
import { logActivity } from '#/stores/activityStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUserStore } from '#/stores/userStore'
import { useWorkflowStore } from '#/stores/collections'
import { uid } from '#/utils/id'
import { workflowHash, type ApplyResult, type NavAdd } from '../compiler/apply'
import { projectIdFor } from '../compiler/ids'
import { integrityProblems } from '../config/integrity'
import { clone, hash53, revisionOf, type ConfigModel } from '../config/model'
import { readConfig, placeNav, recordsOfModule, restoreStores, snapshotStores, writeConfig } from '../config/storePort'
import { can, type Actor } from '../permissions/policy'
import { diffKeys, fingerprints, pickComponents, touchedKeys } from '../state/fingerprint'
import { useGeniusStore } from '../state/geniusStore'
import { COMPILER_VERSION, type GeniusVersion, type KeyChange, type Proposal, type UsageTotals } from '../state/types'
import { getTenantId } from '../tenant'
import { SCHEMA_VERSION, type Question } from '../blueprint/schema'
import { issue, type Issue } from '../validation/issues'
import { validateBlueprint, validatePatch, type ValidateContext, type ValidationOutcome } from '../validation'

export function currentActor(): Actor {
  const s = useSettingsStore.getState().settings
  const user = useUserStore.getState().users.find((u) => u.id === s.currentUserId) ?? useUserStore.getState().users[0]
  const role: Role | undefined = useUserStore.getState().roles.find((r) => r.id === user?.roleId)
  return { userId: user?.id ?? 'unknown', role }
}

export function validationContext(workspaceId: ID, over: Partial<ValidateContext> = {}): ValidateContext {
  const tenantId = getTenantId()
  return {
    config: readConfig(workspaceId),
    tenantId,
    workspaceId,
    projectId: projectIdFor(tenantId, workspaceId),
    actor: currentActor(),
    now: new Date().toISOString(),
    records: recordsOfModule,
    ...over,
  }
}

// ---- proposals ----------------------------------------------------------------------------------------------------

export interface ProposalInput {
  kind: 'build' | 'patch'
  raw: unknown
  request: string
  intent: string
  summary?: string
  assumptions?: string[]
  questions?: Question[]
  baseFingerprints?: Record<string, string>
  correlationId?: string
  usage?: UsageTotals
  models?: string[]
  repairAttempts?: number
}

/** Validate a model-proposed blueprint/patch against the LIVE configuration and keep it as a proposal. Nothing is written. */
export function submitProposal(workspaceId: ID, input: ProposalInput, over: Partial<ValidateContext> = {}): { proposal: Proposal; outcome: ValidationOutcome } {
  const ctx = validationContext(workspaceId, over)
  let outcome = input.kind === 'build' ? validateBlueprint(input.raw, ctx) : validatePatch(input.raw, ctx)

  // a patch designed against an older revision is still fine when nothing it touches has changed since
  if (input.kind === 'patch' && outcome.stale && outcome.issues.some((i) => i.code === 'STALE_REVISION')) {
    const live = ctx.config
    const touched = touchedKeys(outcome.ops, live, workspaceId)
    const nowFp = fingerprints(live)
    const base = input.baseFingerprints
    const changed = base ? touched.filter((k) => base[k] !== nowFp[k]) : touched
    if (base && changed.length === 0) outcome = validatePatch(input.raw, { ...ctx, allowStaleRevision: true })
    else
      outcome = {
        ...outcome,
        issues: [...outcome.issues, issue('references', 'STALE_CONFLICT', 'expected_revision', `Changed since this was designed: ${changed.slice(0, 6).join(', ') || 'unknown components'}`, 'Reload the current configuration and regenerate the change on top of it; your newer edits were not overwritten.')],
      }
  }

  const apply = outcome.apply
  const proposal: Proposal = {
    id: uid('prop'),
    workspaceId,
    createdAt: ctx.now,
    request: input.request.slice(0, 2000),
    intent: input.intent,
    kind: input.kind,
    state: outcome.report.ok ? 'validated' : 'draft',
    blueprint: outcome.blueprint,
    patch: outcome.patch,
    baseRevision: revisionOf(ctx.config),
    baseFingerprints: input.baseFingerprints ?? fingerprints(ctx.config),
    summary: input.summary ?? outcome.blueprint?.meta.name ?? outcome.patch?.summary ?? '',
    assumptions: input.assumptions ?? [],
    questions: input.questions ?? [],
    issues: outcome.issues.filter((i) => !i.notImplementable),
    notImplementable: outcome.report.notImplementable,
    changes: apply?.changes ?? [],
    warnings: [...(apply?.warnings ?? [])],
    navAdds: apply?.navAdds ?? [],
    needsApproval: apply?.needsApproval ?? [],
    model: input.models ? { used: input.models } : undefined,
    correlationId: input.correlationId,
    repairAttempts: input.repairAttempts ?? 0,
    usage: input.usage,
  }
  const g = useGeniusStore.getState()
  // a newer proposal replaces older undecided ones of the same workspace
  for (const p of g.proposals) if (p.workspaceId === workspaceId && (p.state === 'draft' || p.state === 'validated')) g.patchProposal(p.id, { state: 'superseded' })
  g.putProposal(proposal)
  g.audit1({ actor: ctx.actor.userId, workspaceId, action: 'proposal_created', target: proposal.id, detail: `${input.kind}: ${proposal.summary}`, correlationId: input.correlationId })
  return { proposal, outcome }
}

export function rejectProposal(id: string): boolean {
  const g = useGeniusStore.getState()
  const p = g.proposals.find((x) => x.id === id)
  if (!p || (p.state !== 'draft' && p.state !== 'validated')) return false
  const actor = currentActor().userId
  g.patchProposal(id, { state: 'rejected', decidedAt: new Date().toISOString(), decidedBy: actor })
  g.audit1({ actor, workspaceId: p.workspaceId, action: 'proposal_rejected', target: id, detail: p.summary, correlationId: p.correlationId })
  return true
}

// ---- commit (atomic) ----------------------------------------------------------------------------------------------

export interface CommitMeta {
  workspaceId: ID
  kind: GeniusVersion['kind']
  summary: string
  request?: string
  jobKey: string
  proposalId?: string
  correlationId?: string
  changes: ApplyResult['changes']
  warnings: string[]
  navAdds: NavAdd[]
  navRemoves: string[]
  /** extra nav work (undo) done inside the same atomic section */
  navFix?: () => { added: string[]; removed: import('#/types').NavItem[] }
}

export type CommitResult = { ok: true; version: GeniusVersion; duplicate: boolean } | { ok: false; error: string; issues?: Issue[] }

/**
 * Write a new configuration into the real stores as ONE unit: snapshot, write, verify, record the version. Any failure
 * restores the snapshot, so a half-built CRM is never visible. A repeated job key returns the existing version.
 */
export function commitConfig(next: ConfigModel, meta: CommitMeta): CommitResult {
  const g = useGeniusStore.getState()
  const existing = g.versions.find((v) => v.jobKey === meta.jobKey && v.workspaceId === meta.workspaceId && !v.undone)
  if (existing) return { ok: true, version: existing, duplicate: true }
  const actor = currentActor().userId
  const snap = snapshotStores(meta.workspaceId)
  const before = readConfig(meta.workspaceId)
  const beforeFp = fingerprints(before)
  const revisionBefore = revisionOf(before)
  try {
    writeConfig(next)
    const nav = meta.navFix ? meta.navFix() : placeNav(meta.workspaceId, meta.navAdds, meta.navRemoves, next.modules)
    const after = readConfig(meta.workspaceId)
    if (revisionOf(after) !== revisionOf(next)) throw new Error('The saved configuration does not match what was validated')
    const afterFp = fingerprints(after)
    const keys: KeyChange[] = diffKeys(beforeFp, afterFp)
    const version: GeniusVersion = {
      id: uid('ver'),
      workspaceId: meta.workspaceId,
      number: Math.max(0, ...g.versions.filter((v) => v.workspaceId === meta.workspaceId).map((v) => v.number)) + 1,
      kind: meta.kind,
      summary: meta.summary,
      request: meta.request?.slice(0, 600),
      createdAt: new Date().toISOString(),
      actor,
      correlationId: meta.correlationId,
      compilerVersion: COMPILER_VERSION,
      schemaVersion: SCHEMA_VERSION,
      revisionBefore,
      revisionAfter: revisionOf(after),
      jobKey: meta.jobKey,
      keys,
      before: pickComponents(before, keys.map((k) => k.key)),
      navAdded: nav.added,
      navRemoved: nav.removed,
      afterFingerprints: Object.fromEntries(Object.entries(afterFp).filter(([k]) => keys.some((c) => c.key === k))),
      changes: meta.changes,
      warnings: meta.warnings,
      proposalId: meta.proposalId,
    }
    const gs = useGeniusStore.getState()
    gs.addVersion(version)
    gs.audit1({ actor, workspaceId: meta.workspaceId, action: 'config_changed', target: version.id, detail: `v${version.number} ${meta.kind}: ${meta.summary} (${keys.length} component${keys.length === 1 ? '' : 's'})`, correlationId: meta.correlationId })
    if (meta.changes.some((c) => c.kind === 'role' || c.kind === 'permission')) gs.audit1({ actor, workspaceId: meta.workspaceId, action: 'permission_changed', target: version.id, detail: meta.changes.filter((c) => c.kind === 'role' || c.kind === 'permission').map((c) => c.label).join('; '), correlationId: meta.correlationId })
    const destructive = meta.changes.filter((c) => c.destructive)
    if (destructive.length) gs.audit1({ actor, workspaceId: meta.workspaceId, action: 'destructive_change', target: version.id, detail: destructive.map((c) => c.label).join('; '), correlationId: meta.correlationId })
    logActivity({ workspaceId: meta.workspaceId, action: 'genius_change', entity: 'workspace', description: `Genius AI: ${meta.summary}` })
    return { ok: true, version, duplicate: false }
  } catch (e) {
    restoreStores(snap)
    return { ok: false, error: e instanceof Error ? e.message : 'The change could not be saved; nothing was changed' }
  }
}

export type AcceptResult = CommitResult | { ok: false; error: string; issues: Issue[] }

/** Accept a validated proposal: re-validate against what is live NOW, then commit atomically. */
export function acceptProposal(id: string, over: Partial<ValidateContext> = {}): AcceptResult {
  const g = useGeniusStore.getState()
  const p = g.proposals.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'Proposal not found', issues: [] }
  if (p.state === 'accepted') {
    const v = g.versions.find((x) => x.id === p.versionId)
    return v ? { ok: true, version: v, duplicate: true } : { ok: false, error: 'Already accepted', issues: [] }
  }
  if (p.state !== 'validated') return { ok: false, error: `This proposal is ${p.state}; only a validated proposal can be accepted`, issues: p.issues }
  const raw = p.kind === 'build' ? p.blueprint : p.patch
  const ctx = validationContext(p.workspaceId, over)
  let outcome = p.kind === 'build' ? validateBlueprint(raw, ctx) : validatePatch(raw, ctx)
  if (p.kind === 'patch' && outcome.stale && !outcome.report.ok) {
    const touched = touchedKeys(outcome.ops, ctx.config, p.workspaceId)
    const nowFp = fingerprints(ctx.config)
    if (touched.every((k) => p.baseFingerprints[k] === nowFp[k])) outcome = validatePatch(raw, { ...ctx, allowStaleRevision: true })
  }
  if (!outcome.report.ok || !outcome.apply) {
    g.patchProposal(id, { state: 'draft', issues: outcome.issues.filter((i) => !i.notImplementable) })
    return { ok: false, error: 'The configuration changed since this was validated, and the proposal no longer applies cleanly. Nothing was changed.', issues: outcome.report.errors }
  }
  const apply = outcome.apply
  const jobKey = `job_${hash53(`${p.id}:${p.kind}`)}`
  const res = commitConfig(apply.config, { workspaceId: p.workspaceId, kind: p.kind === 'build' ? 'build' : 'patch', summary: p.summary || (p.kind === 'build' ? 'New build' : 'Change'), request: p.request, jobKey, proposalId: p.id, correlationId: p.correlationId, changes: apply.changes, warnings: apply.warnings, navAdds: apply.navAdds, navRemoves: apply.navRemoves })
  const actor = currentActor().userId
  if (res.ok) {
    g.patchProposal(id, { state: 'accepted', decidedAt: new Date().toISOString(), decidedBy: actor, versionId: res.version.id, changes: apply.changes, needsApproval: apply.needsApproval })
    if (!res.duplicate) g.audit1({ actor, workspaceId: p.workspaceId, action: 'proposal_accepted', target: p.id, detail: p.summary, correlationId: p.correlationId })
  } else {
    g.patchProposal(id, { state: 'failed' })
  }
  return res
}

// ---- undo / restore -------------------------------------------------------------------------------------------------------

export type UndoResult = CommitResult | { ok: false; error: string; conflicts: string[] }

/** Undo ONE version: only the components it changed go back; later manual edits to other components stay. */
export function undoVersion(versionId: string, opts: { force?: boolean } = {}): UndoResult {
  const g = useGeniusStore.getState()
  const v = g.versions.find((x) => x.id === versionId)
  if (!v) return { ok: false, error: 'Version not found', conflicts: [] }
  if (v.undone) return { ok: false, error: 'This version was already undone', conflicts: [] }
  const live = readConfig(v.workspaceId)
  const liveFp = fingerprints(live)
  const conflicts: string[] = []
  for (const k of v.keys) {
    if (k.op === 'remove') {
      if (k.key in liveFp) conflicts.push(`${k.key} was re-created after this change`)
    } else if (liveFp[k.key] !== v.afterFingerprints[k.key]) conflicts.push(`${k.key} was edited after this change`)
  }
  if (conflicts.length && !opts.force) return { ok: false, error: 'Later edits touch the same components. Undoing would overwrite them.', conflicts }

  const next = clone(live)
  const before = v.before
  const notes: string[] = []
  for (const k of v.keys) {
    const [kind, ...rest] = k.key.split(':')
    const id = rest.join(':')
    const restore = <T extends { id: string }>(list: T[], prev: T[]): T[] => {
      const old = prev.find((x) => x.id === id)
      const without = list.filter((x) => x.id !== id)
      return old ? (list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? old : x)) : [...without, old]) : without
    }
    if (kind === 'module') {
      if (k.op === 'add') {
        const records = recordsOfModule(id).length
        if (records > 0) {
          // records are never deleted: the module is archived instead
          next.modules = next.modules.map((m) => (m.id === id ? { ...m, archived: true, visible: false } : m))
          notes.push(`${id} has ${records} record(s), so it was archived instead of deleted`)
        } else next.modules = next.modules.filter((m) => m.id !== id)
      } else next.modules = restore(next.modules, before.modules)
    } else if (kind === 'form') next.forms = restore(next.forms, before.forms)
    else if (kind === 'view') next.views = restore(next.views, before.views)
    else if (kind === 'workflow') next.workflows = restore(next.workflows, before.workflows)
    else if (kind === 'dashboard') next.dashboards = restore(next.dashboards, before.dashboards)
    else if (kind === 'role') next.roles = restore(next.roles, before.roles)
  }
  const problems = integrityProblems(next)
  if (problems.length && !opts.force) return { ok: false, error: 'Undoing would leave broken references.', conflicts: problems }

  const archivedIds = new Set(next.modules.filter((m) => m.archived).map((m) => m.id))
  const res = commitConfig(next, {
    workspaceId: v.workspaceId,
    kind: 'restore',
    summary: `Undo v${v.number}: ${v.summary}`,
    jobKey: `undo_${v.id}`,
    changes: [],
    warnings: notes,
    navAdds: [],
    navRemoves: [],
    navFix: () => {
      const st = useSettingsStore.getState()
      const removed: import('#/types').NavItem[] = []
      const cur = st.getNav(v.workspaceId)
      for (const id of v.navAdded) {
        const it = cur.find((i) => i.id === id)
        if (it) removed.push(it)
      }
      const drop = new Set([...v.navAdded, ...cur.filter((i) => i.moduleId && archivedIds.has(i.moduleId)).map((i) => i.id)])
      const kept = cur.filter((i) => !drop.has(i.id))
      const readd = v.navRemoved.filter((i) => !kept.some((x) => x.id === i.id) && (!i.moduleId || next.modules.some((m) => m.id === i.moduleId)))
      st.setNav(v.workspaceId, [...kept, ...readd])
      return { added: readd.map((i) => i.id), removed }
    },
  })
  if (res.ok) {
    g.patchVersion(v.id, { undone: { at: new Date().toISOString(), by: currentActor().userId } })
    g.audit1({ actor: currentActor().userId, workspaceId: v.workspaceId, action: 'version_undone', target: v.id, detail: `Undid v${v.number}: ${v.summary}${opts.force ? ' (forced over later edits)' : ''}`, correlationId: v.correlationId })
  }
  return res
}

/** Restore the configuration to how it was just after version `number` by undoing every newer version, newest first. */
export function restoreToVersion(workspaceId: ID, number: number, opts: { force?: boolean } = {}): { ok: boolean; undone: number; error?: string; conflicts?: string[] } {
  const g = useGeniusStore.getState()
  const newer = g.versions.filter((v) => v.workspaceId === workspaceId && v.number > number && !v.undone && v.kind !== 'restore').sort((a, b) => b.number - a.number)
  let undone = 0
  for (const v of newer) {
    const r = undoVersion(v.id, opts)
    if (!r.ok) return { ok: false, undone, error: r.error, conflicts: 'conflicts' in r ? r.conflicts : undefined }
    undone++
  }
  useGeniusStore.getState().audit1({ actor: currentActor().userId, workspaceId, action: 'version_restored', target: `v${number}`, detail: `Restored to version ${number} (${undone} newer change${undone === 1 ? '' : 's'} undone)` })
  return { ok: true, undone }
}

// ---- workflow approval / activation -------------------------------------------------------------------------------------

export type WorkflowGate = { ok: true } | { ok: false; code: 'PERMISSION' | 'APPROVAL_REQUIRED' | 'APPROVAL_STALE' | 'NOT_FOUND'; message: string }

/** Whether a workflow may be switched on. AI-built and consequential workflows need an approval bound to their exact definition. */
export function canEnableWorkflow(wf: Workflow | undefined, actor: Actor = currentActor()): WorkflowGate {
  if (!wf) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found' }
  if (!can(actor.role, 'manageWorkflows')) return { ok: false, code: 'PERMISSION', message: 'Your role cannot manage workflows' }
  if (wf.origin === 'ai' || wf.consequential) {
    if (!wf.approval) return { ok: false, code: 'APPROVAL_REQUIRED', message: 'This workflow was built by Genius AI or changes financial/other records. Review its dry-run and approve it before switching it on.' }
    if (wf.approval.hash !== workflowHash(wf)) return { ok: false, code: 'APPROVAL_STALE', message: 'The workflow changed after it was approved. Approve the new definition first.' }
  }
  return { ok: true }
}

export function approveWorkflow(id: string, note?: string): WorkflowGate {
  const wf = useWorkflowStore.getState().items.find((w) => w.id === id)
  const actor = currentActor()
  if (!wf) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found' }
  if (!can(actor.role, 'manageWorkflows')) return { ok: false, code: 'PERMISSION', message: 'Your role cannot manage workflows' }
  useWorkflowStore.getState().update(id, { approval: { by: actor.userId, at: new Date().toISOString(), note, hash: workflowHash(wf) } })
  useGeniusStore.getState().audit1({ actor: actor.userId, workspaceId: wf.workspaceId, action: 'workflow_approved', target: id, detail: `Approved "${wf.name}"${note ? `: ${note}` : ''}` })
  return { ok: true }
}

export function setWorkflowEnabled(id: string, enabled: boolean): WorkflowGate {
  const wf = useWorkflowStore.getState().items.find((w) => w.id === id)
  if (enabled) {
    const gate = canEnableWorkflow(wf)
    if (!gate.ok) return gate
  } else if (!can(currentActor().role, 'manageWorkflows')) return { ok: false, code: 'PERMISSION', message: 'Your role cannot manage workflows' }
  if (!wf) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found' }
  useWorkflowStore.getState().update(id, { enabled })
  useGeniusStore.getState().audit1({ actor: currentActor().userId, workspaceId: wf.workspaceId, action: enabled ? 'workflow_enabled' : 'workflow_disabled', target: id, detail: `${enabled ? 'Enabled' : 'Disabled'} "${wf.name}"` })
  return { ok: true }
}

// ---- status -------------------------------------------------------------------------------------------------------------------

import type { BuildStatus } from '../state/types'

/** draft → validated → published → active, as shown on the badge. */
export function buildStatus(workspaceId: ID): { status: BuildStatus; externalAutomation: boolean; label: string } {
  const g = useGeniusStore.getState()
  const pending = g.proposals.filter((p) => p.workspaceId === workspaceId && (p.state === 'draft' || p.state === 'validated')).at(-1)
  const wfs = useWorkflowStore.getState().items.filter((w) => w.workspaceId === workspaceId && w.origin === 'ai')
  const active = wfs.some((w) => w.enabled)
  const published = g.versions.some((v) => v.workspaceId === workspaceId && !v.undone && v.kind !== 'restore')
  // pending work always shows first: it is what the user has to act on
  if (pending) return { status: pending.state === 'validated' ? 'validated' : 'draft', externalAutomation: false, label: pending.state === 'validated' ? 'Validated: waiting for you to accept' : 'Draft: has problems to fix' }
  if (active) return { status: 'active', externalAutomation: false, label: 'Active: automations are running (in-app only)' }
  if (published) return { status: 'published', externalAutomation: false, label: 'Published: in your CRM, automations are off' }
  return { status: 'draft', externalAutomation: false, label: 'Nothing built yet' }
}

