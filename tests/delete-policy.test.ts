import { describe, expect, it } from 'vitest'
import type { CrmRecord, Field, Module } from '#/types'
import { describeBlocked, planDelete } from '#/genius/permissions/deletePolicy'

const field = (id: string, target: string, policy?: 'restrict' | 'cascade' | 'set_null'): Field =>
  ({ id, label: id, type: 'relationship', relation: { moduleId: target, cardinality: 'many-to-one', deletePolicy: policy } }) as Field
const mod = (id: string, fields: Field[] = []): Module => ({ id, name: id, fields }) as unknown as Module
const rec = (id: string, moduleId: string, data: Record<string, unknown> = {}, deletedAt?: string): CrmRecord => ({ id, moduleId, data, deletedAt }) as unknown as CrmRecord

describe('relationship delete policies', () => {
  const parent = mod('parent')
  const records = [rec('p1', 'parent'), rec('p2', 'parent'), rec('c1', 'child', { link: 'p1' }), rec('c2', 'child', { link: 'p1' }), rec('c3', 'child', { link: 'p2' }), rec('gone', 'child', { link: 'p2' }, '2026-01-01')]

  it('restrict blocks while live records point at it, and ignores trashed ones', () => {
    const child = mod('child', [field('link', 'parent', 'restrict')])
    const plan = planDelete(['p1'], [parent, child], records)
    expect(plan.blocked).toEqual([{ recordId: 'p1', byModule: 'child', byField: 'link', count: 2 }])
    expect(plan.remove).toEqual(['p1'])
    expect(describeBlocked(plan, [parent, child], records)).toMatch(/still used by 2 child records/)
    // p2 has one live child (c3) and one trashed one
    expect(planDelete(['p2'], [parent, child], records).blocked[0].count).toBe(1)
  })

  it('cascade pulls the pointing records into the trash, recursively and without looping', () => {
    const child = mod('child', [field('link', 'parent', 'cascade')])
    const grand = mod('grand', [field('up', 'child', 'cascade')])
    const all = [...records, rec('g1', 'grand', { up: 'c1' })]
    const plan = planDelete(['p1'], [parent, child, grand], all)
    expect(plan.blocked).toEqual([])
    expect(plan.remove.sort()).toEqual(['c1', 'c2', 'g1', 'p1'])
    // a self-referencing cascade terminates
    const self = mod('node', [field('parent', 'node', 'cascade')])
    const cyc = [rec('a', 'node', { parent: 'b' }), rec('b', 'node', { parent: 'a' })]
    expect(planDelete(['a'], [self], cyc).remove.sort()).toEqual(['a', 'b'])
  })

  it('set_null keeps the records and clears just that link', () => {
    const child = mod('child', [field('link', 'parent', 'set_null')])
    const plan = planDelete(['p1'], [parent, child], records)
    expect(plan.remove).toEqual(['p1'])
    expect(plan.clear.map((c) => [c.recordId, c.fieldId, c.value])).toEqual([['c1', 'link', null], ['c2', 'link', null]])
    const multi = mod('child', [field('links', 'parent', 'set_null')])
    const m = planDelete(['p1'], [parent, multi], [rec('p1', 'parent'), rec('x', 'child', { links: ['p1', 'p2'] })])
    expect(m.clear[0].value).toEqual(['p2'])
  })

  it('a relationship with no policy (hand-built) changes nothing: the old behaviour is kept', () => {
    const child = mod('child', [field('link', 'parent')])
    const plan = planDelete(['p1'], [parent, child], records)
    expect(plan).toEqual({ remove: ['p1'], clear: [], blocked: [] })
  })

  it('deleting the pointing records together with the target is allowed under restrict', () => {
    const child = mod('child', [field('link', 'parent', 'restrict')])
    expect(planDelete(['p1', 'c1', 'c2'], [parent, child], records).blocked).toEqual([])
  })
})
