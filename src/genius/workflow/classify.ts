import type { Module, Workflow } from '#/types'
import { ACTION_REGISTRY } from '../registry'

export interface Classification {
  consequential: boolean
  reasons: string[]
}

/** Holds money as data (transactions/ledgers or stored currency fields). A module that merely DISPLAYS a calculated balance is not financial data. */
export const isFinancialModule = (m: Module | undefined): boolean => !!m && (m.kind === 'transaction' || m.kind === 'ledger' || m.fields.some((f) => f.type === 'currency'))

/**
 * A workflow is "consequential" when switching it on can change money-related records, create records outside
 * the triggering module, or run across every record on a timer. Those need explicit user approval before they run.
 */
export function classifyWorkflow(wf: Pick<Workflow, 'moduleId' | 'trigger' | 'actions'>, modules: Module[]): Classification {
  const reasons: string[] = []
  const byId = new Map(modules.map((m) => [m.id, m]))
  const own = byId.get(wf.moduleId)
  if (isFinancialModule(own)) reasons.push(`runs on financial records (${own!.name})`)
  for (const a of wf.actions) {
    if (ACTION_REGISTRY[a.type]?.consequential) reasons.push(`"${ACTION_REGISTRY[a.type].label}" creates records outside the triggering record`)
    const target = a.moduleId ? byId.get(a.moduleId) : undefined
    if (target && isFinancialModule(target) && target.id !== own?.id) reasons.push(`creates records in financial module ${target.name}`)
    const f = own?.fields.find((x) => x.id === a.fieldId)
    if (f && (f.type === 'currency' || (f.type === 'formula' && f.formulaSpec?.resultType === 'money'))) reasons.push(`changes the money field "${f.label}"`)
  }
  if (wf.trigger.type === 'scheduled') reasons.push('runs on a timer across every record of the module')
  const unique = [...new Set(reasons)]
  return { consequential: unique.length > 0, reasons: unique }
}
