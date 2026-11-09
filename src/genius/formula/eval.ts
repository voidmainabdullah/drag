import { Decimal, DIV_SCALE } from './decimal'
import type { FormulaSpec, Node } from './ast'
import { parseExpression } from './parser'

export type Value = Decimal | string | boolean | null

export class FormulaEvalError extends Error {
  constructor(
    public code: 'DIVISION_BY_ZERO' | 'NULL_INPUT' | 'TYPE_MISMATCH' | 'CYCLE' | 'UNKNOWN_FIELD' | 'UNKNOWN_MODULE' | 'LIMIT' | 'BAD_FUNCTION',
    message: string,
  ) {
    super(message)
  }
}

export interface FieldInfo {
  id: string
  type: string
  currency?: string
  formulaSpec?: FormulaSpec
  relation?: { moduleId: string; cardinality?: string }
}
export interface RecData {
  id: string
  data: Record<string, unknown>
}

/** What the evaluator needs from the host. Implemented over zustand records in the app and over plain arrays in tests. */
export interface FormulaHost {
  field(moduleId: string, fieldId: string): FieldInfo | undefined
  hasModule(moduleId: string): boolean
  /** records of `moduleId` whose relationship field `viaFieldId` references `targetRecordId` (live, non-deleted only) */
  reverse(moduleId: string, viaFieldId: string, targetRecordId: string): RecData[]
  /** records referenced by relationship field `fieldId` of `record` (live, non-deleted only) */
  linked(moduleId: string, fieldId: string, record: RecData): RecData[]
  /** fallback for formula fields that have no spec (legacy float formulas) */
  legacyFormula?(moduleId: string, fieldId: string, record: RecData): unknown
  today: string
}

const NUMERIC_TYPES = new Set(['number', 'currency', 'percentage', 'rating'])
const MAX_AGG_RECORDS = 20000
const MAX_STEPS = 200000

interface Ctx {
  host: FormulaHost
  moduleId: string
  rec: RecData
  spec: Pick<FormulaSpec, 'nullBehavior' | 'divByZero'>
  stack: string[]
  steps: { n: number }
  memo: Map<string, Value>
}

/** Raw stored value -> engine value. Blank/undefined => null (never silently zero). */
function fromRaw(field: FieldInfo | undefined, raw: unknown): Value {
  if (raw === null || raw === undefined || raw === '') return null
  if (field && NUMERIC_TYPES.has(field.type)) {
    const d = Decimal.parse(raw as string | number)
    if (!d) throw new FormulaEvalError('TYPE_MISMATCH', `"${String(raw)}" is not a number`)
    return d
  }
  if (field?.type === 'formula') {
    const d = typeof raw === 'number' ? Decimal.parse(raw) : null
    return d ?? (typeof raw === 'string' || typeof raw === 'boolean' ? raw : null)
  }
  if (typeof raw === 'boolean' || typeof raw === 'string') return raw
  if (typeof raw === 'number') return Decimal.parse(raw)
  if (Array.isArray(raw)) return raw.length === 0 ? null : raw.map(String).join(',')
  return null
}

function fieldValue(c: Ctx, fieldId: string): Value {
  const info = c.host.field(c.moduleId, fieldId)
  if (!info) throw new FormulaEvalError('UNKNOWN_FIELD', `Unknown field "${fieldId}"`)
  if (info.type === 'formula') {
    const key = `${c.moduleId}|${c.rec.id}|${fieldId}`
    const cached = c.memo.get(key)
    if (cached !== undefined) return cached
    if (c.stack.includes(key)) throw new FormulaEvalError('CYCLE', `Circular formula at "${fieldId}"`)
    let v: Value
    if (info.formulaSpec) {
      c.stack.push(key)
      try {
        v = evalSpec(info.formulaSpec, { ...c, spec: info.formulaSpec })
      } finally {
        c.stack.pop()
      }
    } else if (c.host.legacyFormula) {
      v = fromRaw(info, c.host.legacyFormula(c.moduleId, fieldId, c.rec))
    } else v = null
    c.memo.set(key, v)
    return v
  }
  return fromRaw(info, c.rec.data[fieldId])
}

function tick(c: Ctx) {
  if (++c.steps.n > MAX_STEPS) throw new FormulaEvalError('LIMIT', 'Calculation is too large')
}

function arith(c: Ctx, a: Value, b: Value, op: '+' | '-' | '*' | '/'): Value {
  const resolve = (v: Value): Decimal | null => {
    if (v === null) {
      if (c.spec.nullBehavior === 'zero') return Decimal.ZERO
      if (c.spec.nullBehavior === 'error') throw new FormulaEvalError('NULL_INPUT', 'A value used in the calculation is empty')
      return null
    }
    if (v instanceof Decimal) return v
    throw new FormulaEvalError('TYPE_MISMATCH', `Cannot use ${typeof v === 'string' ? 'text' : 'a yes/no value'} in arithmetic`)
  }
  const x = resolve(a)
  const y = resolve(b)
  if (x === null || y === null) return null
  switch (op) {
    case '+':
      return x.add(y)
    case '-':
      return x.sub(y)
    case '*':
      return x.mul(y)
    case '/':
      if (y.isZero()) {
        if (c.spec.divByZero === 'error') throw new FormulaEvalError('DIVISION_BY_ZERO', 'Division by zero')
        return c.spec.divByZero === 'zero' ? Decimal.ZERO : null
      }
      return x.div(y, DIV_SCALE)
  }
}

const truthy = (v: Value): boolean => (v instanceof Decimal ? !v.isZero() : typeof v === 'string' ? v !== '' : Boolean(v))

function compare(a: Value, b: Value, op: '==' | '!=' | '<' | '<=' | '>' | '>='): boolean {
  if (op === '==' || op === '!=') {
    let eq: boolean
    if (a === null || b === null) eq = a === b
    else if (a instanceof Decimal && b instanceof Decimal) eq = a.eq(b)
    else if (a instanceof Decimal || b instanceof Decimal) {
      const other = a instanceof Decimal ? b : a
      const d = typeof other === 'string' ? Decimal.parse(other) : null
      eq = d ? d.eq((a instanceof Decimal ? a : b) as Decimal) : false
    } else eq = a === b
    return op === '==' ? eq : !eq
  }
  if (a === null || b === null) return false // ordering against an empty value is never true
  let c: number
  if (a instanceof Decimal && b instanceof Decimal) c = a.cmp(b)
  else if (typeof a === 'string' && typeof b === 'string') c = a < b ? -1 : a > b ? 1 : 0
  else throw new FormulaEvalError('TYPE_MISMATCH', 'Cannot compare values of different kinds')
  return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0
}

function dayNumber(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000)
}

function evalAgg(c: Ctx, n: Extract<Node, { t: 'agg' }>): Value {
  let rows: RecData[]
  let rowModule: string
  if (n.dir === 'reverse') {
    if (!c.host.hasModule(n.module!)) throw new FormulaEvalError('UNKNOWN_MODULE', `Unknown module "${n.module}"`)
    rowModule = n.module!
    if (!c.host.field(rowModule, n.via)) throw new FormulaEvalError('UNKNOWN_FIELD', `Unknown field "${n.via}" in ${rowModule}`)
    rows = c.host.reverse(rowModule, n.via, c.rec.id)
  } else {
    const rel = c.host.field(c.moduleId, n.via)
    if (!rel?.relation) throw new FormulaEvalError('UNKNOWN_FIELD', `"${n.via}" is not a relationship field`)
    rowModule = rel.relation.moduleId
    rows = c.host.linked(c.moduleId, n.via, c.rec)
  }
  // never double count: one row per record id, no matter how often it is referenced
  const seen = new Set<string>()
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  if (unique.length > MAX_AGG_RECORDS) throw new FormulaEvalError('LIMIT', 'Too many related records')
  const matched = n.where
    ? unique.filter((r) => {
        tick(c)
        return truthy(evalNode(n.where!, { ...c, moduleId: rowModule, rec: r }))
      })
    : unique
  if (n.fn === 'count') return Decimal.of(BigInt(matched.length))
  const values: Decimal[] = []
  for (const r of matched) {
    tick(c)
    const v = fieldValue({ ...c, moduleId: rowModule, rec: r }, n.of!)
    if (v === null) {
      if (c.spec.nullBehavior === 'error') throw new FormulaEvalError('NULL_INPUT', `Empty "${n.of}" on a related record`)
      continue
    }
    if (!(v instanceof Decimal)) throw new FormulaEvalError('TYPE_MISMATCH', `"${n.of}" is not numeric`)
    values.push(v)
  }
  switch (n.fn) {
    case 'sum':
      return values.reduce((s, v) => s.add(v), Decimal.ZERO) // empty collection => 0 (not null)
    case 'avg':
      return values.length ? values.reduce((s, v) => s.add(v), Decimal.ZERO).div(Decimal.of(BigInt(values.length))) : null
    case 'min':
      return values.length ? values.reduce((m, v) => (v.cmp(m) < 0 ? v : m)) : null
    case 'max':
      return values.length ? values.reduce((m, v) => (v.cmp(m) > 0 ? v : m)) : null
  }
  return null
}

function evalNode(n: Node, c: Ctx): Value {
  tick(c)
  switch (n.t) {
    case 'num':
      return Decimal.parse(n.v)!
    case 'str':
      return n.v
    case 'bool':
      return n.v
    case 'null':
      return null
    case 'ref':
      return fieldValue(c, n.f)
    case 'un': {
      const a = evalNode(n.a, c)
      if (n.op === 'not') return !truthy(a)
      if (a === null) {
        if (c.spec.nullBehavior === 'error') throw new FormulaEvalError('NULL_INPUT', 'A value used in the calculation is empty')
        return c.spec.nullBehavior === 'zero' ? Decimal.ZERO : null
      }
      if (!(a instanceof Decimal)) throw new FormulaEvalError('TYPE_MISMATCH', 'Cannot negate a non-number')
      return a.neg()
    }
    case 'bin': {
      if (n.op === 'and') return truthy(evalNode(n.a, c)) && truthy(evalNode(n.b, c))
      if (n.op === 'or') return truthy(evalNode(n.a, c)) || truthy(evalNode(n.b, c))
      const a = evalNode(n.a, c)
      const b = evalNode(n.b, c)
      if (n.op === '+' || n.op === '-' || n.op === '*' || n.op === '/') return arith(c, a, b, n.op)
      return compare(a, b, n.op)
    }
    case 'agg':
      return evalAgg(c, n)
    case 'call':
      return evalCall(n, c)
  }
}

function evalCall(n: Extract<Node, { t: 'call' }>, c: Ctx): Value {
  if (n.fn === 'IF') return truthy(evalNode(n.args[0], c)) ? evalNode(n.args[1], c) : evalNode(n.args[2], c)
  if (n.fn === 'COALESCE') {
    for (const a of n.args) {
      const v = evalNode(a, c)
      if (v !== null) return v
    }
    return null
  }
  const v = n.args.map((a) => evalNode(a, c))
  const num = (x: Value): Decimal | null => {
    if (x === null) return null
    if (x instanceof Decimal) return x
    throw new FormulaEvalError('TYPE_MISMATCH', `${n.fn} needs numbers`)
  }
  switch (n.fn) {
    case 'ISNULL':
      return v[0] === null
    case 'ABS': {
      const x = num(v[0])
      return x ? x.abs() : null
    }
    case 'ROUND': {
      const x = num(v[0])
      if (!x) return null
      const p = v[1] === undefined ? Decimal.ZERO : num(v[1])
      return x.round(p ? Number(p.toString()) : 0, 'half_up')
    }
    case 'MIN':
    case 'MAX': {
      const xs = v.map(num).filter((x): x is Decimal => x !== null)
      if (!xs.length) return null
      return xs.reduce((m, x) => ((n.fn === 'MIN' ? x.cmp(m) < 0 : x.cmp(m) > 0) ? x : m))
    }
    case 'CONCAT':
      return v.map((x) => (x === null ? '' : x instanceof Decimal ? x.toString() : String(x))).join('')
    case 'TODAY':
      return c.host.today
    case 'DAYS_BETWEEN': {
      if (v[0] === null || v[1] === null) return null
      const a = typeof v[0] === 'string' ? dayNumber(v[0]) : null
      const b = typeof v[1] === 'string' ? dayNumber(v[1]) : null
      if (a === null || b === null) throw new FormulaEvalError('TYPE_MISMATCH', 'DAYS_BETWEEN needs two dates')
      return Decimal.of(BigInt(b - a))
    }
    case 'SAFE_DIV': {
      const a = num(v[0])
      const b = num(v[1])
      if (!a || !b || b.isZero()) return v[2]
      return a.div(b, DIV_SCALE)
    }
    case 'PERCENT': {
      const a = num(v[0])
      const b = num(v[1])
      if (!a || !b) return null
      if (b.isZero()) {
        if (c.spec.divByZero === 'error') throw new FormulaEvalError('DIVISION_BY_ZERO', 'Total is zero')
        return c.spec.divByZero === 'zero' ? Decimal.ZERO : null
      }
      return a.div(b, DIV_SCALE).mul(Decimal.of(100n))
    }
  }
  throw new FormulaEvalError('BAD_FUNCTION', `Unknown function ${n.fn}`)
}

function evalSpec(spec: FormulaSpec, c: Ctx): Value {
  const ast = spec.ast ?? parseExpression(spec.expression)
  const raw = evalNode(ast, c)
  if (raw instanceof Decimal) {
    const places = spec.resultType === 'integer' ? 0 : spec.precision
    return raw.round(places, spec.rounding) // the ONE rounding step: after all exact arithmetic
  }
  return raw
}

export interface EvalResult {
  ok: boolean
  value: Value
  error?: { code: string; message: string }
}

/** Evaluate one formula field of one record. Never throws. */
export function evaluateFormulaField(host: FormulaHost, moduleId: string, rec: RecData, spec: FormulaSpec, memo = new Map<string, Value>()): EvalResult {
  const c: Ctx = { host, moduleId, rec, spec, stack: [`${moduleId}|${rec.id}|${spec.id}`], steps: { n: 0 }, memo }
  try {
    return { ok: true, value: evalSpec(spec, c) }
  } catch (e) {
    if (e instanceof FormulaEvalError) return { ok: false, value: null, error: { code: e.code, message: e.message } }
    if (e instanceof RangeError) return { ok: false, value: null, error: { code: 'DIVISION_BY_ZERO', message: e.message } }
    return { ok: false, value: null, error: { code: 'FORMULA_ERROR', message: e instanceof Error ? e.message : 'Calculation failed' } }
  }
}

/** Engine value -> JSON-safe value for display/storage. Decimals become strings with exactly `precision` digits. */
export function valueToJson(v: Value, spec?: Pick<FormulaSpec, 'precision' | 'resultType'>): string | boolean | null {
  if (v instanceof Decimal) return v.toString(spec ? (spec.resultType === 'integer' ? 0 : spec.precision) : undefined)
  return v
}
