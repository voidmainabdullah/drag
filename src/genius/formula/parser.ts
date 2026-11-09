import { MAX_DEPTH, MAX_EXPR_CHARS, MAX_NODES, walk, type AggFn, type BinOp, type Node } from './ast'

export class FormulaSyntaxError extends Error {
  code = 'FORMULA_SYNTAX'
  constructor(message: string) {
    super(message)
  }
}

type Tok =
  | { t: 'num'; v: string }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i))!
      out.push({ t: 'num', v: m[0] })
      i += m[0].length
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      let s = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++
        s += src[j]
        j++
      }
      if (j >= src.length) throw new FormulaSyntaxError('Unterminated string')
      out.push({ t: 'str', v: s })
      i = j + 1
      continue
    }
    if (c === '{') {
      const j = src.indexOf('}', i)
      if (j < 0) throw new FormulaSyntaxError('Unterminated {field}')
      const name = src.slice(i + 1, j).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new FormulaSyntaxError(`Bad field reference {${name}}`)
      out.push({ t: 'id', v: name })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0] })
      i += m[0].length
      continue
    }
    if (c === '(') (out.push({ t: 'lp' }), i++)
    else if (c === ')') (out.push({ t: 'rp' }), i++)
    else if (c === ',') (out.push({ t: 'comma' }), i++)
    else {
      const two = src.slice(i, i + 2)
      if (['==', '!=', '<>', '<=', '>=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two })
        i += 2
      } else if ('+-*/<>=!'.includes(c)) {
        out.push({ t: 'op', v: c })
        i++
      } else throw new FormulaSyntaxError(`Unexpected character "${c}"`)
    }
  }
  return out
}

const AGG_FUNCS: Record<string, { fn: AggFn; dir: 'reverse' | 'forward' }> = {
  SUM_REL: { fn: 'sum', dir: 'reverse' },
  COUNT_REL: { fn: 'count', dir: 'reverse' },
  AVG_REL: { fn: 'avg', dir: 'reverse' },
  MIN_REL: { fn: 'min', dir: 'reverse' },
  MAX_REL: { fn: 'max', dir: 'reverse' },
  SUM_LINKED: { fn: 'sum', dir: 'forward' },
  COUNT_LINKED: { fn: 'count', dir: 'forward' },
  AVG_LINKED: { fn: 'avg', dir: 'forward' },
  MIN_LINKED: { fn: 'min', dir: 'forward' },
  MAX_LINKED: { fn: 'max', dir: 'forward' },
}

export const SCALAR_FUNCS: Record<string, { min: number; max: number }> = {
  IF: { min: 3, max: 3 },
  ROUND: { min: 1, max: 2 },
  ABS: { min: 1, max: 1 },
  MIN: { min: 1, max: 20 },
  MAX: { min: 1, max: 20 },
  COALESCE: { min: 1, max: 20 },
  ISNULL: { min: 1, max: 1 },
  CONCAT: { min: 1, max: 20 },
  TODAY: { min: 0, max: 0 },
  DAYS_BETWEEN: { min: 2, max: 2 },
  SAFE_DIV: { min: 3, max: 3 },
  PERCENT: { min: 2, max: 2 },
}

class Parser {
  pos = 0
  constructor(private toks: Tok[]) {}
  private peek = () => this.toks[this.pos]
  private next = () => this.toks[this.pos++]
  private isOp(...ops: string[]) {
    const t = this.peek()
    return !!t && t.t === 'op' && ops.includes(t.v)
  }
  private isWord(w: string) {
    const t = this.peek()
    return !!t && t.t === 'id' && t.v.toUpperCase() === w
  }

  parse(): Node {
    const n = this.or()
    if (this.pos < this.toks.length) throw new FormulaSyntaxError('Unexpected token after the end of the expression')
    return n
  }
  private or(): Node {
    let a = this.and()
    while (this.isOp('||') || this.isWord('OR')) {
      this.next()
      a = { t: 'bin', op: 'or', a, b: this.and() }
    }
    return a
  }
  private and(): Node {
    let a = this.not()
    while (this.isOp('&&') || this.isWord('AND')) {
      this.next()
      a = { t: 'bin', op: 'and', a, b: this.not() }
    }
    return a
  }
  private not(): Node {
    if (this.isOp('!') || this.isWord('NOT')) {
      this.next()
      return { t: 'un', op: 'not', a: this.not() }
    }
    return this.cmp()
  }
  private cmp(): Node {
    let a = this.add()
    while (this.isOp('=', '==', '!=', '<>', '<', '<=', '>', '>=')) {
      const raw = (this.next() as { v: string }).v
      const op: BinOp = raw === '=' ? '==' : raw === '<>' ? '!=' : (raw as BinOp)
      a = { t: 'bin', op, a, b: this.add() }
    }
    return a
  }
  private add(): Node {
    let a = this.mul()
    while (this.isOp('+', '-')) {
      const op = (this.next() as { v: string }).v as BinOp
      a = { t: 'bin', op, a, b: this.mul() }
    }
    return a
  }
  private mul(): Node {
    let a = this.unary()
    while (this.isOp('*', '/')) {
      const op = (this.next() as { v: string }).v as BinOp
      a = { t: 'bin', op, a, b: this.unary() }
    }
    return a
  }
  private unary(): Node {
    if (this.isOp('-')) {
      this.next()
      return { t: 'un', op: 'neg', a: this.unary() }
    }
    if (this.isOp('+')) {
      this.next()
      return this.unary()
    }
    return this.primary()
  }
  private args(): Node[] {
    const args: Node[] = []
    if (this.peek()?.t !== 'rp') {
      args.push(this.or())
      while (this.peek()?.t === 'comma') {
        this.next()
        args.push(this.or())
      }
    }
    if (this.next()?.t !== 'rp') throw new FormulaSyntaxError('Missing )')
    return args
  }
  private primary(): Node {
    const t = this.next()
    if (!t) throw new FormulaSyntaxError('Unexpected end of expression')
    if (t.t === 'num') return { t: 'num', v: t.v }
    if (t.t === 'str') return { t: 'str', v: t.v }
    if (t.t === 'lp') {
      const n = this.or()
      if (this.next()?.t !== 'rp') throw new FormulaSyntaxError('Missing )')
      return n
    }
    if (t.t === 'id') {
      if (this.peek()?.t === 'lp') {
        this.next()
        const fn = t.v.toUpperCase()
        const args = this.args()
        const agg = AGG_FUNCS[fn]
        if (agg) return this.aggregate(fn, agg, args)
        const sig = SCALAR_FUNCS[fn]
        if (!sig) throw new FormulaSyntaxError(`Unknown function ${t.v}`)
        if (args.length < sig.min || args.length > sig.max) throw new FormulaSyntaxError(`${fn} takes ${sig.min === sig.max ? sig.min : `${sig.min}-${sig.max}`} argument(s)`)
        return { t: 'call', fn, args }
      }
      const up = t.v.toUpperCase()
      if (up === 'TRUE') return { t: 'bool', v: true }
      if (up === 'FALSE') return { t: 'bool', v: false }
      if (up === 'NULL') return { t: 'null' }
      return { t: 'ref', f: t.v }
    }
    throw new FormulaSyntaxError('Unexpected token')
  }
  private aggregate(name: string, agg: { fn: AggFn; dir: 'reverse' | 'forward' }, args: Node[]): Node {
    const ident = (n: Node | undefined, what: string): string => {
      if (!n || n.t !== 'ref') throw new FormulaSyntaxError(`${name}: ${what} must be a plain id`)
      return n.f
    }
    if (agg.dir === 'reverse') {
      // SUM_REL(module, relation_field, of_field [, where]) / COUNT_REL(module, relation_field [, where])
      if (agg.fn === 'count') {
        if (args.length < 2 || args.length > 3) throw new FormulaSyntaxError('COUNT_REL(module, relation_field [, where])')
        return { t: 'agg', fn: 'count', dir: 'reverse', module: ident(args[0], 'module'), via: ident(args[1], 'relation field'), where: args[2] }
      }
      if (args.length < 3 || args.length > 4) throw new FormulaSyntaxError(`${name}(module, relation_field, field [, where])`)
      return { t: 'agg', fn: agg.fn, dir: 'reverse', module: ident(args[0], 'module'), via: ident(args[1], 'relation field'), of: ident(args[2], 'field'), where: args[3] }
    }
    if (agg.fn === 'count') {
      if (args.length < 1 || args.length > 2) throw new FormulaSyntaxError('COUNT_LINKED(relation_field [, where])')
      return { t: 'agg', fn: 'count', dir: 'forward', via: ident(args[0], 'relation field'), where: args[1] }
    }
    if (args.length < 2 || args.length > 3) throw new FormulaSyntaxError(`${name}(relation_field, field [, where])`)
    return { t: 'agg', fn: agg.fn, dir: 'forward', via: ident(args[0], 'relation field'), of: ident(args[1], 'field'), where: args[2] }
  }
}

const cache = new Map<string, Node>()

/** Parses the restricted expression language into an AST. Throws FormulaSyntaxError. */
export function parseExpression(src: string): Node {
  if (typeof src !== 'string' || !src.trim()) throw new FormulaSyntaxError('Expression is empty')
  if (src.length > MAX_EXPR_CHARS) throw new FormulaSyntaxError(`Expression is longer than ${MAX_EXPR_CHARS} characters`)
  const hit = cache.get(src)
  if (hit) return hit
  const node = new Parser(tokenize(src)).parse()
  let count = 0
  let deepest = 0
  walk(node, (_n, d) => {
    count++
    deepest = Math.max(deepest, d)
  })
  if (count > MAX_NODES) throw new FormulaSyntaxError(`Expression has more than ${MAX_NODES} parts`)
  if (deepest > MAX_DEPTH) throw new FormulaSyntaxError(`Expression is nested deeper than ${MAX_DEPTH} levels`)
  if (cache.size > 500) cache.clear()
  cache.set(src, node)
  return node
}

const PREC: Record<string, number> = { or: 1, and: 2, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 }

/** Canonical text of an AST (used for "explain this calculation": it is the real formula, not a paraphrase). */
export function renderExpression(n: Node, parent = 0): string {
  switch (n.t) {
    case 'num':
      return n.v
    case 'str':
      return JSON.stringify(n.v)
    case 'bool':
      return n.v ? 'TRUE' : 'FALSE'
    case 'null':
      return 'NULL'
    case 'ref':
      return `{${n.f}}`
    case 'un':
      return n.op === 'neg' ? `-${renderExpression(n.a, 7)}` : `NOT ${renderExpression(n.a, 3)}`
    case 'bin': {
      const p = PREC[n.op]
      const op = n.op === 'and' ? 'AND' : n.op === 'or' ? 'OR' : n.op
      const s = `${renderExpression(n.a, p)} ${op} ${renderExpression(n.b, p + 1)}`
      return p < parent ? `(${s})` : s
    }
    case 'call':
      return `${n.fn}(${n.args.map((a) => renderExpression(a)).join(', ')})`
    case 'agg': {
      const name = `${n.fn.toUpperCase()}_${n.dir === 'reverse' ? 'REL' : 'LINKED'}`
      const parts = n.dir === 'reverse' ? [n.module!, n.via] : [n.via]
      if (n.of) parts.push(n.of)
      const tail = n.where ? [renderExpression(n.where)] : []
      return `${name}(${[...parts, ...tail].join(', ')})`
    }
  }
}
