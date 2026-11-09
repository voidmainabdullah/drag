import { hash53 } from '../config/model'
import type { AuditEntry } from './types'

export const AUDIT_CAP = 2000
const GENESIS = 'genesis'

type NewEntry = Omit<AuditEntry, 'id' | 'prevHash' | 'hash' | 'at'> & { at?: string }

const material = (e: Omit<AuditEntry, 'hash'>) => JSON.stringify([e.prevHash, e.at, e.actor, e.workspaceId, e.action, e.target, e.detail, e.correlationId ?? ''])

/**
 * Append-only audit log. Each entry carries the hash of the previous one, so an edited, removed or reordered entry is
 * detected by `verifyAudit`. This is tamper-EVIDENCE against accidental or casual edits: the log lives in the user's own
 * browser storage, so it is not protection against someone who controls that storage.
 */
export function appendAudit(log: AuditEntry[], e: NewEntry, now = new Date().toISOString()): AuditEntry[] {
  const prevHash = log.length ? log[log.length - 1].hash : GENESIS
  const base = { id: `aud_${log.length ? Number(log[log.length - 1].id.slice(4)) + 1 : 1}`, at: e.at ?? now, actor: e.actor, workspaceId: e.workspaceId, action: e.action, target: e.target, detail: e.detail.slice(0, 500), correlationId: e.correlationId, prevHash }
  const entry: AuditEntry = { ...base, hash: hash53(material(base)) }
  const next = [...log, entry]
  return next.length > AUDIT_CAP ? next.slice(next.length - AUDIT_CAP) : next
}

export function verifyAudit(log: AuditEntry[]): { ok: boolean; brokenAt?: number } {
  for (let i = 0; i < log.length; i++) {
    const e = log[i]
    const { hash, ...rest } = e
    if (hash53(material(rest)) !== hash) return { ok: false, brokenAt: i }
    if (i > 0 && e.prevHash !== log[i - 1].hash) return { ok: false, brokenAt: i }
    if (i === 0 && log.length < AUDIT_CAP && e.prevHash !== GENESIS) return { ok: false, brokenAt: 0 }
  }
  return { ok: true }
}
