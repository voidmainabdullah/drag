import type { RoundingMode } from './decimal'

/** Restricted expression AST. Never JavaScript, never SQL, never evaluated with eval/Function. */
export type BinOp = '+' | '-' | '*' | '/' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or'
export type AggFn = 'sum' | 'count' | 'avg' | 'min' | 'max'

export type Node =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'ref'; f: string }
  | { t: 'un'; op: 'neg' | 'not'; a: Node }
  | { t: 'bin'; op: BinOp; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] }
  /**
   * Aggregate over related records.
   * reverse: records of `module` whose relationship field `via` points at the current record (e.g. payments of a fee).
   * forward: records the current record links to through its own relationship field `via`.
   */
  | { t: 'agg'; fn: AggFn; dir: 'reverse' | 'forward'; module?: string; via: string; of?: string; where?: Node }

export type NullBehavior = 'zero' | 'null' | 'error'
export type DivByZero = 'null' | 'zero' | 'error'
export type ResultType = 'decimal' | 'money' | 'percentage' | 'integer' | 'text' | 'boolean' | 'date'

export interface FormulaTestCase {
  name: string
  /** values of the formula's own record, keyed by field id */
  record: Record<string, unknown>
  /** related records, keyed by module id, each with `id` and field values (relationship fields reference `$self` for the tested record) */
  related?: Record<string, Record<string, unknown>[]>
  /** the evaluation date, so "overdue" cases are deterministic */
  today?: string
  /** expected result as a decimal string / text / boolean; null = expected null */
  expected: string | boolean | null
}

/** Stored on a Field (`formulaSpec`) and in a blueprint. `ast` is always derived from `expression`. */
export interface FormulaSpec {
  id: string
  /** restricted expression source, e.g. `{total_fees} + {fines} - SUM_REL(payments, fee, amount, {status} == "received")` */
  expression: string
  ast?: Node
  resultType: ResultType
  currency?: string
  /** decimal places of the result */
  precision: number
  rounding: RoundingMode
  nullBehavior: NullBehavior
  divByZero: DivByZero
  description?: string
  tests?: FormulaTestCase[]
}

export const MAX_EXPR_CHARS = 1500
export const MAX_NODES = 250
export const MAX_DEPTH = 24

export function walk(n: Node, fn: (n: Node, depth: number) => void, depth = 0): void {
  fn(n, depth)
  switch (n.t) {
    case 'un':
      walk(n.a, fn, depth + 1)
      break
    case 'bin':
      walk(n.a, fn, depth + 1)
      walk(n.b, fn, depth + 1)
      break
    case 'call':
      n.args.forEach((a) => walk(a, fn, depth + 1))
      break
    case 'agg':
      if (n.where) walk(n.where, fn, depth + 1)
      break
    default:
  }
}
