import { addDays, format } from 'date-fns'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CrmRecord, Module } from '#/types'
import { useWorkflowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useUserStore } from '#/stores/userStore'
import { computeWidgetData } from '#/utils/metrics'
import { useDashboardStore } from '#/stores/collections'
import { makeCtx, valueOf } from '#/utils/records'
import { projectIdFor, storeId } from '#/genius/compiler/ids'
import { acceptProposal, approveWorkflow, setWorkflowEnabled, submitProposal } from '#/genius/service/builder'
import { handleRecordEvent, runDateTriggers } from '#/services/workflowEngine'
import { resetWorld, TENANT, WS } from './helpers'
import { lettingBlueprint } from './fixtures/letting'

const mid = (id: string) => storeId('module', WS, id)
const mod = (id: string): Module => useModuleStore.getState().modules.find((m) => m.id === mid(id))!
const ctx = () => makeCtx(useModuleStore.getState().modules, useRecordStore.getState().records, useUserStore.getState().users)
const rec = (id: string) => useRecordStore.getState().records.find((r) => r.id === id)!
const val = (m: string, r: CrmRecord, field: string) => valueOf(mod(m), rec(r.id), mod(m).fields.find((f) => f.id === field)!, ctx())
let n = 0
function create(moduleKey: string, data: Record<string, unknown>) {
  const res = useRecordStore.getState().create(mid(moduleKey), data)
  if (!res.record) throw new Error(`${moduleKey}: ${JSON.stringify(res.errors)}`)
  return res.record
}
const property = (address: string, landlord: CrmRecord) => create('properties', { address, landlord: landlord.id, monthly_rent: 1000 })
const enquire = (p: CrmRecord, name: string) => create('enquiries', { name, property: p.id })
const lease = (p: CrmRecord, tenant: CrmRecord, extra: Record<string, unknown> = {}) => create('tenancies', { reference: `T-${++n}`, start_date: '2026-01-01', rent: 1000, property: p.id, tenant: tenant.id, ...extra })
const pay = (t: CrmRecord, p: CrmRecord, amount: number) => create('rent_payments', { amount, paid_on: '2026-02-01', reference: `R-${++n}`, tenancy: t.id, property: p.id })

describe('Letting agency CRM (mocked model output, real validator/compiler/stores)', () => {
  beforeAll(() => {
    resetWorld()
    const { proposal, outcome } = submitProposal(WS, { kind: 'build', raw: lettingBlueprint(projectIdFor(TENANT, WS), 'rev_none'), request: 'Create a CRM for my letting agency', intent: 'new_build' })
    expect(outcome.report.errors).toEqual([])
    expect(acceptProposal(proposal.id).ok).toBe(true)
  })

  it('builds the six modules, with the workflows switched off and awaiting approval', () => {
    expect(useModuleStore.getState().modules.map((m) => m.name).sort()).toEqual(['Enquiries', 'Landlords', 'Properties', 'Rent payments', 'Tenancies', 'Tenants'])
    expect(useWorkflowStore.getState().items.every((w) => !w.enabled && w.origin === 'ai')).toBe(true)
  })

  const landlord = () => create('landlords', { full_name: `Landlord ${++n}` })

  it('one landlord can own several properties, each with several enquiries', () => {
    const l = landlord()
    const p1 = property(`1 High St ${++n}`, l)
    const p2 = property(`2 High St ${++n}`, l)
    enquire(p1, 'A'); enquire(p1, 'B'); enquire(p1, 'C'); enquire(p2, 'D')
    expect(val('properties', p1, 'enquiry_count')).toBe(3)
    expect(val('properties', p2, 'enquiry_count')).toBe(1)
    expect(useRecordStore.getState().records.filter((r) => r.moduleId === mid('properties') && r.data.landlord === l.id)).toHaveLength(2)
    // a landlord that still owns properties cannot be removed silently
    expect(useRecordStore.getState().create(mid('properties'), { address: 'No landlord' }).record).toBeUndefined()
  })

  it('delete policy "restrict" is enforced: a landlord or property that is still in use cannot be trashed', () => {
    const l = landlord()
    const p = property(`8 Restrict Rd ${++n}`, l)
    const blocked = useRecordStore.getState().softDelete([l.id])
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toMatch(/still used by 1 Properties record/)
    expect(rec(l.id).deletedAt).toBeUndefined()
    const t = lease(p, create('tenants', { full_name: 'Rita Restrict' }))
    expect(useRecordStore.getState().softDelete([p.id]).ok).toBe(false)
    // once nothing points at it, it can go
    expect(useRecordStore.getState().softDelete([t.id]).ok).toBe(true)
    expect(useRecordStore.getState().softDelete([p.id]).ok).toBe(true)
    expect(useRecordStore.getState().softDelete([l.id]).ok).toBe(true)
    // restoring is still possible
    useRecordStore.getState().restore([l.id])
    expect(rec(l.id).deletedAt).toBeUndefined()
  })

  it('a tenant is linked to a tenancy, and rent is allocated to the tenancy and the property', () => {
    const l = landlord()
    const p = property(`3 Mill Lane ${++n}`, l)
    const tenant = create('tenants', { full_name: 'Tess Tenant', email: 'tess@example.com' })
    const t1 = lease(p, tenant)
    const t2 = lease(p, create('tenants', { full_name: 'Tom Second' }), {})
    pay(t1, p, 500.1); pay(t1, p, 499.9); pay(t2, p, 250)
    expect(String(val('tenancies', t1, 'paid_to_date'))).toBe('1000')
    expect(String(val('tenancies', t2, 'paid_to_date'))).toBe('250')
    // property income is the sum across both tenancies, exactly
    expect(String(val('properties', p, 'income_received'))).toBe('1250')
    expect(val('properties', p, 'active_tenancies')).toBe(2)
  })

  it('tenancy ending: needs notice first, and an end date before it can end; ended tenancies stop counting as active', () => {
    const p = property(`4 Park Rd ${++n}`, landlord())
    const t = lease(p, create('tenants', { full_name: 'Ned Ending' }))
    const skip = useRecordStore.getState().update(t.id, { tenancy_stage: 'ended' })
    expect(JSON.stringify(skip?.errors)).toContain('cannot move')
    expect(useRecordStore.getState().update(t.id, { tenancy_stage: 'notice' })?.record).toBeTruthy()
    const noEnd = useRecordStore.getState().update(t.id, { tenancy_stage: 'ended' })
    expect(JSON.stringify(noEnd?.errors)).toContain('End date')
    useRecordStore.getState().update(t.id, { end_date: '2026-03-01' })
    expect(useRecordStore.getState().update(t.id, { tenancy_stage: 'ended' })?.record).toBeTruthy()
    expect(val('properties', p, 'active_tenancies')).toBe(0)
  })

  describe('"tenant pays rent -> update property income" workflow', () => {
    let wf = ''
    beforeAll(() => {
      wf = useWorkflowStore.getState().items.find((w) => w.id.endsWith('rent_received'))!.id
    })
    it('cannot run before approval', () => {
      expect(setWorkflowEnabled(wf, true)).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
    })
    it('after approval it ticks the payment once, and income reflects the payment', () => {
      expect(approveWorkflow(wf, 'reviewed').ok).toBe(true)
      expect(setWorkflowEnabled(wf, true).ok).toBe(true)
      const p = property(`5 Quay St ${++n}`, landlord())
      const t = lease(p, create('tenants', { full_name: 'Pia Payer' }))
      const before = String(val('properties', p, 'income_received'))
      const payment = pay(t, p, 800)
      expect(before).toBe('0')
      // the store does not fire workflows by itself in this harness: deliver the event twice (duplicate webhook)
      const ev = { type: 'created' as const, record: rec(payment.id), depth: 0, eventId: 'evt_rent_1' }
      handleRecordEvent(ev)
      handleRecordEvent(ev)
      expect(rec(payment.id).data.allocated).toBe(true)
      expect(String(val('properties', p, 'income_received'))).toBe('800')
    })
  })

  it('a tenancy-ending follow-up is created once on the right day and not again on a repeated tick', () => {
    const wf = useWorkflowStore.getState().items.find((w) => w.id.endsWith('tenancy_ending'))!
    approveWorkflow(wf.id)
    expect(setWorkflowEnabled(wf.id, true).ok).toBe(true)
    const p = property(`7 Dock Rd ${++n}`, landlord())
    lease(p, create('tenants', { full_name: 'Ed Ender' }), { end_date: format(addDays(new Date(), 30), 'yyyy-MM-dd') })
    const tm = () => useModuleStore.getState().modules.find((m) => m.system === 'tasks')
    const count = () => (tm() ? useRecordStore.getState().records.filter((r) => r.moduleId === tm()!.id).length : 0)
    const base = count()
    runDateTriggers()
    expect(count()).toBe(base + 1)
    runDateTriggers()
    expect(count()).toBe(base + 1)
  })

  it('dashboards and role scoping: the negotiator sees enquiries but not rent', () => {
    const dash = useDashboardStore.getState().items.find((d) => d.name === 'Lettings overview')!
    const neg = { userId: 'u_n', role: useUserStore.getState().roles.find((r) => r.id === 'role_ai_negotiator')! }
    const rentW = dash.widgets.find((w) => w.title === 'Rent received')!
    const enqW = dash.widgets.find((w) => w.title === 'Enquiries')!
    const m = useModuleStore.getState().modules
    const r = useRecordStore.getState().records
    expect(computeWidgetData(rentW, m, r, ctx(), new Date(), neg)).toMatchObject({ kind: 'empty' })
    expect(computeWidgetData(enqW, m, r, ctx(), new Date(), neg)).toMatchObject({ kind: 'value' })
    const total = r.filter((x) => x.moduleId === mid('rent_payments')).reduce((a, x) => a + Number(x.data.amount), 0)
    expect((computeWidgetData(rentW, m, r, ctx()) as { value: number }).value).toBeCloseTo(total, 6)
  })
})
