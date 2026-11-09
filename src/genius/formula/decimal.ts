/**
 * Minimal arbitrary-precision decimal arithmetic on BigInt (no binary floats anywhere).
 * A Decimal is `unscaled / 10^scale`. All operations are exact except division and `round`,
 * which take an explicit scale / rounding mode.
 */

export type RoundingMode = 'half_up' | 'half_even' | 'down' | 'up' | 'floor' | 'ceil'
export const ROUNDING_MODES: RoundingMode[] = ['half_up', 'half_even', 'down', 'up', 'floor', 'ceil']

/** digits kept by `div` before the formula's own rounding rule is applied */
export const DIV_SCALE = 24
const MAX_SCALE = 60

const TEN = 10n
const pow10 = (n: number): bigint => TEN ** BigInt(n)

export class Decimal {
  readonly u: bigint
  readonly s: number

  private constructor(u: bigint, s: number) {
    this.u = u
    this.s = s
  }

  static of(u: bigint, s = 0): Decimal {
    if (s < 0) return new Decimal(u * pow10(-s), 0)
    return new Decimal(u, s)
  }

  static readonly ZERO = new Decimal(0n, 0)
  static readonly ONE = new Decimal(1n, 0)

  /** Parses "12", "-0.5", "1e-7", "1.25E3". Returns null for anything that is not a finite decimal literal. */
  static parse(input: string | number | bigint | Decimal): Decimal | null {
    if (input instanceof Decimal) return input
    if (typeof input === 'bigint') return new Decimal(input, 0)
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) return null
      input = String(input) // shortest round-trip representation: no binary expansion
    }
    const m = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(input)
    if (!m) return null
    const [, sign, intPart = '', fracPart = '', exp] = m
    if (!intPart && !fracPart) return null
    let digits = (intPart + fracPart).replace(/^0+(?=\d)/, '')
    if (digits === '') digits = '0'
    let scale = fracPart.length
    if (exp) {
      const e = Number(exp)
      if (Math.abs(e) > MAX_SCALE) return null
      scale -= e
    }
    let u = BigInt(digits)
    if (sign === '-') u = -u
    if (scale < 0) return new Decimal(u * pow10(-scale), 0)
    if (scale > MAX_SCALE) return null
    return new Decimal(u, scale).normalize()
  }

  /** Drops trailing zeros of the fraction (keeps the value, shrinks the scale). */
  normalize(): Decimal {
    let { u, s } = this
    while (s > 0 && u % TEN === 0n) {
      u /= TEN
      s--
    }
    return u === this.u ? this : new Decimal(u, s)
  }

  private static align(a: Decimal, b: Decimal): [bigint, bigint, number] {
    if (a.s === b.s) return [a.u, b.u, a.s]
    if (a.s > b.s) return [a.u, b.u * pow10(a.s - b.s), a.s]
    return [a.u * pow10(b.s - a.s), b.u, b.s]
  }

  add(o: Decimal): Decimal {
    const [x, y, s] = Decimal.align(this, o)
    return new Decimal(x + y, s)
  }
  sub(o: Decimal): Decimal {
    const [x, y, s] = Decimal.align(this, o)
    return new Decimal(x - y, s)
  }
  mul(o: Decimal): Decimal {
    return new Decimal(this.u * o.u, this.s + o.s).normalize()
  }
  neg(): Decimal {
    return new Decimal(-this.u, this.s)
  }
  abs(): Decimal {
    return this.u < 0n ? this.neg() : this
  }
  /** Division to `DIV_SCALE` digits (truncated toward zero; apply `round` afterwards). Throws on a zero divisor. */
  div(o: Decimal, scale = DIV_SCALE): Decimal {
    if (o.u === 0n) throw new RangeError('DIVISION_BY_ZERO')
    // (a.u / 10^a.s) / (b.u / 10^b.s) = a.u * 10^(b.s) / (b.u * 10^(a.s))  -> scale to `scale` digits
    const num = this.u * pow10(o.s + scale)
    const den = o.u * pow10(this.s)
    return new Decimal(num / den, scale).normalize()
  }
  cmp(o: Decimal): -1 | 0 | 1 {
    const [x, y] = Decimal.align(this, o)
    return x < y ? -1 : x > y ? 1 : 0
  }
  eq(o: Decimal): boolean {
    return this.cmp(o) === 0
  }
  isZero(): boolean {
    return this.u === 0n
  }
  isNeg(): boolean {
    return this.u < 0n
  }

  /** Round to `places` decimal places (places may be negative) with an explicit rule. */
  round(places: number, mode: RoundingMode = 'half_up'): Decimal {
    if (places >= this.s) return this
    const drop = this.s - places
    const div = pow10(drop)
    let q = this.u / div // truncates toward zero
    const r = this.u % div
    if (r !== 0n) {
      const neg = this.u < 0n
      const twice = (r < 0n ? -r : r) * 2n
      const half = twice === div ? 0 : twice > div ? 1 : -1 // compare remainder to 0.5
      let up = false // "up" = away from zero
      switch (mode) {
        case 'half_up':
          up = half >= 0
          break
        case 'half_even':
          up = half > 0 || (half === 0 && q % 2n !== 0n)
          break
        case 'down':
          up = false
          break
        case 'up':
          up = true
          break
        case 'floor':
          up = neg
          break
        case 'ceil':
          up = !neg
          break
      }
      if (up) q += neg ? -1n : 1n
    }
    if (places < 0) return new Decimal(q * pow10(-places), 0)
    return new Decimal(q, places)
  }

  /** Plain decimal string, never exponent notation. `fixed` forces that many fraction digits. */
  toString(fixed?: number): string {
    const d = fixed === undefined ? this.normalize() : this.round(fixed, 'half_up')
    const neg = d.u < 0n
    let digits = (neg ? -d.u : d.u).toString()
    let scale = d.s
    if (fixed !== undefined && scale < fixed) {
      digits += '0'.repeat(fixed - scale)
      scale = fixed
    }
    if (scale > 0) {
      digits = digits.padStart(scale + 1, '0')
      digits = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`
    }
    return (neg && /[1-9]/.test(digits) ? '-' : '') + digits
  }

  /** Lossy: only for charts / display, never for further arithmetic. */
  toNumber(): number {
    return Number(this.toString())
  }
}

export const D = (v: string | number | bigint): Decimal => {
  const d = Decimal.parse(v)
  if (!d) throw new TypeError(`Not a decimal: ${String(v)}`)
  return d
}
