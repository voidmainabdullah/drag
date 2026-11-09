export type Stage = 'schema' | 'references' | 'business' | 'cycles' | 'security' | 'sandbox'
export const STAGE_ORDER: Stage[] = ['schema', 'references', 'business', 'cycles', 'security', 'sandbox']

/** Structured validation error: stable code, component path, description, severity, repair guidance. */
export interface Issue {
  code: string
  path: string
  message: string
  severity: 'error' | 'warning'
  repair: string
  stage: Stage
  /** the request asked for something this app cannot execute; the component is left out and reported */
  notImplementable?: boolean
}

export const issue = (stage: Stage, code: string, path: string, message: string, repair: string, severity: Issue['severity'] = 'error'): Issue => ({ stage, code, path, message, repair, severity })

export interface ValidationReport {
  ok: boolean
  errors: Issue[]
  warnings: Issue[]
  notImplementable: Issue[]
  stagesRun: Stage[]
  sandbox?: { ran: boolean; syntheticRecords: number; limitations: string[] }
}

export function report(issues: Issue[], stagesRun: Stage[], sandbox?: ValidationReport['sandbox']): ValidationReport {
  const notImplementable = issues.filter((i) => i.notImplementable)
  const rest = issues.filter((i) => !i.notImplementable)
  const errors = rest.filter((i) => i.severity === 'error')
  return { ok: errors.length === 0, errors, warnings: rest.filter((i) => i.severity === 'warning'), notImplementable, stagesRun, sandbox }
}

/** Stable signature of a set of errors: used to detect a repair that did not change anything. */
export function errorSignature(errors: Issue[]): string {
  return errors
    .map((e) => `${e.code}@${e.path}`)
    .sort()
    .join('|')
}
