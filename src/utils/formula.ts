/**
 * Tiny, safe formula engine. No eval / Function.
 * Supports: numbers, "strings", {field_name} or bare identifiers, + - * / % ^,
 * comparisons (= == != <> < <= > >=), && || ! and functions
 * IF, ROUND, ABS, MIN, MAX, SUM, AVG, CONCAT, UPPER, LOWER, LEN, TODAY, NOW,
 * DAYS_BETWEEN, AND, OR, NOT, FLOOR, CEIL, TRIM, ISEMPTY.
 */
export type FormulaValue = number | string | boolean | null

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const n = Number(src.slice(i, j))
      if (Number.isNaN(n)) throw new Error('Bad number')
      out.push({ t: 'num', v: n })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c) {
        s += src[j]
        j++
      }
      if (j >= src.length) throw new Error('Unterminated string')
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    if (c === '{') {
      const j = src.indexOf('}', i)
      if (j < 0) throw new Error('Unterminated {field}')
      out.push({ t: 'id', v: src.slice(i + 1, j).trim() })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      out.push({ t: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    if (c === '(') {
      out.push({ t: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      out.push({ t: 'rp' })
      i++
      continue
    }
    if (c === ',') {
      out.push({ t: 'comma' })
      i++
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<>', '<=', '>=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/%^<>=!&'.includes(c)) {
      out.push({ t: 'op', v: c })
      i++
      continue
    }
    throw new Error(`Unexpected "${c}"`)
  }
  return out
}

type Node =
  | { k: 'lit'; v: FormulaValue }
  | { k: 'ref'; name: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

class Parser {
  pos = 0
  constructor(private toks: Token[]) {}
  peek() {
    return this.toks[this.pos]
  }
  next() {
    return this.toks[this.pos++]
  }
  isOp(...ops: string[]) {
    const t = this.peek()
    return t && t.t === 'op' && ops.includes(t.v)
  }
  parse(): Node {
    const n = this.or()
    if (this.pos < this.toks.length) throw new Error('Unexpected token')
    return n
  }
  or(): Node {
    let a = this.and()
    while (this.isOp('||')) {
      this.next()
      a = { k: 'bin', op: '||', a, b: this.and() }
    }
    return a
  }
  and(): Node {
    let a = this.cmp()
    while (this.isOp('&&', '&')) {
      this.next()
      a = { k: 'bin', op: '&&', a, b: this.cmp() }
    }
    return a
  }
  cmp(): Node {
    let a = this.add()
    while (this.isOp('=', '==', '!=', '<>', '<', '<=', '>', '>=')) {
      const op = (this.next() as { v: string }).v
      a = { k: 'bin', op, a, b: this.add() }
    }
    return a
  }
  add(): Node {
    let a = this.mul()
    while (this.isOp('+', '-')) {
      const op = (this.next() as { v: string }).v
      a = { k: 'bin', op, a, b: this.mul() }
    }
    return a
  }
  mul(): Node {
    let a = this.pow()
    while (this.isOp('*', '/', '%')) {
      const op = (this.next() as { v: string }).v
      a = { k: 'bin', op, a, b: this.pow() }
    }
    return a
  }
  pow(): Node {
    const a = this.unary()
    if (this.isOp('^')) {
      this.next()
      return { k: 'bin', op: '^', a, b: this.pow() }
    }
    return a
  }
  unary(): Node {
    if (this.isOp('-', '+', '!')) {
      const op = (this.next() as { v: string }).v
      return { k: 'un', op, a: this.unary() }
    }
    return this.primary()
  }
  primary(): Node {
    const t = this.next()
    if (!t) throw new Error('Unexpected end')
    if (t.t === 'num') return { k: 'lit', v: t.v }
    if (t.t === 'str') return { k: 'lit', v: t.v }
    if (t.t === 'lp') {
      const n = this.or()
      if (this.next()?.t !== 'rp') throw new Error('Missing )')
      return n
    }
    if (t.t === 'id') {
      if (this.peek()?.t === 'lp') {
        this.next()
        const args: Node[] = []
        if (this.peek()?.t !== 'rp') {
          args.push(this.or())
          while (this.peek()?.t === 'comma') {
            this.next()
            args.push(this.or())
          }
        }
        if (this.next()?.t !== 'rp') throw new Error('Missing )')
        return { k: 'call', fn: t.v.toUpperCase(), args }
      }
      const up = t.v.toUpperCase()
      if (up === 'TRUE') return { k: 'lit', v: true }
      if (up === 'FALSE') return { k: 'lit', v: false }
      return { k: 'ref', name: t.v }
    }
    throw new Error('Unexpected token')
  }
}

const num = (v: FormulaValue): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === null || v === '') return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const str = (v: FormulaValue): string => (v === null ? '' : String(v))
const truthy = (v: FormulaValue): boolean => (typeof v === 'string' ? v !== '' : Boolean(v))

function evalNode(n: Node, get: (name: string) => FormulaValue): FormulaValue {
  switch (n.k) {
    case 'lit':
      return n.v
    case 'ref':
      return get(n.name)
    case 'un': {
      const a = evalNode(n.a, get)
      if (n.op === '-') return -num(a)
      if (n.op === '!') return !truthy(a)
      return num(a)
    }
    case 'bin': {
      const a = evalNode(n.a, get)
      if (n.op === '&&') return truthy(a) && truthy(evalNode(n.b, get))
      if (n.op === '||') return truthy(a) || truthy(evalNode(n.b, get))
      const b = evalNode(n.b, get)
      switch (n.op) {
        case '+':
          if (typeof a === 'string' || typeof b === 'string') {
            if (typeof a === 'number' && typeof b === 'string' && b !== '' && !Number.isNaN(Number(b))) return a + Number(b)
            return str(a) + str(b)
          }
          return num(a) + num(b)
        case '-':
          return num(a) - num(b)
        case '*':
          return num(a) * num(b)
        case '/':
          return num(b) === 0 ? null : num(a) / num(b)
        case '%':
          return num(b) === 0 ? null : num(a) % num(b)
        case '^':
          return Math.pow(num(a), num(b))
        case '=':
        case '==':
          return a === b || (typeof a !== typeof b && String(a) === String(b))
        case '!=':
        case '<>':
          return !(a === b || (typeof a !== typeof b && String(a) === String(b)))
        case '<':
          return typeof a === 'string' && typeof b === 'string' ? a < b : num(a) < num(b)
        case '<=':
          return typeof a === 'string' && typeof b === 'string' ? a <= b : num(a) <= num(b)
        case '>':
          return typeof a === 'string' && typeof b === 'string' ? a > b : num(a) > num(b)
        case '>=':
          return typeof a === 'string' && typeof b === 'string' ? a >= b : num(a) >= num(b)
      }
      throw new Error('Bad operator')
    }
    case 'call': {
      const args = n.args
      if (n.fn === 'IF') {
        if (args.length < 2) throw new Error('IF needs 2-3 args')
        return truthy(evalNode(args[0], get))
          ? evalNode(args[1], get)
          : args[2]
            ? evalNode(args[2], get)
            : ''
      }
      const v = args.map((a) => evalNode(a, get))
      switch (n.fn) {
        case 'ROUND': {
          const d = v[1] === undefined ? 0 : num(v[1])
          const f = Math.pow(10, d)
          return Math.round(num(v[0]) * f) / f
        }
        case 'ABS':
          return Math.abs(num(v[0]))
        case 'FLOOR':
          return Math.floor(num(v[0]))
        case 'CEIL':
          return Math.ceil(num(v[0]))
        case 'MIN':
          return v.length ? Math.min(...v.map(num)) : null
        case 'MAX':
          return v.length ? Math.max(...v.map(num)) : null
        case 'SUM':
          return v.reduce<number>((s, x) => s + num(x), 0)
        case 'AVG':
          return v.length ? v.reduce<number>((s, x) => s + num(x), 0) / v.length : null
        case 'CONCAT':
          return v.map(str).join('')
        case 'UPPER':
          return str(v[0]).toUpperCase()
        case 'LOWER':
          return str(v[0]).toLowerCase()
        case 'TRIM':
          return str(v[0]).trim()
        case 'LEN':
          return str(v[0]).length
        case 'ISEMPTY':
          return v[0] === null || v[0] === '' || v[0] === undefined
        case 'AND':
          return v.every(truthy)
        case 'OR':
          return v.some(truthy)
        case 'NOT':
          return !truthy(v[0])
        case 'TODAY':
          return new Date().toISOString().slice(0, 10)
        case 'NOW':
          return new Date().toISOString()
        case 'DAYS_BETWEEN': {
          const a = Date.parse(str(v[0]))
          const b = Date.parse(str(v[1]))
          if (Number.isNaN(a) || Number.isNaN(b)) return null
          return Math.round((b - a) / 86400000)
        }
      }
      throw new Error(`Unknown function ${n.fn}`)
    }
  }
}

const cache = new Map<string, Node | Error>()

function parse(expr: string): Node {
  const hit = cache.get(expr)
  if (hit instanceof Error) throw hit
  if (hit) return hit
  try {
    const node = new Parser(tokenize(expr)).parse()
    cache.set(expr, node)
    return node
  } catch (e) {
    const err = e instanceof Error ? e : new Error('Invalid formula')
    cache.set(expr, err)
    throw err
  }
}

export function validateFormula(expr: string): string | null {
  try {
    if (!expr.trim()) return 'Formula is empty'
    parse(expr)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula'
  }
}

export function evaluateFormula(
  expr: string | undefined,
  get: (name: string) => FormulaValue,
): FormulaValue | { error: string } {
  if (!expr || !expr.trim()) return null
  try {
    return evalNode(parse(expr), get)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid formula' }
  }
}
