import { KEYS, readJson, writeJson } from './storageService'
import { emptyGenius, type GeniusPersisted } from '#/genius/state/types'

const MAX_VERSIONS = 40
const MAX_PROPOSALS = 25

export function normalizeGenius(raw: unknown): GeniusPersisted {
  const base = emptyGenius()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const r = raw as Partial<GeniusPersisted>
  return {
    v: 1,
    versions: Array.isArray(r.versions) ? r.versions : base.versions,
    proposals: Array.isArray(r.proposals) ? r.proposals : base.proposals,
    audit: Array.isArray(r.audit) ? r.audit : base.audit,
    memory: r.memory && typeof r.memory === 'object' ? r.memory : base.memory,
  }
}

/** Keep storage bounded: old versions lose their undo snapshot, old proposals lose their payload, nothing else is dropped silently. */
export function trimGenius(g: GeniusPersisted): GeniusPersisted {
  const versions = g.versions.length > MAX_VERSIONS ? g.versions.slice(g.versions.length - MAX_VERSIONS) : g.versions
  const proposals = g.proposals.slice(-MAX_PROPOSALS).map((p, i, all) => (i < all.length - 5 && p.state !== 'validated' && p.state !== 'draft' ? { ...p, blueprint: undefined, patch: undefined } : p))
  return { ...g, versions, proposals }
}

export const geniusStorage = {
  load: (): GeniusPersisted => normalizeGenius(readJson<unknown>(KEYS.genius, null)),
  save: (g: GeniusPersisted) => writeJson(KEYS.genius, trimGenius(g)),
}
