import { walk, type FormulaSpec, type FormulaTestCase, type Node } from './ast'
import { evaluateFormulaField, valueToJson, type FieldInfo, type FormulaHost, type RecData } from './eval'
import { FormulaSyntaxError, parseExpression, renderExpression } from './parser'

export interface SchemaField extends FieldInfo {
  label?: string
}
export interface SchemaModule {
  id: string
  name?: string
  fields: SchemaField[]
}
export type FormulaSchema = (moduleId: string) => SchemaModule | undefined

export interface FormulaIssue {
  code: string
  message: string
}

export type Kind = 'number' | 'text' | 'boolean' | 'date' | 'null' | 'any'
export interface Typed {
  kind: Kind
  currency?: string
}

const NUMERIC = new Set(['number', 'currency', 'percentage', 'rating'])

export function kindOfField(f: SchemaField): Typed {
  if (NUMERIC.has(f.type)) return { kind: 'number', currency: f.type === 'currency' ? f.currency : undefined }
  if (f.type === 'date' || f.type === 'datetime') return { kind: 'date' }
  if (f.type === 'yesNo') return { kind: 'boolean' }
  if (f.type === 'formula') {
    const s = f.formulaSpec
    if (!s) return { kind: 'any' }
    switch (s.resultType) {
      case 'text':
        return { kind: 'text' }
      case 'boolean':
        return { kind: 'boolean' }
      case 'date':
        return { kind: 'date' }
      default:
        return { kind: 'number', currency: s.resultType === 'money' ? s.currency : undefined }
    }
  }
  return { kind: 'text' }
}

const comparable = (a: Kind, b: Kind) => a === 'any' || b === 'any' || a === 'null' || b === 'null' || a === b || (a === 'text' && b === 'date') || (a === 'date' && b === 'text')

/** Static type check of an expression against real field definitions. Pure; returns every problem found. */
export function typeCheck(node: Node, moduleId: string, schema: FormulaSchema): { type: Typed; issues: FormulaIssue[] } {
  const issues: FormulaIssue[] = []
  const bad = (code: string, message: string) => issues.push({ code, message })

  const go = (n: Node, mod: string): Typed => {
    switch (n.t) {
      case 'num':
        return { kind: 'number' }
      case 'str':
        return { kind: 'text' }
      case 'bool':
        return { kind: 'boolean' }
      case 'null':
        return { kind: 'null' }
      case 'ref': {
        const f = schema(mod)?.fields.find((x) => x.id === n.f)
        if (!f) {
          bad('FORMULA_UNKNOWN_FIELD', `Field "${n.f}" does not exist in module "${mod}"`)
          return { kind: 'any' }
        }
        return kindOfField(f)
      }
      case 'un': {
        const a = go(n.a, mod)
        if (n.op === 'neg' && a.kind !== 'number' && a.kind !== 'any' && a.kind !== 'null') bad('FORMULA_TYPE_MISMATCH', 'Only numbers can be negated')
        return n.op === 'neg' ? a : { kind: 'boolean' }
      }
      case 'bin': {
        const a = go(n.a, mod)
        const b = go(n.b, mod)
        if (n.op === 'and' || n.op === 'or') return { kind: 'boolean' }
        if (['==', '!=', '<', '<=', '>', '>='].includes(n.op)) {
          if (!comparable(a.kind, b.kind)) bad('FORMULA_TYPE_MISMATCH', `Cannot compare ${a.kind} with ${b.kind}`)
          if (!['==', '!='].includes(n.op) && (a.kind === 'boolean' || b.kind === 'boolean')) bad('FORMULA_TYPE_MISMATCH', 'Yes/No values cannot be ordered')
          return { kind: 'boolean' }
        }
        for (const t of [a, b]) if (t.kind !== 'number' && t.kind !== 'any' && t.kind !== 'null') bad('FORMULA_TYPE_MISMATCH', `Arithmetic needs numbers, got ${t.kind}`)
        if (a.currency && b.currency && a.currency !== b.currency && (n.op === '+' || n.op === '-'))
          bad('FORMULA_CURRENCY_MIX', `Cannot combine ${a.currency} and ${b.currency}: no exchange-rate source is configured`)
        if (n.op === '+' || n.op === '-') return { kind: 'number', currency: a.currency ?? b.currency }
        if (n.op === '*') return { kind: 'number', currency: a.currency && b.currency ? undefined : (a.currency ?? b.currency) }
        return { kind: 'number', currency: b.currency ? undefined : a.currency }
      }
      case 'call': {
        const args = n.args.map((a) => go(a, mod))
        switch (n.fn) {
          case 'IF': {
            const [, x, y] = args
            if (!comparable(x.kind, y.kind)) bad('FORMULA_TYPE_MISMATCH', `IF branches return different kinds (${x.kind} / ${y.kind})`)
            return x.kind === 'null' ? y : x
          }
          case 'ROUND':
          case 'ABS':
            if (args[0].kind !== 'number' && args[0].kind !== 'any') bad('FORMULA_TYPE_MISMATCH', `${n.fn} needs a number`)
            return args[0]
          case 'MIN':
          case 'MAX':
          case 'COALESCE':
            return args.find((a) => a.kind !== 'null') ?? { kind: 'null' }
          case 'ISNULL':
            return { kind: 'boolean' }
          case 'CONCAT':
            return { kind: 'text' }
          case 'TODAY':
            return { kind: 'date' }
          case 'DAYS_BETWEEN':
            return { kind: 'number' }
          case 'SAFE_DIV':
          case 'PERCENT':
            return { kind: 'number' }
        }
        return { kind: 'any' }
      }
      case 'agg': {
        let rowModule: string
        if (n.dir === 'reverse') {
          rowModule = n.module!
          const rm = schema(rowModule)
          if (!rm) {
            bad('FORMULA_UNKNOWN_MODULE', `Module "${rowModule}" does not exist`)
            return { kind: 'number' }
          }
          const via = rm.fields.find((f) => f.id === n.via)
          if (!via?.relation) bad('FORMULA_BAD_AGGREGATE', `"${n.via}" in ${rowModule} is not a relationship field`)
          else if (via.relation.moduleId !== mod) bad('FORMULA_BAD_AGGREGATE', `"${n.via}" in ${rowModule} does not point at this module`)
        } else {
          const rel = schema(mod)?.fields.find((f) => f.id === n.via)
          if (!rel?.relation) {
            bad('FORMULA_BAD_AGGREGATE', `"${n.via}" is not a relationship field of this module`)
            return { kind: 'number' }
          }
          rowModule = rel.relation.moduleId
          if (!schema(rowModule)) {
            bad('FORMULA_UNKNOWN_MODULE', `Module "${rowModule}" does not exist`)
            return { kind: 'number' }
          }
        }
        if (n.where) go(n.where, rowModule)
        if (n.fn === 'count') return { kind: 'number' }
        const of = schema(rowModule)?.fields.find((f) => f.id === n.of)
        if (!of) {
          bad('FORMULA_UNKNOWN_FIELD', `Field "${n.of}" does not exist in module "${rowModule}"`)
          return { kind: 'number' }
        }
        const t = kindOfField(of)
        if (t.kind !== 'number' && t.kind !== 'any') bad('FORMULA_TYPE_MISMATCH', `${n.fn.toUpperCase()} needs a numeric field, "${n.of}" is ${t.kind}`)
        return { kind: 'number', currency: t.currency }
      }
    }
  }
  return { type: go(node, moduleId), issues }
}

export interface FieldRef {
  moduleId: string
  fieldId: string
}
export const refKey = (r: FieldRef) => `${r.moduleId}.${r.fieldId}`

/** Every field (in any module) a formula reads. Used for source declarations, impact analysis and cycle detection. */
export function dependenciesOf(node: Node, moduleId: string, schema: FormulaSchema): FieldRef[] {
  const out = new Map<string, FieldRef>()
  const add = (moduleId: string, fieldId: string) => out.set(`${moduleId}.${fieldId}`, { moduleId, fieldId })
  const go = (n: Node, mod: string) => {
    walk(n, (x) => {
      if (x.t === 'ref') add(mod, x.f)
      if (x.t === 'agg') {
        let rowModule: string | undefined
        if (x.dir === 'reverse') {
          rowModule = x.module
          if (rowModule) add(rowModule, x.via)
        } else {
          add(mod, x.via)
          rowModule = schema(mod)?.fields.find((f) => f.id === x.via)?.relation?.moduleId
        }
        if (rowModule && x.of) add(rowModule, x.of)
        if (rowModule && x.where) {
          const m = rowModule
          walk(x.where, (w) => {
            if (w.t === 'ref') add(m, w.f)
          })
        }
      }
    })
  }
  // agg.where refs are already added in the row-module scope; avoid mis-attributing them to the current module
  const stripWhere = (n: Node): Node => {
    switch (n.t) {
      case 'un':
        return { ...n, a: stripWhere(n.a) }
      case 'bin':
        return { ...n, a: stripWhere(n.a), b: stripWhere(n.b) }
      case 'call':
        return { ...n, args: n.args.map(stripWhere) }
      case 'agg':
        return { ...n, where: undefined }
      default:
        return n
    }
  }
  go(stripWhere(node), moduleId)
  // re-add where refs in the right scope
  walk(node, (x) => {
    if (x.t !== 'agg' || !x.where) return
    const rowModule = x.dir === 'reverse' ? x.module : schema(moduleId)?.fields.find((f) => f.id === x.via)?.relation?.moduleId
    if (!rowModule) return
    walk(x.where, (w) => {
      if (w.t === 'ref') add(rowModule, w.f)
    })
  })
  return [...out.values()]
}

export interface FormulaNode {
  moduleId: string
  fieldId: string
  deps: FieldRef[]
}

export interface GraphAnalysis {
  cycles: string[][]
  /** formulas in an order where every dependency is calculated before its dependents */
  order: string[]
}

/** Dependency graph over formula fields. Non-formula fields are leaves. */
export function analyseGraph(formulas: FormulaNode[]): GraphAnalysis {
  const nodes = new Map(formulas.map((f) => [refKey(f), f]))
  const state = new Map<string, 0 | 1 | 2>()
  const cycles: string[][] = []
  const order: string[] = []
  const visit = (key: string, path: string[]) => {
    const s = state.get(key)
    if (s === 2) return
    if (s === 1) {
      cycles.push([...path.slice(path.indexOf(key)), key])
      return
    }
    state.set(key, 1)
    const node = nodes.get(key)
    if (node) for (const d of node.deps) if (nodes.has(refKey(d))) visit(refKey(d), [...path, key])
    state.set(key, 2)
    if (node) order.push(key)
  }
  for (const key of nodes.keys()) visit(key, [])
  return { cycles, order }
}

/** Formula fields that must be recalculated (transitively) when any of `changed` changes. */
export function dependentsOf(formulas: FormulaNode[], changed: FieldRef[]): string[] {
  const hit = new Set(changed.map(refKey))
  let grew = true
  const out = new Set<string>()
  while (grew) {
    grew = false
    for (const f of formulas) {
      const k = refKey(f)
      if (out.has(k)) continue
      if (f.deps.some((d) => hit.has(refKey(d)))) {
        out.add(k)
        hit.add(k)
        grew = true
      }
    }
  }
  return [...out]
}

export interface Explanation {
  moduleId: string
  fieldId: string
  formula: string
  resultType: string
  currency?: string
  precision: number
  rounding: string
  nullBehavior: string
  divByZero: string
  description?: string
  sources: { moduleId: string; moduleName?: string; fieldId: string; label?: string; type?: string }[]
}

/** The real formula and the real source fields: derived from the stored spec, never narrated by a model. */
export function explainFormula(spec: FormulaSpec, moduleId: string, schema: FormulaSchema): Explanation {
  const ast = spec.ast ?? parseExpression(spec.expression)
  return {
    moduleId,
    fieldId: spec.id,
    formula: renderExpression(ast),
    resultType: spec.resultType,
    currency: spec.currency,
    precision: spec.precision,
    rounding: spec.rounding,
    nullBehavior: spec.nullBehavior,
    divByZero: spec.divByZero,
    description: spec.description,
    sources: dependenciesOf(ast, moduleId, schema).map((d) => {
      const m = schema(d.moduleId)
      const f = m?.fields.find((x) => x.id === d.fieldId)
      return { moduleId: d.moduleId, moduleName: m?.name, fieldId: d.fieldId, label: f?.label, type: f?.type }
    }),
  }
}

/** In-memory host for tests / formula test cases / dry-runs. */
export class MemoryHost implements FormulaHost {
  constructor(
    private modules: Record<string, SchemaField[]>,
    private records: { moduleId: string; id: string; data: Record<string, unknown> }[],
    public today: string,
  ) {}
  field(moduleId: string, fieldId: string) {
    return this.modules[moduleId]?.find((f) => f.id === fieldId)
  }
  hasModule(moduleId: string) {
    return moduleId in this.modules
  }
  private ids(v: unknown): string[] {
    return Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []
  }
  reverse(moduleId: string, viaFieldId: string, targetRecordId: string): RecData[] {
    return this.records.filter((r) => r.moduleId === moduleId && this.ids(r.data[viaFieldId]).includes(targetRecordId))
  }
  linked(moduleId: string, fieldId: string, record: RecData): RecData[] {
    const rel = this.field(moduleId, fieldId)?.relation?.moduleId
    if (!rel) return []
    const ids = this.ids(record.data[fieldId])
    return this.records.filter((r) => r.moduleId === rel && ids.includes(r.id))
  }
}

export interface TestOutcome {
  name: string
  pass: boolean
  expected: unknown
  actual: unknown
  error?: string
}

/** Run a spec's own deterministic test cases. "Parses" is not "correct": every case must produce its expected value. */
export function runFormulaTests(spec: FormulaSpec, moduleId: string, schema: FormulaSchema, cases: FormulaTestCase[] = spec.tests ?? []): TestOutcome[] {
  const mod = schema(moduleId)
  const modules: Record<string, SchemaField[]> = {}
  const collect = (id: string) => {
    if (modules[id]) return
    const m = schema(id)
    if (!m) return
    // the field under test must carry the spec being tested (it may not be stored yet)
    modules[id] = m.fields.map((f) => (id === moduleId && f.id === spec.id ? { ...f, type: 'formula', formulaSpec: spec } : f))
    for (const f of m.fields) {
      if (f.relation) collect(f.relation.moduleId)
      // formulas that this module's formulas depend on may aggregate other modules
      if (f.formulaSpec) collectSpec(f.formulaSpec)
    }
  }
  const collectSpec = (s: FormulaSpec) => {
    walk(s.ast ?? parseExpression(s.expression), (n) => {
      if (n.t === 'agg' && n.dir === 'reverse' && n.module) collect(n.module)
    })
  }
  collect(moduleId)
  collectSpec(spec)
  if (mod && !modules[moduleId].some((f) => f.id === spec.id)) modules[moduleId].push({ id: spec.id, type: 'formula', formulaSpec: spec })

  return cases.map((tc) => {
    const selfId = '$self'
    const records: { moduleId: string; id: string; data: Record<string, unknown> }[] = [{ moduleId, id: selfId, data: tc.record }]
    for (const [mid, rows] of Object.entries(tc.related ?? {})) {
      rows.forEach((row, i) => {
        const data = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '$self' ? selfId : v]))
        records.push({ moduleId: mid, id: String(row.id ?? `${mid}_${i}`), data })
      })
    }
    const host = new MemoryHost(modules, records, tc.today ?? '2026-01-15')
    const res = evaluateFormulaField(host, moduleId, records[0], spec)
    const actual = res.ok ? valueToJson(res.value, spec) : null
    const pass = res.ok && jsonEq(actual, tc.expected)
    return { name: tc.name, pass, expected: tc.expected, actual, error: res.ok ? undefined : res.error?.message }
  })
}

function jsonEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'string' && typeof b === 'string') {
    // decimal strings compare numerically ("100.00" equals "100")
    const x = Number(a)
    const y = Number(b)
    if (a.trim() !== '' && b.trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) return normalizeDec(a) === normalizeDec(b)
  }
  return false
}
function normalizeDec(s: string): string {
  if (!s.includes('.')) return s.replace(/^\+/, '')
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

export function safeParse(expr: string): { ast?: Node; error?: string } {
  try {
    return { ast: parseExpression(expr) }
  } catch (e) {
    return { error: e instanceof FormulaSyntaxError || e instanceof Error ? e.message : 'Invalid expression' }
  }
}
