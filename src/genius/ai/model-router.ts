import type { Intent } from './intent-parser'
import type { ModelSet } from './models'

/**
 * Chooses the cheapest thing that can do the job:
 *   none   - deterministic code answers (explain a formula, simulate a workflow, undo, simple rename...). No model call.
 *   fast   - small model: questions, small additive patches.
 *   strong - large model: new builds, financial formulas, complex workflows, repairs, ambiguity.
 * The router is a pure function of the request, the intent and a few measured signals, so it is testable and explainable.
 */
export type Tier = 'none' | 'fast' | 'strong'

export interface RouteSignals {
  intent: Intent
  request: string
  confidence: number
  /** how many modules the retrieved context names in full detail */
  selectedModules: number
  /** attempt number of the repair loop (0 = first generation) */
  repairAttempt?: number
  /** a deterministic handler already produced the answer */
  deterministic?: boolean
  /** the fast model produced a truncated or invalid answer already */
  escalated?: boolean
}

export interface Route {
  tier: Tier
  reason: string
}

const FINANCIAL = /\b(fee|fees|payment|payments|invoice|invoices|refund|refunds|overdue|balance|outstanding|commission|profit|revenue|tax|vat|currency|price|pricing|salary|payroll|rent|deposit|allocation|discount|fine|fines|interest|late fee)\b/i
const COMPLEX_FLOW = /\b(if .* then|unless|escalat|approval|approve|multi.?step|several steps|chain|cascade|schedule[d]?|every (day|week|month)|after \d+ (day|week|month)|reminder)\b/i
const FORMULA = /\b(formula|calculate|calculated|calculation|computed|total|sum of|percentage|rate|average)\b/i

export function routeModel(s: RouteSignals): Route {
  if (s.deterministic) return { tier: 'none', reason: 'handled by deterministic code' }
  if (s.intent === 'explain_calculation' || s.intent === 'simulate_workflow' || s.intent === 'restore_version') return { tier: 'none', reason: `${s.intent} is answered from the stored configuration` }
  if (s.escalated) return { tier: 'strong', reason: 'escalated after the fast model failed' }
  if (s.intent === 'repair' || (s.repairAttempt ?? 0) > 0) return { tier: 'strong', reason: 'repair needs the strongest model' }
  if (s.intent === 'new_build') return { tier: 'strong', reason: 'a new build designs many connected components' }
  if (s.intent === 'question') return { tier: 'fast', reason: 'a read-only question' }
  if (s.confidence < 0.5) return { tier: 'strong', reason: 'the request is ambiguous' }
  if (FINANCIAL.test(s.request) && (FORMULA.test(s.request) || COMPLEX_FLOW.test(s.request))) return { tier: 'strong', reason: 'financial logic must be exact' }
  if (COMPLEX_FLOW.test(s.request) || s.selectedModules >= 4) return { tier: 'strong', reason: 'complex workflow or many modules' }
  if (s.request.length > 600) return { tier: 'strong', reason: 'a long, detailed request' }
  return { tier: 'fast', reason: 'a small, well-scoped change' }
}

export const modelIdFor = (tier: Exclude<Tier, 'none'>, models: ModelSet): string => (tier === 'fast' ? models.fast.id : models.strong.id)
