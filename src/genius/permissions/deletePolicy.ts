import type { CrmRecord, Module } from '#/types'

export interface DeletePlan {
  /** records that would be moved to the trash: the requested ones plus anything a `cascade` relationship pulls in */
  remove: string[]
  /** relation values cleared because their relationship says `set_null` */
  clear: { recordId: string; fieldId: string; value: unknown }[]
  /** `restrict` relationships that stop the delete */
  blocked: { recordId: string; byModule: string; byField: string; count: number }[]
}

const refs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : [])
const MAX_CASCADE = 500

/**
 * What deleting these records means under each relationship's `deletePolicy`.
 *   restrict -> refuse while live records still point at it
 *   cascade  -> the pointing records go to the trash too (bounded, never loops)
 *   set_null -> the pointing records stay, with that link cleared
 * A relationship with no policy set (every hand-built relationship) keeps today's behaviour: nothing happens to the others.
 */
export function planDelete(ids: string[], modules: Module[], records: CrmRecord[]): DeletePlan {
  const live = records.filter((r) => !r.deletedAt)
  const byId = new Map(live.map((r) => [r.id, r]))
  const removing = new Set(ids.filter((id) => byId.has(id)))
  const requested = new Set(removing)
  const clear: DeletePlan['clear'] = []
  const blocked: DeletePlan['blocked'] = []
  const queue = [...removing]

  // every relationship field pointing at a module, with the owning module
  const incoming = modules.flatMap((m) => m.fields.filter((f) => f.type === 'relationship' && f.relation?.deletePolicy).map((f) => ({ m, f })))

  while (queue.length) {
    const id = queue.shift()!
    const target = byId.get(id)
    if (!target) continue
    for (const { m, f } of incoming) {
      if (f.relation!.moduleId !== target.moduleId) continue
      const policy = f.relation!.deletePolicy
      const pointing = live.filter((r) => r.moduleId === m.id && !removing.has(r.id) && refs(r.data[f.id]).includes(id))
      if (!pointing.length) continue
      if (policy === 'restrict') blocked.push({ recordId: id, byModule: m.name, byField: f.label, count: pointing.length })
      else if (policy === 'cascade') {
        for (const p of pointing) {
          if (removing.size >= MAX_CASCADE) break
          removing.add(p.id)
          queue.push(p.id)
        }
      } else if (policy === 'set_null') {
        for (const p of pointing) {
          const cur = p.data[f.id]
          clear.push({ recordId: p.id, fieldId: f.id, value: Array.isArray(cur) ? cur.filter((x) => x !== id) : null })
        }
      }
    }
  }
  // a record that is going anyway does not need its links cleared
  return { remove: [...removing], clear: clear.filter((c) => !removing.has(c.recordId)), blocked: blocked.filter((b) => requested.has(b.recordId) || removing.has(b.recordId)) }
}

export function describeBlocked(plan: DeletePlan, modules: Module[], records: CrmRecord[]): string {
  const first = plan.blocked[0]
  if (!first) return ''
  const rec = records.find((r) => r.id === first.recordId)
  const m = modules.find((x) => x.id === rec?.moduleId)
  const more = plan.blocked.length > 1 ? ` (and ${plan.blocked.length - 1} more)` : ''
  return `${m ? `${m.name} record` : 'This record'} is still used by ${first.count} ${first.byModule} record${first.count === 1 ? '' : 's'} (${first.byField})${more}. Remove or reassign those first.`
}
