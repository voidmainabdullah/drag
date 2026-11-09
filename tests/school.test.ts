import { addDays, format } from 'date-fns'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CrmRecord, Module } from '#/types'
import { useDashboardStore, useFormStore, useRunStore, useViewStore, useWorkflowStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUserStore } from '#/stores/userStore'
import { computeWidgetData } from '#/utils/metrics'
import { displayValue, makeCtx, valueOf } from '#/utils/records'
import { projectIdFor, storeId } from '#/genius/compiler/ids'
import { acceptProposal, approveWorkflow, buildStatus, setWorkflowEnabled, submitProposal } from '#/genius/service/builder'
import { useGeniusStore } from '#/genius/state/geniusStore'
import { verifyAudit } from '#/genius/state/audit'
import { previewWorkflow } from '#/genius/workflow/preview'
import { runDateTriggers, runWorkflowNow, handleRecordEvent } from '#/services/workflowEngine'
import { roleById, resetWorld, TENANT, WS } from './helpers'
import { schoolBlueprint } from './fixtures/school'

const mid = (id: string) => storeId('module', WS, id)
const mod = (id: string): Module => useModuleStore.getState().modules.find((m) => m.id === mid(id))!
const ctx = () => makeCtx(useModuleStore.getState().modules, useRecordStore.getState().records, useUserStore.getState().users)
const val = (m: Module, r: CrmRecord, field: string) => valueOf(m, r, m.fields.find((f) => f.id === field)!, ctx())
const shown = (m: Module, r: CrmRecord, field: string) => displayValue(m.fields.find((f) => f.id === field)!, val(m, r, field), ctx())
const rec = (id: string) => useRecordStore.getState().records.find((r) => r.id === id)!

function create(moduleKey: string, data: Record<string, unknown>) {
  const res = useRecordStore.getState().create(mid(moduleKey), data)
  if (!res.record) throw new Error(`${moduleKey}: ${JSON.stringify(res.errors)}`)
  return res.record
}
let n = 0
const student = (first: string, extra: Record<string, unknown> = {}) => create('students', { first_name: first, last_name: 'Test', admission_no: `ADM-${++n}`, ...extra })
const charge = (s: CrmRecord, amount: number, due: string) => create('fee_charges', { description: `Term fees ${++n}`, amount, due_date: due, student: s.id, reference: `FC-${n}` })
const pay = (s: CrmRecord, amount: number, kind = 'payment') => create('payments', { amount, paid_on: '2026-01-05', kind, student: s.id, reference: `RC-${++n}` })
const PAST = '2020-01-01'
const FUTURE = '2099-01-01'

beforeAll(() => {
  resetWorld()
})

describe('School academy CRM: first milestone (mocked model output, real validator/compiler/stores)', () => {
  let proposalId = ''

  it('validates the blueprint through all six stages and reports what it could not build', () => {
    const { proposal, outcome } = submitProposal(WS, { kind: 'build', raw: schoolBlueprint(projectIdFor(TENANT, WS), 'rev_none'), request: 'Create a CRM for my school academy', intent: 'new_build' })
    proposalId = proposal.id
    expect(outcome.report.errors).toEqual([])
    expect(proposal.state).toBe('validated')
    expect(outcome.report.stagesRun).toEqual(['schema', 'references', 'business', 'cycles', 'security', 'sandbox'])
    // honest reporting: the e-mail workflow cannot be executed by this app, so it is left out and listed
    expect(proposal.notImplementable.map((i) => i.path)).toEqual(['workflows.email_guardian'])
    expect(proposal.needsApproval.map((w) => w.name)).toEqual(['Fee reminder the day after the due date'])
    expect(buildStatus(WS).status).toBe('validated')
    // nothing has been written yet
    expect(useModuleStore.getState().modules).toHaveLength(0)
  })

  it('compiles into the real stores atomically and records a version + audit trail', () => {
    const res = acceptProposal(proposalId)
    expect(res.ok).toBe(true)
    const modules = useModuleStore.getState().modules
    expect(modules.map((m) => m.name).sort()).toEqual(['Attendance', 'Classes', 'Fee charges', 'Fines', 'Guardians', 'Payments', 'Students'])
    expect(useFormStore.getState().items.some((f) => f.name === 'Mark attendance')).toBe(true)
    expect(useViewStore.getState().items.some((v) => v.name === 'Admission stage board')).toBe(true)
    expect(useDashboardStore.getState().items).toHaveLength(1)
    const wfs = useWorkflowStore.getState().items
    expect(wfs).toHaveLength(2)
    expect(wfs.every((w) => !w.enabled && w.origin === 'ai')).toBe(true)
    expect(wfs.find((w) => w.id.endsWith('fee_reminder'))?.consequential).toBe(true)
    expect(wfs.find((w) => w.id.endsWith('welcome_new_student'))?.consequential).toBe(false)
    // the sidebar shows them next to manual modules
    expect(useSettingsStore.getState().getNav(WS).filter((i) => i.type === 'module')).toHaveLength(7)
    const g = useGeniusStore.getState()
    expect(g.versions).toHaveLength(1)
    expect(g.versions[0]).toMatchObject({ number: 1, kind: 'build', compilerVersion: expect.stringContaining('genius-compiler') })
    expect(g.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['proposal_created', 'config_changed', 'permission_changed', 'proposal_accepted']))
    expect(verifyAudit(g.audit).ok).toBe(true)
    expect(buildStatus(WS).status).toBe('published')
  })

  it('accepting twice, or re-running the same build, creates nothing twice', () => {
    const again = acceptProposal(proposalId)
    expect(again.ok && again.duplicate).toBe(true)
    const before = JSON.stringify([useModuleStore.getState().modules.length, useFormStore.getState().items.length, useViewStore.getState().items.length, useWorkflowStore.getState().items.length])
    const { proposal } = submitProposal(WS, { kind: 'build', raw: schoolBlueprint(projectIdFor(TENANT, WS), 'rev_none'), request: 'again', intent: 'new_build' })
    expect(proposal.state).toBe('validated')
    expect(acceptProposal(proposal.id).ok).toBe(true)
    expect(JSON.stringify([useModuleStore.getState().modules.length, useFormStore.getState().items.length, useViewStore.getState().items.length, useWorkflowStore.getState().items.length])).toBe(before)
  })

  it('creates real students, classes, guardians and links them', () => {
    const g = create('guardians', { full_name: 'Pat Parent', phone: '+447911123456', email: 'pat@example.com' })
    const c = create('classes', { name: '9A', year_group: 'y9', academic_year: '2026/27' })
    const s = student('Amy', { guardian: g.id, class_group: c.id })
    expect(shown(mod('students'), s, 'display_title')).toBe('Amy Test')
    expect(useRecordStore.getState().records.filter((r) => r.moduleId === mid('students'))).toHaveLength(1)
    expect(useRecordStore.getState().records.find((r) => r.id === s.id)!.data.guardian).toBe(g.id)
  })

  it('marks attendance and refuses a second mark for the same student and day', () => {
    const s = student('Ben')
    expect(create('attendance', { student: s.id, attended_on: '2026-02-02', status: 'present' }).id).toBeTruthy()
    const dup = useRecordStore.getState().create(mid('attendance'), { student: s.id, attended_on: '2026-02-02', status: 'absent' })
    expect(dup.record).toBeUndefined()
    expect(JSON.stringify(dup.errors)).toContain('already exists')
    expect(useRecordStore.getState().create(mid('attendance'), { attended_on: '2026-02-03', status: 'present' }).errors).toBeTruthy()
  })

  it('enforces the admission pipeline: no skipping stages, required fields before a stage', () => {
    const s = student('Cara')
    const m = mod('students')
    const skip = useRecordStore.getState().update(s.id, { admission_stage: 'enrolled' })
    expect(JSON.stringify(skip?.errors)).toContain('cannot move')
    expect(useRecordStore.getState().update(s.id, { admission_stage: 'applied' })?.record).toBeTruthy()
    const noDob = useRecordStore.getState().update(s.id, { admission_stage: 'offered' })
    expect(JSON.stringify(noDob?.errors)).toContain('Date of birth')
    useRecordStore.getState().update(s.id, { date_of_birth: '2012-05-01' })
    expect(useRecordStore.getState().update(s.id, { admission_stage: 'offered' })?.record).toBeTruthy()
    expect(rec(s.id).stageEnteredAt?.admission_stage).toBeTruthy()
    expect(m.fields.find((f) => f.id === 'admission_stage')?.pipeline?.trackTimeInStage).toBe(true)
  })

  describe('fees: Outstanding = Total fees + Fines - Payments, every payment case', () => {
    const cases: { name: string; setup: (s: CrmRecord) => void; outstanding: string; status: string }[] = [
      { name: 'paid', setup: (s) => { charge(s, 1200.1, FUTURE); create('fines', { reason: 'Late', amount: 20.05, student: s.id, reference: `FN-${++n}` }); pay(s, 1220.15) }, outstanding: '0', status: 'Paid' },
      { name: 'partially paid', setup: (s) => { charge(s, 1000, FUTURE); pay(s, 400.1); pay(s, 99.9) }, outstanding: '500', status: 'Partially paid' },
      { name: 'unpaid', setup: (s) => { charge(s, 1000, FUTURE) }, outstanding: '1000', status: 'Unpaid' },
      { name: 'overdue', setup: (s) => { charge(s, 1000, PAST); pay(s, 250) }, outstanding: '750', status: 'Overdue' },
      { name: 'refunded', setup: (s) => { charge(s, 100, FUTURE); pay(s, 100); pay(s, 100, 'refund') }, outstanding: '100', status: 'Refunded' },
      { name: 'overpaid', setup: (s) => { charge(s, 100, FUTURE); pay(s, 130) }, outstanding: '-30', status: 'Overpaid' },
      { name: 'no charges yet', setup: () => {}, outstanding: '0', status: 'No charges' },
    ]
    for (const c of cases) {
      it(c.name, () => {
        const s = student(c.name)
        c.setup(s)
        const m = mod('students')
        const r = rec(s.id)
        expect(String(val(m, r, 'outstanding'))).toBe(c.outstanding)
        expect(val(m, r, 'fee_status')).toBe(c.status)
      })
    }
    it('floating point traps do not appear on money totals', () => {
      const s = student('Float')
      charge(s, 0.3, FUTURE)
      pay(s, 0.1)
      pay(s, 0.2)
      expect(String(val(mod('students'), rec(s.id), 'outstanding'))).toBe('0')
      expect(val(mod('students'), rec(s.id), 'fee_status')).toBe('Paid')
    })
  })

  describe('fee reminder: dry run, then approval, then it really runs', () => {
    let reminderId = ''
    let overdueStudent: CrmRecord
    beforeAll(() => {
      reminderId = useWorkflowStore.getState().items.find((w) => w.id.endsWith('fee_reminder'))!.id
      overdueStudent = student('Dora')
      const yesterday = format(addDays(new Date(), -1), 'yyyy-MM-dd')
      charge(overdueStudent, 500, yesterday)
      const settled = charge(overdueStudent, 300, yesterday)
      useRecordStore.getState().update(settled.id, { settled: true })
    })

    it('the dry run lists what would happen and changes nothing', () => {
      const recordsBefore = useRecordStore.getState().records.length
      const runsBefore = useRunStore.getState().runs.length
      const p = previewWorkflow(reminderId)!
      expect(p.matching).toBe(1) // the settled charge is excluded by the condition
      expect(p.totals.tasks).toBe(1)
      expect(p.totals.notifications).toBe(1)
      expect(p.consequential).toBe(true)
      expect(p.messagesSent).toBe(0)
      expect(p.sample[0].node.steps[0].summary).toContain('Chase overdue fee')
      expect(useRecordStore.getState().records.length).toBe(recordsBefore)
      expect(useRunStore.getState().runs.length).toBe(runsBefore)
    })

    it('cannot be switched on, or run, before it is approved', () => {
      const gate = setWorkflowEnabled(reminderId, true)
      expect(gate).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' })
      expect(runWorkflowNow(useWorkflowStore.getState().items.find((w) => w.id === reminderId)!).ran).toBe(0)
      expect(useRunStore.getState().runs[0].message).toContain('needs your approval')
    })

    it('runs for real after approval, once, with a frozen step log', () => {
      expect(approveWorkflow(reminderId, 'Reviewed the dry run').ok).toBe(true)
      expect(setWorkflowEnabled(reminderId, true).ok).toBe(true)
      const tasksModule = useModuleStore.getState().modules.find((m) => m.system === 'tasks')
      const before = tasksModule ? useRecordStore.getState().records.filter((r) => r.moduleId === tasksModule.id).length : 0
      runDateTriggers()
      const tm = useModuleStore.getState().modules.find((m) => m.system === 'tasks')!
      const tasks = useRecordStore.getState().records.filter((r) => r.moduleId === tm.id)
      expect(tasks.length).toBe(before + 1)
      expect(String(tasks.at(-1)!.data.title)).toContain('Chase overdue fee')
      const run = useRunStore.getState().runs.find((r) => r.workflowId === reminderId && r.status === 'success')!
      expect(run.steps?.map((s) => s.status)).toEqual(['ok', 'ok'])
      expect(run.frozen).toBe(true)
      // the same tick again (a duplicate scheduler wake-up) does nothing
      runDateTriggers()
      expect(useRecordStore.getState().records.filter((r) => r.moduleId === tm.id).length).toBe(before + 1)
      // editing the workflow invalidates the approval
      useWorkflowStore.getState().update(reminderId, { actions: [{ id: 'a1', type: 'notify', message: 'changed' }] })
      expect(setWorkflowEnabled(reminderId, true)).toMatchObject({ ok: false, code: 'APPROVAL_STALE' })
    })

    it('a duplicate delivery of the same record event runs the enabled workflow once', () => {
      const welcome = useWorkflowStore.getState().items.find((w) => w.id.endsWith('welcome_new_student'))!
      approveWorkflow(welcome.id)
      expect(setWorkflowEnabled(welcome.id, true).ok).toBe(true)
      const s = student('Eve', { date_of_birth: '2012-01-01' })
      const prev = rec(s.id)
      const next = { ...prev, data: { ...prev.data, admission_stage: 'enrolled' }, updatedAt: new Date(Date.now() + 5).toISOString() }
      const event = { type: 'updated' as const, record: next, previous: prev, depth: 0, eventId: 'evt_dup_1' }
      const tm = useModuleStore.getState().modules.find((m) => m.system === 'tasks')!
      const count = () => useRecordStore.getState().records.filter((r) => r.moduleId === tm.id).length
      const base = count()
      handleRecordEvent(event)
      handleRecordEvent(event)
      expect(count()).toBe(base + 1)
      expect(useRunStore.getState().runs.some((r) => r.message.startsWith('Duplicate event ignored'))).toBe(true)
    })
  })

  describe('analytics from real data', () => {
    it('dashboard widgets compute from the records, exactly', () => {
      const dash = useDashboardStore.getState().items[0]
      const modules = useModuleStore.getState().modules
      const records = useRecordStore.getState().records
      const byTitle = Object.fromEntries(dash.widgets.map((w) => [w.title, computeWidgetData(w, modules, records, ctx())]))
      const students = records.filter((r) => r.moduleId === mid('students')).length
      expect(byTitle['Students']).toMatchObject({ kind: 'value', value: students })
      const charged = records.filter((r) => r.moduleId === mid('fee_charges')).reduce((a, r) => a + Number(r.data.amount), 0)
      expect((byTitle['Fees charged'] as { value: number }).value).toBeCloseTo(charged, 6)
      const received = records.filter((r) => r.moduleId === mid('payments') && r.data.kind === 'payment').reduce((a, r) => a + Number(r.data.amount), 0)
      expect((byTitle['Payments received'] as { value: number }).value).toBeCloseTo(received, 6)
      const pipeline = byTitle['Admissions pipeline'] as { points: { key: string; count: number }[] }
      expect(pipeline.points.reduce((a, p) => a + p.count, 0)).toBe(students)
      // every component states what it measures
      expect(dash.widgets.every((w) => (w.definition ?? '').length > 5)).toBe(true)
    })

    it('respects permissions: a teacher cannot see fee totals, a bursar can', () => {
      const dash = useDashboardStore.getState().items[0]
      const modules = useModuleStore.getState().modules
      const records = useRecordStore.getState().records
      const teacher = { userId: 'u_t', role: useUserStore.getState().roles.find((r) => r.id === 'role_ai_teacher')! }
      const bursar = { userId: 'u_b', role: useUserStore.getState().roles.find((r) => r.id === 'role_ai_bursar')! }
      const fees = dash.widgets.find((w) => w.title === 'Fees charged')!
      expect(computeWidgetData(fees, modules, records, ctx(), new Date(), teacher)).toMatchObject({ kind: 'empty' })
      expect(computeWidgetData(fees, modules, records, ctx(), new Date(), bursar)).toMatchObject({ kind: 'value' })
      // the owner role is unaffected
      expect(computeWidgetData(fees, modules, records, ctx(), new Date(), { userId: 'x', role: roleById('role_owner') })).toMatchObject({ kind: 'value' })
    })
  })
})
