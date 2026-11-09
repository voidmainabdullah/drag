import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, beforeAll } from 'vitest'
import { revisionOf } from '#/genius/config/model'
import { readConfig } from '#/genius/config/storePort'
import { acceptProposal, buildStatus, submitProposal } from '#/genius/service/builder'
import { summarizeProposal } from '#/genius/service/summary'
import { fingerprints } from '#/genius/state/fingerprint'
import { useGeniusStore } from '#/genius/state/geniusStore'
import { AutomationsPanel, HistoryPanel } from '#/components/genius/GeniusHistory'
import { ClarifyForm, ProposalView, StatusBadge, StepList, usageLine } from '#/components/genius/GeniusParts'
import { buildSchoolWorld, WS } from './helpers'

const noop = () => {}

describe('Genius UI renders real state (server-side render smoke tests)', () => {
  beforeAll(async () => {
    await buildSchoolWorld()
  })

  const patchProposal = () => {
    const cfg = readConfig(WS)
    const raw = { schemaVersion: 1, expected_revision: revisionOf(cfg), summary: 'Remove the academic year', ops: [{ op: 'remove_field', moduleId: cfg.modules.find((m) => m.name === 'Classes')!.id, id: 'academic_year' }] }
    return submitProposal(WS, { kind: 'patch', raw, request: 'drop academic year', intent: 'modify', baseFingerprints: fingerprints(cfg), assumptions: ['You do not need old academic years.'] })
  }

  it('summarises a proposal: created / modified / removed / preserved / assumptions', () => {
    const { proposal } = patchProposal()
    const s = summarizeProposal(proposal, readConfig(WS))
    expect(s.removed.map((c) => c.label)).toEqual(['Classes → Academic year'])
    expect(s.created).toHaveLength(0)
    expect(s.assumptions).toEqual(['You do not need old academic years.'])
    // everything else stays: 7 school modules (Classes is touched via its field), and every form, view, workflow, dashboard
    const cfg = readConfig(WS)
    expect(s.preserved.find((p) => p.kind === 'modules')!.count).toBe(6)
    expect(s.preserved.find((p) => p.kind === 'forms')!.count).toBe(cfg.forms.length)
    expect(s.preserved.find((p) => p.kind === 'views')!.count).toBe(cfg.views.length)
    expect(s.preserved.find((p) => p.kind === 'workflows')!.count).toBe(cfg.workflows.length)
    expect(s.externalAutomation).toBe(false)
  })

  it('shows the build summary for the school build, including what could not be built', async () => {
    const { schoolBlueprint } = await import('./fixtures/school')
    const { projectIdFor } = await import('#/genius/compiler/ids')
    const { proposal, outcome } = submitProposal(WS, { kind: 'build', raw: schoolBlueprint(projectIdFor('user_tenant_a', WS), 'x'), request: 'school', intent: 'new_build' })
    const html = renderToStaticMarkup(<ProposalView proposal={proposal} report={outcome.report} cfg={readConfig(WS)} onAccept={noop} onReject={noop} saving={false} canApply />)
    expect(html).toContain('aria-label="Build summary"')
    expect(html).toContain('Not implementable')
    expect(html).toContain('Email the guardian when a fee is overdue')
    expect(html).toContain('Needs your approval')
    expect(html).toContain('Fee reminder the day after the due date')
    expect(html).toContain('Stages run: schema')
    expect(html).toContain('aria-label="Validation report"')
  })

  it('a destructive proposal is labelled, and Apply is only enabled when the user may apply', () => {
    const { proposal, outcome } = patchProposal()
    const on = renderToStaticMarkup(<ProposalView proposal={proposal} report={outcome.report} cfg={readConfig(WS)} onAccept={noop} onReject={noop} saving={false} canApply />)
    expect(on).toContain('removes data definition')
    expect(on).toContain('Apply change')
    const applyDisabled = (html: string) => /<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Apply change/s.test(html)
    expect(applyDisabled(on)).toBe(false)
    const off = renderToStaticMarkup(<ProposalView proposal={proposal} cfg={readConfig(WS)} onAccept={noop} onReject={noop} saving={false} canApply={false} />)
    expect(applyDisabled(off)).toBe(true)
    // a proposal with problems cannot be applied either
    expect(applyDisabled(renderToStaticMarkup(<ProposalView proposal={{ ...proposal, state: 'draft' }} cfg={readConfig(WS)} onAccept={noop} onReject={noop} saving={false} canApply />))).toBe(true)
  })

  it('steps are rendered from real step events with their measured time; unreached steps are not shown', () => {
    const html = renderToStaticMarkup(<StepList running steps={[{ id: 'understand', label: 'Understanding your request', status: 'done', detail: 'new build', ms: 3 }, { id: 'design', label: 'Designing with AI', status: 'running' }]} />)
    expect(html).toContain('Understanding your request')
    expect(html).toContain('3 ms')
    expect(html).toContain('Designing with AI')
    expect(html).not.toContain('Checking the design')
    expect(html).toContain('aria-live="polite"')
  })

  it('clarifying questions render with labelled inputs', () => {
    const html = renderToStaticMarkup(<ClarifyForm onSubmit={noop} questions={[{ id: 'currency', question: 'Which currency do you charge in?', why: 'Money totals must be in one currency.', options: ['GBP', 'USD'] }]} />)
    expect(html).toContain('Which currency do you charge in?')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Answer: Which currency do you charge in?"')
  })

  it('status badge shows the state and the external-automation flag', () => {
    const a = renderToStaticMarkup(<StatusBadge status="validated" label="Validated: waiting for you to accept" externalAutomation />)
    expect(a).toContain('Validated')
    expect(a).toContain('External automation needed')
    expect(renderToStaticMarkup(<StatusBadge status="active" label="x" externalAutomation={false} />)).not.toContain('External automation')
  })

  it('token numbers are labelled as real or mocked', () => {
    expect(usageLine({ inputTokens: 1000, outputTokens: 200, cachedTokens: 800, calls: 1, latencyMs: 1500, source: 'mock' })).toContain('MOCKED')
    expect(usageLine({ inputTokens: 1000, outputTokens: 200, cachedTokens: 800, calls: 1, latencyMs: 1500, source: 'groq' })).toContain('reported by Groq')
    expect(usageLine(undefined)).toBe('No AI call was needed.')
  })

  it('history lists versions with undo buttons, and automations list AI workflows awaiting approval', () => {
    const { proposal } = patchProposal()
    // accept a harmless proposal so there are two versions
    const cfg = readConfig(WS)
    const ok = submitProposal(WS, { kind: 'patch', raw: { schemaVersion: 1, expected_revision: revisionOf(cfg), summary: 'Add room', ops: [{ op: 'add_field', moduleId: cfg.modules.find((m) => m.name === 'Classes')!.id, field: { id: 'room', label: 'Room', type: 'shortText' } }] }, request: 'add room', intent: 'modify', baseFingerprints: fingerprints(cfg) }).proposal
    expect(proposal.id).not.toBe(ok.id)
    expect(acceptProposal(ok.id).ok).toBe(true)
    // zustand renders its INITIAL state on the server, so these panels show their empty states here; the live behaviour
    // (undo, restore, approval) is covered against the real stores in integrity.test.ts
    expect(renderToStaticMarkup(<HistoryPanel canUndo />)).toContain('No versions yet')
    expect(renderToStaticMarkup(<AutomationsPanel canManage />)).toContain('No AI-built automations')
    // the badge logic itself runs against the live stores
    expect(buildStatus(WS).status).toBe('published')
    const pending = submitProposal(WS, { kind: 'patch', raw: { schemaVersion: 1, expected_revision: revisionOf(readConfig(WS)), summary: 'x', ops: [{ op: 'add_field', moduleId: readConfig(WS).modules[0].id, field: { id: 'zz', label: 'Zz', type: 'shortText' } }] }, request: 'x', intent: 'modify' }).proposal
    expect(buildStatus(WS).status).toBe(pending.state === 'validated' ? 'validated' : 'draft')
    expect(useGeniusStore.getState().proposals.some((p) => p.id === pending.id)).toBe(true)
  })
})
