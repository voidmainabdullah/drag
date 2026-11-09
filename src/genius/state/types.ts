import type { Dashboard, Form, Module, NavItem, Role, View, Workflow } from '#/types'
import type { Blueprint, Patch, Question } from '../blueprint/schema'
import type { Change, NavAdd } from '../compiler/apply'
import type { Issue } from '../validation/issues'

export const COMPILER_VERSION = 'genius-compiler/1.0.0'

/** The state a user sees: draft (proposed) → validated (passed all checks) → published (in the CRM) → active (automation running). */
export type BuildStatus = 'draft' | 'validated' | 'published' | 'active'

export type ComponentKind = 'module' | 'form' | 'view' | 'workflow' | 'dashboard' | 'role'
export type ComponentKey = `${ComponentKind}:${string}`

/** Only the components a version touched, as they were BEFORE it (for undo). */
export interface ComponentSet {
  modules: Module[]
  forms: Form[]
  views: View[]
  workflows: Workflow[]
  dashboards: Dashboard[]
  roles: Role[]
}

export interface KeyChange {
  key: ComponentKey
  op: 'add' | 'update' | 'remove'
}

export interface GeniusVersion {
  id: string
  workspaceId: string
  number: number
  kind: 'build' | 'patch' | 'restore'
  summary: string
  request?: string
  createdAt: string
  actor: string
  correlationId?: string
  compilerVersion: string
  schemaVersion: number
  revisionBefore: string
  revisionAfter: string
  /** idempotency key of the job that produced it: a retry returns this version instead of building twice */
  jobKey: string
  keys: KeyChange[]
  before: ComponentSet
  /** nav entries added/removed so undo can put the sidebar back */
  navAdded: string[]
  navRemoved: NavItem[]
  afterFingerprints: Record<string, string>
  changes: Change[]
  warnings: string[]
  undone?: { at: string; by: string }
  /** the proposal that produced it */
  proposalId?: string
}

export type ProposalState = 'draft' | 'validated' | 'accepted' | 'rejected' | 'failed' | 'superseded'

export interface Proposal {
  id: string
  workspaceId: string
  createdAt: string
  request: string
  intent: string
  kind: 'build' | 'patch'
  state: ProposalState
  blueprint?: Blueprint
  patch?: Patch
  baseRevision: string
  /** fingerprint of every component the ops touch, at the time the proposal was designed */
  baseFingerprints: Record<string, string>
  summary: string
  assumptions: string[]
  questions: Question[]
  issues: Issue[]
  notImplementable: Issue[]
  changes: Change[]
  warnings: string[]
  navAdds: NavAdd[]
  needsApproval: { workflowId: string; name: string; reasons: string[] }[]
  model?: { fast?: string; strong?: string; used: string[] }
  correlationId?: string
  repairAttempts: number
  usage?: UsageTotals
  decidedAt?: string
  decidedBy?: string
  versionId?: string
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  calls: number
  latencyMs: number
  /** 'groq' = reported by the provider, 'mock' = from a test double */
  source: 'groq' | 'mock'
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  workspaceId: string
  action:
    | 'proposal_created'
    | 'proposal_accepted'
    | 'proposal_rejected'
    | 'config_changed'
    | 'permission_changed'
    | 'destructive_change'
    | 'workflow_approved'
    | 'workflow_enabled'
    | 'workflow_disabled'
    | 'version_undone'
    | 'version_restored'
    | 'ai_request'
    | 'dry_run'
  target: string
  detail: string
  correlationId?: string
  prevHash: string
  hash: string
}

export interface QuestionAnswer {
  questionId: string
  question: string
  answer: string
  at: string
}

/** What Genius remembers about a workspace's project between requests (tenant scoped by storage namespace). */
export interface ProjectMemory {
  workspaceId: string
  domain?: string
  /** durable requirements understood so far; the user never has to repeat them */
  requirements: string[]
  answers: QuestionAnswer[]
  pendingQuestions: Question[]
  assumptions: string[]
  requests: { at: string; text: string; intent: string }[]
}

export interface GeniusPersisted {
  v: 1
  versions: GeniusVersion[]
  proposals: Proposal[]
  audit: AuditEntry[]
  memory: Record<string, ProjectMemory>
}

export const emptyGenius = (): GeniusPersisted => ({ v: 1, versions: [], proposals: [], audit: [], memory: {} })
