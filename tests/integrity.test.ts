import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { useRunStore, useWorkflowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { getStorageNamespace, setStorageNamespace, storageKey } from '#/services/storage/storageService'
import { storeId } from '#/genius/compiler/ids'
import { revisionOf } from '#/genius/config/model'
import { readConfig } from '#/genius/config/storePort'
import { acceptProposal, commitConfig, submitProposal, undoVersion } from '#/genius/service/builder'
import { applyProposal, activateWorkflow, historyOf, reviewWorkflow, rollback } from '#/genius/service/actions'
import { fingerprints } from '#/genius/state/fingerprint'
import { useGeniusStore } from '#/genius/state/geniusStore'
import { getTenantId, setTenantId } from '#/genius/tenant'
import { onRecordEvent } from '#/utils/events'
import { handleRecordEvent } from '#/services/workflowEngine'
import type { Workflow } from '#/types'
import { buildSchoolWorld, resetWorld, WS } from './helpers'

const cfg = () => readConfig(WS)
const moduleByName = (name: string) => cfg().modules.find((m) => m.name === name)!
const addField = (moduleName: string, id: string, label: string, rev = revisionOf(cfg())) => ({
  schemaVersion: 1,
  expected_revision: rev,
  summary: `Add ${label} to ${moduleName}`,
  ops: [{ op: 'add_field', moduleId: moduleByName(moduleName).id, field: { id, label, type: 'shortText' } }],
})
const propose = (raw: unknown, baseFingerprints = fingerprints(cfg())) => submitProposal(WS, { kind: 'patch', raw, request: 'change', intent: 'modify', baseFingerprints }).proposal
const fieldLabels = (moduleName: string) => moduleByName(moduleName).fields.map((f) => f.label)

describe('versions, stale revisions and failed writes (real stores)', () => {
  beforeEach(async () => {
    await buildSchoolWorld()
  })

  it('stale revision: a change to something nobody touched since is rebased; a change to something that moved is refused, and nothing is overwritten', () => {
    const designedAt = revisionOf(cfg())
    const baseFp = fingerprints(cfg())
    const a = propose(addField('Guardians', 'consent', 'Consent', designedAt), baseFp)
    expect(a.state).toBe('validated')
    expect(acceptProposal(a.id).ok).toBe(true)
    expect(revisionOf(cfg())).not.toBe(designedAt)

    // designed against the OLD revision, but Classes has not changed since: safe to apply
    const unrelated = propose(addField('Classes', 'room', 'Room', designedAt), baseFp)
    expect(unrelated.state).toBe('validated')
    expect(acceptProposal(unrelated.id).ok).toBe(true)
    expect(fieldLabels('Classes')).toContain('Room')

    // designed against the OLD revision and touching Guardians, which has since changed: refused
    const conflicting = propose(addField('Guardians', 'notes2', 'More notes', designedAt), baseFp)
    expect(conflicting.state).toBe('draft')
    expect(conflicting.issues.some((i) => i.code === 'STALE_CONFLICT')).toBe(true)
    const before = revisionOf(cfg())
    expect(acceptProposal(conflicting.id).ok).toBe(false)
    expect(revisionOf(cfg())).toBe(before)
    expect(fieldLabels('Guardians')).toContain('Consent')
    expect(fieldLabels('Guardians')).not.toContain('More notes')
  })

  it('a proposal that no longer validates leaves the CRM byte-for-byte intact', () => {
    const before = JSON.stringify(cfg())
    const bad = propose({ schemaVersion: 1, expected_revision: revisionOf(cfg()), summary: 'bad', ops: [{ op: 'add_field', moduleId: 'mod_does_not_exist', field: { id: 'x', label: 'X', type: 'shortText' } }] })
    expect(bad.state).toBe('draft')
    expect(acceptProposal(bad.id).ok).toBe(false)
    expect(JSON.stringify(cfg())).toBe(before)
    expect(useGeniusStore.getState().versions).toHaveLength(1)
  })

  it('a write that fails half way is rolled back completely (no half-built CRM, no version, no nav change)', () => {
    const live = cfg()
    const before = JSON.stringify(live)
    const next = structuredClone(live)
    next.modules = next.modules.map((m) => (m.name === 'Classes' ? { ...m, name: 'Renamed' } : m))
    const versions = useGeniusStore.getState().versions.length
    const res = commitConfig(next, {
      workspaceId: WS, kind: 'patch', summary: 'will fail', jobKey: 'job_fail', changes: [], warnings: [], navAdds: [], navRemoves: [],
      navFix: () => {
        throw new Error('disk full')
      },
    })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(cfg())).toBe(before)
    expect(useGeniusStore.getState().versions).toHaveLength(versions)
    // and the same job can be retried afterwards because nothing was recorded
    expect(commitConfig(next, { workspaceId: WS, kind: 'patch', summary: 'retry', jobKey: 'job_fail', changes: [], warnings: [], navAdds: [], navRemoves: [] }).ok).toBe(true)
    expect(moduleByName('Renamed')).toBeTruthy()
  })

  it('retrying an accepted change (double click, network retry) creates nothing twice', () => {
    const p = propose(addField('Classes', 'room', 'Room'))
    const first = acceptProposal(p.id)
    const second = acceptProposal(p.id)
    expect(first.ok && !first.duplicate).toBe(true)
    expect(second.ok && second.duplicate).toBe(true)
    expect(moduleByName('Classes').fields.filter((f) => f.label === 'Room')).toHaveLength(1)
    expect(historyOf(WS)).toHaveLength(2)
    // the same ops submitted again as a NEW proposal are rejected by the validator rather than duplicating the field
    const again = propose(addField('Classes', 'room', 'Room'))
    expect(again.state).toBe('draft')
  })

  it('undo does not overwrite a manual edit made after the change', () => {
    const p = propose(addField('Guardians', 'consent', 'Consent'))
    const res = acceptProposal(p.id)
    if (!res.ok) throw new Error('setup')
    // a person renames the new field by hand
    const guardians = moduleByName('Guardians')
    useModuleStore.getState().update(guardians.id, { fields: guardians.fields.map((f) => (f.label === 'Consent' ? { ...f, label: 'Photo consent' } : f)) })
    const undo = undoVersion(res.version.id)
    expect(undo.ok).toBe(false)
    expect(undo.ok === false && 'conflicts' in undo && undo.conflicts.join(' ')).toMatch(/edited after this change/)
    expect(fieldLabels('Guardians')).toContain('Photo consent')
    expect(historyOf(WS).find((v) => v.id === res.version.id)?.undone).toBeUndefined()
  })

  it('undo of an older change keeps later edits to OTHER components', () => {
    const a = acceptProposal(propose(addField('Guardians', 'consent', 'Consent')).id)
    const b = acceptProposal(propose(addField('Classes', 'room', 'Room')).id)
    if (!a.ok || !b.ok) throw new Error('setup')
    const r = rollback(a.version.id)
    expect(r.ok).toBe(true)
    expect(fieldLabels('Guardians')).not.toContain('Consent')
    expect(fieldLabels('Classes')).toContain('Room')
    expect(rollback(a.version.id).ok).toBe(false) // already undone
  })

  it('applying a destructive proposal needs an explicit confirmation', () => {
    const p = propose({ schemaVersion: 1, expected_revision: revisionOf(cfg()), summary: 'Remove the academic year', ops: [{ op: 'remove_field', moduleId: moduleByName('Classes').id, id: 'academic_year' }] })
    expect(p.state).toBe('validated')
    expect(p.changes.some((c) => c.destructive)).toBe(true)
    const r = applyProposal(p.id)
    expect(r.ok).toBe(false)
    expect(fieldLabels('Classes')).toContain('Academic year')
    expect(applyProposal(p.id, { confirmDestructive: true }).ok).toBe(true)
    expect(fieldLabels('Classes')).not.toContain('Academic year')
  })
})

describe('workflow activation is an explicit, reviewed action', () => {
  beforeEach(async () => {
    await buildSchoolWorld()
  })
  const reminder = () => useWorkflowStore.getState().items.find((w) => w.id.endsWith('fee_reminder'))!

  it('refuses without the approval flag, then without a reviewed dry run, then succeeds', () => {
    expect(activateWorkflow(reminder().id, { approved: false })).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    expect(activateWorkflow(reminder().id, { approved: true })).toMatchObject({ ok: false, code: 'DRY_RUN_REQUIRED' })
    expect(reminder().enabled).toBe(false)
    expect(reviewWorkflow(reminder().id)).toBeTruthy()
    expect(activateWorkflow(reminder().id, { approved: true, note: 'looked at the dry run' })).toEqual({ ok: true })
    expect(reminder().enabled).toBe(true)
  })

  it('a dry run made BEFORE the workflow was edited does not count', async () => {
    reviewWorkflow(reminder().id)
    await new Promise((r) => setTimeout(r, 5))
    useWorkflowStore.getState().update(reminder().id, { actions: [{ id: 'a1', type: 'notify', message: 'changed' }] })
    expect(activateWorkflow(reminder().id, { approved: true })).toMatchObject({ ok: false, code: 'DRY_RUN_REQUIRED' })
  })
})

describe('workflow loops (live event bus)', () => {
  let off = () => {}
  beforeAll(async () => {
    await buildSchoolWorld()
  })
  beforeEach(() => {
    off = onRecordEvent(handleRecordEvent)
  })
  afterEach(() => off())

  it('two workflows that undo each other stop after one lap, with a recorded reason, and the data settles', () => {
    const students = storeId('module', WS, 'students')
    const mk = (id: string, trigger: string, setField: string, value: unknown): Workflow => ({
      id, workspaceId: WS, moduleId: students, name: id, enabled: true, origin: 'manual',
      trigger: { type: 'field_changed', fieldId: trigger }, conditions: [], actions: [{ id: 'a1', type: 'update_record', fieldId: setField, value }],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    // A: when first_name changes -> set last_name 'Alpha'.  B: when last_name changes -> set first_name 'Beta'.  Together an endless ping-pong.
    useWorkflowStore.getState().add(mk('loop_a', 'first_name', 'last_name', 'Alpha'))
    useWorkflowStore.getState().add(mk('loop_b', 'last_name', 'first_name', 'Beta'))
    const created = useRecordStore.getState().create(storeId('module', WS, 'students'), { first_name: 'Zed', last_name: 'Zee', admission_no: 'LOOP-1' })
    const id = created.record!.id
    const runsBefore = useRunStore.getState().runs.length
    useRecordStore.getState().update(id, { first_name: 'Changed' })
    const runs = useRunStore.getState().runs.slice(0, useRunStore.getState().runs.length - runsBefore + 0)
    expect(runs.length).toBeLessThan(20)
    expect(useRunStore.getState().runs.some((r) => /loop (prevention|protection)/.test(r.message))).toBe(true)
    const final = useRecordStore.getState().records.find((r) => r.id === id)!
    expect(['Alpha', 'Zee']).toContain(final.data.last_name)
    expect(['Beta', 'Changed']).toContain(final.data.first_name)
  })
})

describe('tenant isolation of what is remembered', () => {
  const was = { ns: getStorageNamespace(), tenant: getTenantId() }
  afterEach(() => {
    setStorageNamespace(was.ns)
    setTenantId(was.tenant)
  })
  it('storage keys are namespaced per user id and cannot be escaped', () => {
    setStorageNamespace('user_a')
    const a = storageKey('crm:genius')
    setStorageNamespace('user_b')
    const b = storageKey('crm:genius')
    expect(a).not.toBe(b)
    expect(a).toContain('user_a')
    expect(b).toContain('user_b')
    expect(() => setStorageNamespace('../other')).toThrow()
    expect(() => setStorageNamespace('a:b')).toThrow()
  })
  it('an unsafe tenant id falls back to a harmless local tenant instead of being used in cache keys', () => {
    setTenantId('user_a')
    expect(getTenantId()).toBe('user_a')
    setTenantId('a|b')
    expect(getTenantId()).toBe('local')
    setTenantId(null)
    expect(getTenantId()).toBe('local')
  })
  it('the project id embeds the tenant, so the same workspace id under two tenants never collides', async () => {
    const { projectIdFor } = await import('#/genius/compiler/ids')
    expect(projectIdFor('user_a', 'ws_1')).not.toBe(projectIdFor('user_b', 'ws_1'))
  })
})

void resetWorld
