let seq = 0

export function uid(prefix = 'id'): string {
  let rnd: string
  try {
    rnd =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : Math.random().toString(36).slice(2, 14)
  } catch {
    // Cloudflare Workers forbid random values in global scope (template definitions are built at import time).
    seq += 1
    rnd = `s${seq.toString(36)}${Date.now().toString(36)}`
  }
  return `${prefix}_${rnd}`
}

export function slug(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'field'
  )
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
