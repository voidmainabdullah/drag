import type { ID } from '#/types'
import { useWorkflowStore } from '#/stores/collections'
import { logPreview, previewWorkflow } from '../workflow/preview'
import { useGeniusStore } from '../state/geniusStore'
import type { GeniusVersion, QuestionAnswer } from '../state/types'
import { acceptProposal, approveWorkflow, currentActor, rejectProposal, restoreToVersion, setWorkflowEnabled, undoVersion, type AcceptResult, type UndoResult } from './builder'

/**
 * The user-facing actions of the builder. The configuration lives in the browser, so these run client-side against the
 * same stores the manual UI uses (there is no server copy of the CRM to act on). Each action is explicit about what the
 * user must have confirmed:
 *   - applying a proposal that deletes or removes something needs `confirmDestructive: true`
 *   - turning on an AI-built or consequential workflow needs `approved: true` AND a recorded dry run of that exact workflow
 */
export interface ApplyOptions {
  confirmDestructive?: boolean
}

export function applyProposal(id: string, opts: ApplyOptions = {}): AcceptResult {
  const p = useGeniusStore.getState().proposals.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'Proposal not found', issues: [] }
  const destructive = p.changes.filter((c) => c.destructive)
  if (destructive.length && !opts.confirmDestructive) return { ok: false, error: `This change removes or replaces things (${destructive.map((c) => c.label).slice(0, 3).join('; ')}). Confirm explicitly to apply it.`, issues: [] }
  return acceptProposal(id)
}

export { rejectProposal }

export const historyOf = (ws: ID): GeniusVersion[] => useGeniusStore.getState().versions.filter((v) => v.workspaceId === ws).sort((a, b) => b.number - a.number)

export function rollback(versionId: string, opts: { force?: boolean } = {}): UndoResult {
  return undoVersion(versionId, opts)
}

export function restore(ws: ID, number: number, opts: { force?: boolean } = {}) {
  return restoreToVersion(ws, number, opts)
}

/** Remember answers to clarifying questions so they are never asked again. */
export function answerQuestions(ws: ID, answers: QuestionAnswer[]) {
  useGeniusStore.getState().recordAnswers(ws, answers)
}

/** Run (and audit) a dry run so a person can look at it before approving. Reads only. */
export function reviewWorkflow(workflowId: string) {
  const wf = useWorkflowStore.getState().items.find((w) => w.id === workflowId)
  const p = previewWorkflow(workflowId)
  if (wf && p) logPreview(wf, p, currentActor().userId)
  return p
}

export type ActivateResult = { ok: true } | { ok: false; code: string; message: string }

export function activateWorkflow(workflowId: string, opts: { approved: boolean; note?: string }): ActivateResult {
  const wf = useWorkflowStore.getState().items.find((w) => w.id === workflowId)
  if (!wf) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found' }
  if (!opts.approved) return { ok: false, code: 'APPROVAL_REQUIRED', message: 'Switching a workflow on needs your explicit approval.' }
  const needsReview = wf.origin === 'ai' || !!wf.consequential
  if (needsReview) {
    const reviewed = useGeniusStore.getState().audit.some((a) => a.action === 'dry_run' && a.target === wf.id && a.at >= wf.updatedAt)
    if (!reviewed) return { ok: false, code: 'DRY_RUN_REQUIRED', message: 'Review the dry run of this workflow first, then approve it.' }
  }
  const a = approveWorkflow(workflowId, opts.note)
  if (!a.ok) return { ok: false, code: a.code, message: a.message }
  const e = setWorkflowEnabled(workflowId, true)
  return e.ok ? { ok: true } : { ok: false, code: e.code, message: e.message }
}
