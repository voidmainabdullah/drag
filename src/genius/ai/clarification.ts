import type { Question } from '../blueprint/schema'
import type { QuestionAnswer } from '../state/types'
import type { Intent } from './intent-parser'

/**
 * Clarification policy: ask the fewest questions, never twice, and only where a wrong guess is costly
 * (money, currency, destructive scope). Everything low-risk gets a safe default listed as an assumption.
 */
export const MAX_QUESTIONS = 4
export const MAX_PREFLIGHT_QUESTIONS = 2

const MONEY = /\b(fee|fees|payment|payments|invoice|invoices|refund|price|pricing|rent|salary|payroll|commission|deposit|balance|outstanding|cost|revenue|budget|tax|vat|charge|charges)\b/i
const CURRENCY_NAMED = /[£$€¥₹]|\b(gbp|usd|eur|aud|cad|nzd|chf|inr|jpy|cny|aed|zar|sek|nok|dkk|pounds?|dollars?|euros?|sterling|rupees?|yen|dirhams?|rand)\b/i

export interface ClarifyInput {
  request: string
  intent: Intent
  answeredIds: Set<string>
  /** ISO code if the workspace already has one (an existing currency field, or a remembered answer) */
  knownCurrency?: string
  /** the user already described the business in some detail */
  detailedEnough?: boolean
}

export interface Preflight {
  questions: Question[]
  assumptions: string[]
}

export function preflight(i: ClarifyInput): Preflight {
  const questions: Question[] = []
  const assumptions: string[] = []
  const meaningful = i.request.split(/\s+/).filter((w) => w.length > 2).length

  if (i.intent === 'new_build' && meaningful < 3 && !i.answeredIds.has('business_type')) {
    questions.push({ id: 'business_type', question: 'What kind of business or team is this CRM for?', why: 'The request is too short to design anything useful.', options: [], safeDefault: undefined })
  }
  if ((i.intent === 'new_build' || i.intent === 'modify') && MONEY.test(i.request) && !CURRENCY_NAMED.test(i.request) && !i.knownCurrency && !i.answeredIds.has('currency')) {
    questions.push({ id: 'currency', question: 'Which currency should amounts use?', why: 'Money fields and totals need one currency; there is no automatic conversion.', options: ['GBP', 'USD', 'EUR', 'AUD', 'CAD'], safeDefault: undefined })
  } else if (i.knownCurrency) {
    assumptions.push(`Amounts use ${i.knownCurrency}.`)
  }
  return { questions: questions.slice(0, MAX_PREFLIGHT_QUESTIONS), assumptions }
}

/** Drop questions already answered or already queued, and cap the total. Answers the user gave are never asked again. */
export function filterQuestions(asked: Question[], answers: QuestionAnswer[], extra: Question[] = []): Question[] {
  const answered = new Set(answers.map((a) => a.questionId))
  const answeredText = new Set(answers.map((a) => a.question.trim().toLowerCase()))
  const seen = new Set<string>()
  const out: Question[] = []
  for (const q of [...extra, ...asked]) {
    const text = q.question.trim().toLowerCase()
    if (answered.has(q.id) || answeredText.has(text) || seen.has(q.id) || seen.has(text)) continue
    seen.add(q.id)
    seen.add(text)
    out.push(q)
    if (out.length >= MAX_QUESTIONS) break
  }
  return out
}

/** Answers become part of the request context for the next call, so the user never repeats themselves. */
export function answersAsRequirements(answers: QuestionAnswer[]): string[] {
  return answers.map((a) => `${a.question} -> ${a.answer}`)
}

export function currencyFromAnswers(answers: QuestionAnswer[]): string | undefined {
  const a = answers.find((x) => x.questionId === 'currency')?.answer.trim().toUpperCase()
  return a && /^[A-Z]{3}$/.test(a) ? a : undefined
}
