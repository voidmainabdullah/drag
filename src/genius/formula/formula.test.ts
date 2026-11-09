import { describe, expect, it } from 'vitest'
import { D, Decimal } from './decimal'
import { analyseGraph, dependenciesOf, dependentsOf, explainFormula, MemoryHost, runFormulaTests, typeCheck, type FormulaSchema, type SchemaModule } from './analysis'
import { evaluateFormulaField, valueToJson } from './eval'
import { parseExpression, renderExpression, FormulaSyntaxError } from './parser'
import type { FormulaSpec } from './ast'

const spec = (id: string, expression: string, over: Partial<FormulaSpec> = {}): FormulaSpec => ({
  id,
  expression,
  resultType: 'money',
  currency: 'GBP',
  precision: 2,
  rounding: 'half_up',
  nullBehavior: 'zero',
  divByZero: 'null',
  ...over,
})

describe('decimal arithmetic', () => {
  it('is exact where binary floats are not', () => {
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(D('0.1').add(D('0.2')).toString()).toBe('0.3')
    expect(D(0.1).add(D(0.2)).eq(D('0.3'))).toBe(true)
    expect(D('1.10').mul(D('3')).toString()).toBe('3.3')
    expect(D('19.99').mul(D('100')).toString()).toBe('1999')
  })
  it('rounds with an explicit rule', () => {
    expect(D('2.345').round(2, 'half_up').toString(2)).toBe('2.35')
    expect(D('2.345').round(2, 'half_even').toString(2)).toBe('2.34')
    expect(D('2.355').round(2, 'half_even').toString(2)).toBe('2.36')
    expect(D('-2.5').round(0, 'half_up').toString()).toBe('-3')
    expect(D('-2.5').round(0, 'half_even').toString()).toBe('-2')
    expect(D('2.001').round(2, 'ceil').toString(2)).toBe('2.01')
    expect(D('-2.009').round(2, 'floor').toString(2)).toBe('-2.01')
    expect(D('2.999').round(2, 'down').toString(2)).toBe('2.99')
  })
  it('divides with bounded precision and rejects zero', () => {
    expect(D('1').div(D('3'), 6).toString()).toBe('0.333333')
    expect(() => D('1').div(D('0'))).toThrow()
  })
  it('parses exponents and rejects junk', () => {
    expect(Decimal.parse('1e-7')!.toString()).toBe('0.0000001')
    expect(Decimal.parse('abc')).toBeNull()
    expect(Decimal.parse(Number.NaN)).toBeNull()
  })
})

describe('parser', () => {
  it('parses to an AST and renders the canonical formula', () => {
    const ast = parseExpression('{a} + {b} * 2 - SUM_REL(payments, fee, amount, {status} == "received")')
    expect(renderExpression(ast)).toBe('{a} + {b} * 2 - SUM_REL(payments, fee, amount, {status} == "received")')
  })
  it('is not an eval: code-like input is a syntax error', () => {
    for (const bad of ['process.exit(1)', 'constructor.constructor("x")()', '1; DROP TABLE x', 'a => a', '`x`', 'import("x")', 'SUM_REL(a)', 'UNKNOWN(1)']) {
      expect(() => parseExpression(bad), bad).toThrow(FormulaSyntaxError)
    }
  })
  it('bounds size', () => {
    expect(() => parseExpression('1+'.repeat(2000) + '1')).toThrow(FormulaSyntaxError)
  })
})

// ---------- fees scenario (school) ----------
const modules: Record<string, SchemaModule> = {
  fees: {
    id: 'fees',
    name: 'Fees',
    fields: [
      { id: 'total_fees', type: 'currency', currency: 'GBP', label: 'Total fees' },
      { id: 'fines', type: 'currency', currency: 'GBP', label: 'Fines' },
      { id: 'due_date', type: 'date', label: 'Due date' },
      { id: 'student', type: 'relationship', relation: { moduleId: 'students' } },
      { id: 'paid', type: 'formula', label: 'Paid' },
      { id: 'outstanding', type: 'formula', label: 'Outstanding' },
      { id: 'pay_status', type: 'formula', label: 'Payment status' },
    ],
  },
  payments: {
    id: 'payments',
    name: 'Payments',
    fields: [
      { id: 'fee', type: 'relationship', relation: { moduleId: 'fees' } },
      { id: 'amount', type: 'currency', currency: 'GBP', label: 'Amount' },
      { id: 'status', type: 'dropdown', label: 'Status' },
      { id: 'reference', type: 'shortText' },
    ],
  },
  students: { id: 'students', name: 'Students', fields: [{ id: 'name', type: 'shortText' }] },
}
const PAID = spec('paid', 'SUM_REL(payments, fee, amount, {status} == "received")')
const OUTSTANDING = spec('outstanding', '{total_fees} + {fines} - SUM_REL(payments, fee, amount, {status} == "received")', {
  tests: [],
})
const STATUS = spec(
  'pay_status',
  'IF({outstanding} < 0, "overpaid", IF({outstanding} == 0, "paid", IF({due_date} < TODAY(), "overdue", IF({paid} > 0, "partial", "unpaid"))))',
  { resultType: 'text', currency: undefined },
)
const withSpecs = (): FormulaSchema => (id) => {
  const m = modules[id]
  if (!m) return undefined
  const byId: Record<string, FormulaSpec> = { paid: PAID, outstanding: OUTSTANDING, pay_status: STATUS }
  return { ...m, fields: m.fields.map((f) => (id === 'fees' && byId[f.id] ? { ...f, formulaSpec: byId[f.id] } : f)) }
}
const schema = withSpecs()

const caseOf = (name: string, fees: Record<string, unknown>, payments: [number, string][], expected: string, today = '2026-01-15') => ({
  name,
  record: fees,
  related: { payments: payments.map(([amount, status], i) => ({ id: `p${i}`, fee: '$self', amount, status })) },
  today,
  expected,
})

describe('Outstanding = Total Fees + Fines − Payments', () => {
  const fees = { total_fees: 1200.1, fines: 20.05, due_date: '2026-03-01' }
  const cases = [
    caseOf('unpaid', fees, [], '1220.15'),
    caseOf('paid in full', fees, [[1220.15, 'received']], '0.00'),
    caseOf('partially paid (two instalments)', fees, [[500.1, 'received'], [200.05, 'received']], '520.00'),
    caseOf('refunded payment does not count', fees, [[1220.15, 'refunded']], '1220.15'),
    caseOf('paid then partly refunded', fees, [[1220.15, 'received'], [20.05, 'refunded']], '0.00'),
    caseOf('overpaid becomes a credit', fees, [[1300, 'received']], '-79.85'),
    caseOf('no fines recorded (blank, not zero)', { total_fees: 1000, due_date: '2026-03-01' }, [[400, 'received']], '600.00'),
    caseOf('float trap: 0.1 + 0.2', { total_fees: 0.3, fines: 0 }, [[0.1, 'received'], [0.2, 'received']], '0.00'),
    caseOf('overdue is still the same outstanding', fees, [[100, 'received']], '1120.15', '2026-06-01'),
  ]
  it('passes every deterministic case', () => {
    const out = runFormulaTests(OUTSTANDING, 'fees', schema, cases)
    expect(out.filter((o) => !o.pass)).toEqual([])
  })
  it('does not double count a payment referenced twice', () => {
    const host = new MemoryHost(
      Object.fromEntries(Object.entries(modules).map(([k, v]) => [k, v.fields])),
      [
        { moduleId: 'fees', id: 'f1', data: { total_fees: 100, fines: 0 } },
        { moduleId: 'payments', id: 'p1', data: { fee: ['f1', 'f1'], amount: 40, status: 'received' } },
      ],
      '2026-01-01',
    )
    const f = host.reverse('payments', 'fee', 'f1')
    expect(f).toHaveLength(1)
    const res = evaluateFormulaField(host, 'fees', { id: 'f1', data: { total_fees: 100, fines: 0 } }, OUTSTANDING)
    expect(valueToJson(res.value, OUTSTANDING)).toBe('60.00')
  })
  it('payment status covers paid / partial / unpaid / overdue / overpaid through chained formulas', () => {
    const statusOf = (c: ReturnType<typeof caseOf>) => { const r = runFormulaTests(STATUS, 'fees', schema, [{ ...c, expected: '' }])[0]; if (r.error) throw new Error(r.error); return r.actual }
    expect(statusOf(caseOf('', fees, [], ''))).toBe('unpaid')
    expect(statusOf(caseOf('', fees, [[100, 'received']], ''))).toBe('partial')
    expect(statusOf(caseOf('', fees, [[1220.15, 'received']], ''))).toBe('paid')
    expect(statusOf(caseOf('', fees, [[1300, 'received']], ''))).toBe('overpaid')
    expect(statusOf(caseOf('', fees, [[100, 'received']], '', '2026-06-01'))).toBe('overdue')
    expect(statusOf(caseOf('', fees, [[1220.15, 'refunded']], '', '2026-06-01'))).toBe('overdue')
  })
})

describe('Percentage = Obtained / Total × 100', () => {
  const m: Record<string, SchemaModule> = { results: { id: 'results', fields: [{ id: 'obtained', type: 'number' }, { id: 'total', type: 'number' }, { id: 'pct', type: 'formula' }] } }
  const pct = spec('pct', '{obtained} / {total} * 100', { resultType: 'percentage', currency: undefined, nullBehavior: 'null', divByZero: 'null' })
  const sc: FormulaSchema = (id) => (id === 'results' ? { ...m.results, fields: m.results.fields.map((f) => (f.id === 'pct' ? { ...f, formulaSpec: pct } : f)) } : undefined)
  it('computes exactly, rounds once at the end', () => {
    const out = runFormulaTests(pct, 'results', sc, [
      { name: '45/60', record: { obtained: 45, total: 60 }, expected: '75.00' },
      { name: '1/3', record: { obtained: 1, total: 3 }, expected: '33.33' },
      { name: '2/3', record: { obtained: 2, total: 3 }, expected: '66.67' },
      { name: 'zero obtained', record: { obtained: 0, total: 50 }, expected: '0.00' },
      { name: 'total = 0 gives empty, never Infinity/NaN/0', record: { obtained: 5, total: 0 }, expected: null },
      { name: 'missing total is empty', record: { obtained: 5 }, expected: null },
    ])
    expect(out.filter((o) => !o.pass)).toEqual([])
  })
  it('divByZero can be configured', () => {
    const asZero = { ...pct, divByZero: 'zero' as const }
    expect(runFormulaTests(asZero, 'results', sc, [{ name: 'z', record: { obtained: 5, total: 0 }, expected: '0.00' }])[0].pass).toBe(true)
    const strict = { ...pct, divByZero: 'error' as const }
    const r = runFormulaTests(strict, 'results', sc, [{ name: 'z', record: { obtained: 5, total: 0 }, expected: null }])[0]
    expect(r.pass).toBe(false)
    expect(r.error).toMatch(/zero/i)
  })
})

describe('commission and monthly profit', () => {
  const m: Record<string, SchemaModule> = {
    deals: { id: 'deals', fields: [{ id: 'value', type: 'currency', currency: 'USD' }, { id: 'tier', type: 'dropdown' }, { id: 'commission', type: 'formula' }] },
    months: { id: 'months', fields: [{ id: 'income', type: 'currency', currency: 'USD' }, { id: 'expenses', type: 'currency', currency: 'USD' }, { id: 'profit', type: 'formula' }] },
  }
  const commission = spec('commission', 'IF({tier} == "gold", {value} * 0.12, IF({tier} == "silver", {value} * 0.08, {value} * 0.05))', { currency: 'USD' })
  const sc: FormulaSchema = (id) => (id === 'deals' ? { ...m.deals, fields: m.deals.fields.map((f) => (f.id === 'commission' ? { ...f, formulaSpec: commission } : f)) } : undefined)
  it('commission follows the tier rate and changes when the rate changes', () => {
    const cases = [
      { name: 'gold', record: { value: 1999.99, tier: 'gold' }, expected: '240.00' },
      { name: 'silver', record: { value: 1000, tier: 'silver' }, expected: '80.00' },
      { name: 'other', record: { value: 333.33, tier: 'bronze' }, expected: '16.67' },
    ]
    expect(runFormulaTests(commission, 'deals', sc, cases).every((o) => o.pass)).toBe(true)
    const changed = spec('commission', 'IF({tier} == "gold", {value} * 0.15, IF({tier} == "silver", {value} * 0.08, {value} * 0.05))', { currency: 'USD' })
    expect(runFormulaTests(changed, 'deals', sc, [{ name: 'gold at 15%', record: { value: 1000, tier: 'gold' }, expected: '150.00' }])[0].pass).toBe(true)
  })
  it('monthly profit after expenses (incl. loss and empty)', () => {
    const profit = spec('profit', '{income} - {expenses}', { currency: 'USD' })
    const sc2: FormulaSchema = (id) => (id === 'months' ? { ...m.months, fields: m.months.fields.map((f) => (f.id === 'profit' ? { ...f, formulaSpec: profit } : f)) } : undefined)
    const out = runFormulaTests(profit, 'months', sc2, [
      { name: 'profit', record: { income: 5400.5, expenses: 3200.25 }, expected: '2200.25' },
      { name: 'loss', record: { income: 100, expenses: 250.1 }, expected: '-150.10' },
      { name: 'no expenses yet', record: { income: 100 }, expected: '100.00' },
    ])
    expect(out.filter((o) => !o.pass)).toEqual([])
  })
})

describe('static analysis', () => {
  it('type checks against real field types', () => {
    const t = (e: string, mod = 'fees') => typeCheck(parseExpression(e), mod, schema).issues.map((i) => i.code)
    expect(t('{total_fees} + {fines}')).toEqual([])
    expect(t('{total_fees} + {due_date}')).toContain('FORMULA_TYPE_MISMATCH')
    expect(t('{nope} + 1')).toContain('FORMULA_UNKNOWN_FIELD')
    expect(t('{due_date} < 5')).toContain('FORMULA_TYPE_MISMATCH')
    expect(t('SUM_REL(payments, student, amount)')).toContain('FORMULA_BAD_AGGREGATE')
    expect(t('SUM_REL(payments, fee, status)')).toContain('FORMULA_TYPE_MISMATCH')
    expect(t('SUM_REL(nowhere, fee, amount)')).toContain('FORMULA_UNKNOWN_MODULE')
  })
  it('refuses to mix currencies without an exchange-rate source', () => {
    const mixed: FormulaSchema = (id) =>
      id === 'm' ? { id: 'm', fields: [{ id: 'a', type: 'currency', currency: 'GBP' }, { id: 'b', type: 'currency', currency: 'USD' }] } : undefined
    expect(typeCheck(parseExpression('{a} + {b}'), 'm', mixed).issues.map((i) => i.code)).toContain('FORMULA_CURRENCY_MIX')
  })
  it('extracts dependencies including aggregate sources in the right module scope', () => {
    const deps = dependenciesOf(parseExpression(OUTSTANDING.expression), 'fees', schema).map((d) => `${d.moduleId}.${d.fieldId}`).sort()
    expect(deps).toEqual(['fees.fines', 'fees.total_fees', 'payments.amount', 'payments.fee', 'payments.status'])
  })
  it('detects circular formula dependencies and orders the rest', () => {
    const g = analyseGraph([
      { moduleId: 'a', fieldId: 'x', deps: [{ moduleId: 'a', fieldId: 'y' }] },
      { moduleId: 'a', fieldId: 'y', deps: [{ moduleId: 'b', fieldId: 'z' }] },
      { moduleId: 'b', fieldId: 'z', deps: [{ moduleId: 'a', fieldId: 'x' }] },
    ])
    expect(g.cycles.length).toBeGreaterThan(0)
    expect(g.cycles[0]).toEqual(expect.arrayContaining(['a.x', 'a.y', 'b.z']))
    const ok = analyseGraph([
      { moduleId: 'a', fieldId: 'x', deps: [{ moduleId: 'a', fieldId: 'y' }] },
      { moduleId: 'a', fieldId: 'y', deps: [{ moduleId: 'a', fieldId: 'base' }] },
    ])
    expect(ok.cycles).toEqual([])
    expect(ok.order).toEqual(['a.y', 'a.x'])
  })
  it('finds what must be recalculated when a payment amount changes', () => {
    const nodes = ['paid', 'outstanding', 'pay_status'].map((id) => {
      const s = { paid: PAID, outstanding: OUTSTANDING, pay_status: STATUS }[id]!
      return { moduleId: 'fees', fieldId: id, deps: dependenciesOf(parseExpression(s.expression), 'fees', schema) }
    })
    expect(dependentsOf(nodes, [{ moduleId: 'payments', fieldId: 'amount' }]).sort()).toEqual(['fees.outstanding', 'fees.paid', 'fees.pay_status'])
  })
  it('a runtime cycle through formula references is reported, not looped on', () => {
    const a = spec('a', '{b} + 1')
    const b = spec('b', '{a} + 1')
    const host = new MemoryHost({ m: [{ id: 'a', type: 'formula', formulaSpec: a }, { id: 'b', type: 'formula', formulaSpec: b }] }, [], '2026-01-01')
    const r = evaluateFormulaField(host, 'm', { id: 'r', data: {} }, a)
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('CYCLE')
  })
})

describe('explain a calculation', () => {
  it('returns the real formula and its real source fields', () => {
    const e = explainFormula(OUTSTANDING, 'fees', schema)
    expect(e.formula).toBe('{total_fees} + {fines} - SUM_REL(payments, fee, amount, {status} == "received")')
    expect(e.sources.map((s) => `${s.moduleName}.${s.label ?? s.fieldId}`).sort()).toEqual(['Fees.Fines', 'Fees.Total fees', 'Payments.Amount', 'Payments.Status', 'Payments.fee'])
    expect(e.rounding).toBe('half_up')
    expect(e.precision).toBe(2)
  })
})
