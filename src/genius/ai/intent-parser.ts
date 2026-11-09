/**
 * Deterministic intent classification: no model call, same input => same output.
 * Eight intents. The three read-only ones (question, explain_calculation, simulate_workflow) never mutate anything.
 */
export type Intent = 'new_build' | 'modify' | 'question' | 'explain_calculation' | 'simulate_workflow' | 'repair' | 'restore_version' | 'delete_or_deactivate'

export const INTENTS: Intent[] = ['new_build', 'modify', 'question', 'explain_calculation', 'simulate_workflow', 'repair', 'restore_version', 'delete_or_deactivate']

export interface IntentContext {
  /** the workspace already has modules (so "create X" may be an addition, not a first build) */
  hasModules: boolean
  /** names of existing modules/fields/workflows used to tell "create a CRM" from "create a field" */
  knownNames?: string[]
  hasVersions?: boolean
}

export interface IntentResult {
  intent: Intent
  readOnly: boolean
  /** 0..1, how sure the rules are; low confidence routes to the strong model with a clarification allowed */
  confidence: number
  /** every rule that fired, for debugging and tests */
  signals: string[]
  /** a destructive request that must show a dependency report before anything is applied */
  destructive: boolean
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()

const RESTORE = /\b(undo|roll ?back|revert|restore)\b|\bgo back to (the )?(previous|last|earlier|old|version)|\b(previous|last|earlier|old) version\b/
const DELETE = /\b(delete|remove|drop|get rid of|deactivate|archive|turn off|switch off|disable|stop using|erase)\b/
const EXPLAIN = /\bhow (is|are|was|does|do) .{0,80}\b(calculated|computed|worked out|figured out|derived|worked)\b|\b(explain|show me how|walk me through|why is|why does|why are)\b.{0,80}\b(formula|calculation|calculated|total|balance|outstanding|amount|percentage|status|score|number|figure|value|showing|zero|negative|wrong)\b|\bwhat does .{0,60}\bformula\b/
const SIMULATE = /\b(simulate|dry[- ]?run|preview|test(?: run)?|what (would|will) happen|try out|trial run)\b.{0,80}\b(workflow|automation|reminder|rule|trigger|flow)\b|\b(workflow|automation|reminder|rule)\b.{0,60}\b(simulate|dry[- ]?run|preview|what would happen|what will happen)\b/
const REPAIR = /\b(fix|repair|broken|isn'?t working|not working|doesn'?t work|stopped working|keeps failing|error|wrong result|incorrect)\b/
const BUILD_VERB = /\b(create|build|set ?up|make|generate|design|start|need|want|i'?d like)\b/
const SYSTEM_NOUN = /\b(crm|system|app|application|tracker|database|workspace|platform|portal|management|manager)\b/
const MODIFY_VERB = /\b(add|change|rename|update|modify|edit|make|set|move|replace|include|extend|split|merge|reorder|link|connect|require|allow|let|hide|show|enable|turn on|schedule|remind|notify|assign|calculate|track|group|sort|filter)\b/
const QUESTION_START = /^(what|which|who|whom|whose|where|when|why|how many|how much|how|is|are|do|does|did|can|could|should|would|will|show me|tell me|list|give me|count)\b/
const MUTATING_QUESTION = /^(can|could|would|will|should) (you|we|i|it)\b.*\b(add|create|make|build|change|rename|remove|delete|set|update|link|include|let)\b/

export function parseIntent(input: string, ctx: IntentContext): IntentResult {
  const t = norm(input)
  const signals: string[] = []
  const done = (intent: Intent, confidence: number, destructive = false): IntentResult => ({ intent, readOnly: intent === 'question' || intent === 'explain_calculation' || intent === 'simulate_workflow', confidence, signals, destructive })

  if (!t) return done('question', 0.2)

  if (RESTORE.test(t) && ctx.hasModules) {
    signals.push('restore-words')
    return done('restore_version', ctx.hasVersions === false ? 0.6 : 0.9)
  }
  if (SIMULATE.test(t)) {
    signals.push('simulate-words')
    return done('simulate_workflow', 0.9)
  }
  if (EXPLAIN.test(t) && !MUTATING_QUESTION.test(t)) {
    signals.push('explain-words')
    return done('explain_calculation', 0.85)
  }
  if (DELETE.test(t) && ctx.hasModules) {
    // "remove the late fee field" is destructive; "remove duplicates" in a question is not, so require a component noun
    if (/\b(module|field|column|workflow|automation|form|view|dashboard|widget|role|pipeline|stage|relationship|formula|table|section|tab|rule|reminder|option)\b/.test(t) || (ctx.knownNames ?? []).some((n) => n && t.includes(n.toLowerCase()))) {
      signals.push('delete-words')
      return done('delete_or_deactivate', 0.85, true)
    }
  }
  if (REPAIR.test(t) && ctx.hasModules && !QUESTION_START.test(t)) {
    signals.push('repair-words')
    return done('repair', 0.7)
  }

  const isQuestion = QUESTION_START.test(t) || t.endsWith('?')
  if (isQuestion && !MUTATING_QUESTION.test(t) && !(BUILD_VERB.test(t) && SYSTEM_NOUN.test(t))) {
    signals.push('question-form')
    return done('question', 0.8)
  }

  if (!ctx.hasModules) {
    signals.push('empty-workspace')
    const explicit = BUILD_VERB.test(t) && SYSTEM_NOUN.test(t)
    return done('new_build', explicit ? 0.9 : 0.65)
  }
  if (BUILD_VERB.test(t) && SYSTEM_NOUN.test(t) && /\b(new|another|separate|whole|entire|complete|full|from scratch)\b/.test(t)) {
    signals.push('explicit-new-system')
    return done('new_build', 0.7)
  }
  if (MODIFY_VERB.test(t)) {
    signals.push('modify-verb')
    return done('modify', 0.8)
  }
  signals.push('default-modify')
  return done('modify', 0.45)
}

/** Questions that must never reach an LLM write path, whatever the model says. */
export const isMutating = (i: Intent) => !(i === 'question' || i === 'explain_calculation' || i === 'simulate_workflow')
