import { estimateTokens } from './observability'
import type { RetrievedContext } from './context-retriever'

/**
 * Keeps the variable part of a prompt inside a token budget without losing anything the validator will need.
 * Drops, in this order (least valuable first): dashboards' widget lists, view/form lists, the module outline,
 * compact dependency modules' options, then workflows of non-selected modules. The selected ("full") modules,
 * their direct dependencies' ids/fields and the dependents list are NEVER dropped: if even those do not fit, the
 * result says so (`fits: false`) and the caller must split the request instead of sending a lossy context.
 */
export interface FitResult {
  context: RetrievedContext
  tokens: number
  dropped: string[]
  fits: boolean
}

const size = (c: RetrievedContext) => estimateTokens(JSON.stringify(c))

export function fitContext(ctx: RetrievedContext, budgetTokens: number): FitResult {
  let c: RetrievedContext = structuredClone(ctx)
  const dropped: string[] = []
  const steps: [string, (x: RetrievedContext) => void][] = [
    ['dashboard widget lists', (x) => x.dashboards.forEach((d) => (d.widgets = []))],
    ['view and form lists', (x) => { x.views = []; x.forms = [] }],
    ['module outline', (x) => { x.outline = [] }],
    ['options of dependency modules', (x) => x.modules.filter((m) => m.detail === 'compact').forEach((m) => m.fields.forEach((f) => delete f.options))],
    ['workflows of dependency modules', (x) => { const full = new Set(x.modules.filter((m) => m.detail === 'full').map((m) => m.id)); x.workflows = x.workflows.filter((w) => full.has(w.module)) }],
  ]
  for (const [name, apply] of steps) {
    if (size(c) <= budgetTokens) break
    apply(c)
    dropped.push(name)
  }
  const tokens = size(c)
  return { context: c, tokens, dropped, fits: tokens <= budgetTokens }
}

/** Trim over-long free text (a pasted document) to a safe length, keeping the start and the end. */
export function clampRequest(text: string, maxChars = 4000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const head = Math.floor(maxChars * 0.7)
  return { text: `${text.slice(0, head)}\n[...${text.length - maxChars} characters omitted...]\n${text.slice(text.length - (maxChars - head))}`, truncated: true }
}
