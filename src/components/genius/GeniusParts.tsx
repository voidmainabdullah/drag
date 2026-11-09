import { useState } from 'react'
import type { Question } from '#/genius/blueprint/schema'
import type { ConfigModel } from '#/genius/config/model'
import type { StepEvent } from '#/genius/service/run'
import { kindLabel, summarizeProposal } from '#/genius/service/summary'
import type { BuildStatus, Proposal, QuestionAnswer, UsageTotals } from '#/genius/state/types'
import type { Issue } from '#/genius/validation/issues'
import type { ValidationReport } from '#/genius/validation/issues'
import { Button } from '#/components/ui/Button'
import { Icon } from '#/components/ui/Icon'
import { Input, Field } from '#/components/ui/controls'
import { Badge, Card, Notice, Spinner } from '#/components/ui/misc'
import { cn } from '#/utils/id'

export const STATUS_STYLE: Record<BuildStatus, { color: string; label: string }> = {
  draft: { color: '#F5A524', label: 'Draft' },
  validated: { color: '#3B82F6', label: 'Validated' },
  published: { color: '#2DB67D', label: 'Published' },
  active: { color: '#7B68EE', label: 'Active' },
}

export function StatusBadge({ status, label, externalAutomation }: { status: BuildStatus; label: string; externalAutomation: boolean }) {
  const s = STATUS_STYLE[status]
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label={`Build status: ${label}`}>
      <Badge color={s.color} className="px-2 py-1 text-xs">{s.label}</Badge>
      <span className="text-xs text-muted">{label}</span>
      {externalAutomation && <Badge color="#EF4444" className="px-2 py-1 text-xs"><Icon name="AlertTriangle" size={11} />External automation needed</Badge>}
    </div>
  )
}

/** The steps are the real steps the pipeline reports, each with its measured time. Nothing here is animated on a timer. */
export type ShownStep = Omit<StepEvent, 'id'> & { id: string }

export function StepList({ steps, running }: { steps: ShownStep[]; running: boolean }) {
  if (!steps.length && !running) return null
  return (
    <ol className="space-y-1.5" aria-label="Progress" aria-live="polite">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-2 text-[13px]">
          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
            {s.status === 'running' ? <Spinner size={13} /> : s.status === 'done' ? <Icon name="CircleCheck" size={15} className="text-success" /> : s.status === 'skipped' ? <Icon name="Check" size={14} className="text-muted" /> : <Icon name="AlertTriangle" size={14} className="text-danger" />}
          </span>
          <span className="min-w-0">
            <span className={cn('font-medium', s.status === 'skipped' && 'text-muted')}>{s.label}</span>
            {s.detail && <span className="text-muted"> · {s.detail}</span>}
            {s.ms !== undefined && s.status !== 'skipped' && <span className="text-muted"> · {s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toFixed(1)} s`}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function ClarifyForm({ questions, onSubmit, disabled }: { questions: Question[]; onSubmit: (a: QuestionAnswer[]) => void; disabled?: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const answerOf = (q: Question) => (vals[q.id] ?? '').trim() || q.safeDefault || ''
  const ready = questions.every((q) => answerOf(q))
  return (
    <form
      className="space-y-4"
      aria-label="Clarifying questions"
      onSubmit={(e) => {
        e.preventDefault()
        if (!ready) return
        onSubmit(questions.map((q) => ({ questionId: q.id, question: q.question, answer: answerOf(q), at: new Date().toISOString() })))
      }}
    >
      <p className="text-[13px] text-muted">A few things are expensive to guess wrong. Your answers are remembered, so you are never asked twice.</p>
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-[13px] font-semibold">{q.question}</legend>
          <p className="text-xs text-muted">{q.why}</p>
          {q.options.length > 0 && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.question}>
              {q.options.map((o) => (
                <button key={o} type="button" role="radio" aria-checked={vals[q.id] === o} onClick={() => setVals((v) => ({ ...v, [q.id]: o }))} className={cn('rounded-lg border px-3 py-1.5 text-[13px] transition', vals[q.id] === o ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:bg-subtle')}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <Field hint={q.safeDefault ? `If you skip this I will assume: ${q.safeDefault}` : undefined}>
            <Input aria-label={`Answer: ${q.question}`} placeholder={q.options.length ? 'Or type your own answer' : 'Your answer'} value={q.options.includes(vals[q.id] ?? '') ? '' : (vals[q.id] ?? '')} onChange={(e) => setVals((v) => ({ ...v, [q.id]: e.target.value }))} />
          </Field>
        </fieldset>
      ))}
      <Button type="submit" variant="gradient" icon="Check" disabled={!ready || disabled}>Continue</Button>
    </form>
  )
}

function IssueList({ issues, tone }: { issues: Issue[]; tone: 'danger' | 'warning' }) {
  if (!issues.length) return null
  return (
    <ul className="space-y-2">
      {issues.map((i, n) => (
        <li key={`${i.code}-${i.path}-${n}`} className={cn('rounded-lg border px-3 py-2 text-[13px]', tone === 'danger' ? 'border-danger/30 bg-danger/5' : 'border-warning/30 bg-warning/5')}>
          <div className="flex flex-wrap items-center gap-2"><Badge color={tone === 'danger' ? '#EF4444' : '#F5A524'}>{i.code}</Badge><span className="text-xs text-muted">{i.stage} · {i.path}</span></div>
          <p className="mt-1">{i.message}</p>
          {i.repair && <p className="mt-0.5 text-xs text-muted">Fix: {i.repair}</p>}
        </li>
      ))}
    </ul>
  )
}

export function ValidationPanel({ report }: { report: ValidationReport }) {
  return (
    <section aria-label="Validation report" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Validation</h3>
        <Badge color={report.ok ? '#2DB67D' : '#EF4444'}>{report.ok ? 'All checks passed' : `${report.errors.length} problem${report.errors.length === 1 ? '' : 's'}`}</Badge>
        <span className="text-xs text-muted">Stages run: {report.stagesRun.join(' → ')}</span>
      </div>
      <IssueList issues={report.errors} tone="danger" />
      <IssueList issues={report.warnings} tone="warning" />
      {report.sandbox?.ran && <p className="text-xs text-muted">Sandbox: {report.sandbox.syntheticRecords} synthetic records were generated and thrown away to test the rules. {report.sandbox.limitations.join(' ')}</p>}
    </section>
  )
}

const OP_STYLE: Record<string, { sym: string; color: string }> = { add: { sym: '+', color: '#2DB67D' }, update: { sym: '~', color: '#F5A524' }, remove: { sym: '−', color: '#EF4444' }, archive: { sym: '−', color: '#EF4444' }, enable: { sym: '▶', color: '#3B82F6' }, disable: { sym: '■', color: '#6B7280' } }

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-lg font-semibold" style={tone ? { color: tone } : undefined}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

export function usageLine(u?: UsageTotals) {
  if (!u || !u.calls) return 'No AI call was needed.'
  const src = u.source === 'groq' ? 'reported by Groq' : 'MOCKED (test double, not real usage)'
  return `${u.calls} call${u.calls === 1 ? '' : 's'} · ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out / ${u.cachedTokens.toLocaleString()} cached tokens (${src}) · ${(u.latencyMs / 1000).toFixed(1)} s`
}

export function ProposalView({ proposal, report, cfg, onAccept, onReject, saving, canApply, deterministic }: { proposal: Proposal; report?: ValidationReport; cfg: ConfigModel; onAccept: () => void; onReject: () => void; saving: boolean; canApply: boolean; deterministic?: boolean }) {
  const s = summarizeProposal(proposal, cfg)
  const open = proposal.state === 'validated' || proposal.state === 'draft'
  const [showDiff, setShowDiff] = useState(true)
  const state = { draft: ['#F5A524', 'Draft: has problems'], validated: ['#3B82F6', 'Validated'], accepted: ['#2DB67D', 'Applied'], rejected: ['#6B7280', 'Rejected'], failed: ['#EF4444', 'Failed'], superseded: ['#6B7280', 'Superseded'] }[proposal.state]
  return (
    <Card className="space-y-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{proposal.summary || 'Proposed change'}</h2><Badge color={state[0]}>{state[1]}</Badge>{deterministic && <Badge>built by code, no AI</Badge>}</div>
          <p className="mt-0.5 text-xs text-muted">Nothing is saved until you apply it. Your records are never touched by a configuration change.</p>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onReject} disabled={saving}>Reject</Button>
            <Button variant="gradient" icon="Check" onClick={onAccept} disabled={!canApply || proposal.state !== 'validated' || saving} title={proposal.state !== 'validated' ? 'Fix the problems below first' : undefined}>{saving ? 'Saving…' : 'Apply change'}</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Build summary">
        <Stat label="Created" value={s.created.length} tone="#2DB67D" />
        <Stat label="Modified" value={s.modified.length} tone="#F5A524" />
        <Stat label="Removed / archived" value={s.removed.length} tone={s.removed.length ? '#EF4444' : undefined} />
        <Stat label="Not implementable" value={s.notImplementable.length} tone={s.notImplementable.length ? '#EF4444' : undefined} />
      </div>
      <p className="text-xs text-muted">Preserved as they are: {s.preserved.map((p) => `${p.count} ${p.kind}`).join(', ')}, and every record.</p>

      {s.notImplementable.length > 0 && (
        <Notice tone="warning" icon="AlertTriangle">
          <strong>Left out: this app cannot do these things.</strong>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{s.notImplementable.map((i) => <li key={`${i.code}${i.path}`}>{i.message}{i.repair ? ` ${i.repair}` : ''}</li>)}</ul>
        </Notice>
      )}
      {s.needsApproval.length > 0 && (
        <Notice tone="info" icon="ShieldCheck">
          <strong>Needs your approval before it can run.</strong> These automations are created switched off. After applying, review each dry run under “Automations”, then approve.
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{s.needsApproval.map((w) => <li key={w.workflowId}>{w.name}: {w.reasons.join('; ')}</li>)}</ul>
        </Notice>
      )}
      {s.assumptions.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Assumptions</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px]">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="mt-1 text-xs text-muted">Reject and reword your request if any of these is wrong.</p>
        </div>
      )}

      <div>
        <button type="button" className="flex items-center gap-1.5 text-sm font-semibold" aria-expanded={showDiff} onClick={() => setShowDiff((v) => !v)}>
          <Icon name={showDiff ? 'ChevronDownSquare' : 'Plus'} size={13} />Changes compared with your CRM now ({proposal.changes.length})
        </button>
        {showDiff && (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line" aria-label="Changes">
            {proposal.changes.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">No component would change.</li>}
            {proposal.changes.map((c, i) => {
              const st = OP_STYLE[c.op] ?? OP_STYLE.update
              return (
                <li key={`${c.kind}-${c.id}-${i}`} className="flex items-start gap-3 px-3 py-2 text-[13px]">
                  <span aria-hidden className="mt-0.5 w-4 shrink-0 text-center font-mono font-bold" style={{ color: st.color }}>{st.sym}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{c.label}</span><Badge>{c.op} {kindLabel(c.kind)}</Badge>{c.destructive && <Badge color="#EF4444">removes data definition</Badge>}</div>
                    {c.details?.length ? <ul className="mt-0.5 text-xs text-muted">{c.details.slice(0, 6).map((d) => <li key={d}>{d}</li>)}</ul> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {proposal.warnings.length > 0 && <Notice tone="warning">{proposal.warnings.slice(0, 5).map((w) => <p key={w}>{w}</p>)}</Notice>}
      {report ? <ValidationPanel report={report} /> : <IssueList issues={proposal.issues} tone="danger" />}
      <p className="text-xs text-muted">{usageLine(proposal.usage)}{proposal.repairAttempts ? ` · repaired ${proposal.repairAttempts}×` : ''}{proposal.model?.used.length ? ` · models: ${proposal.model.used.join(', ')}` : ''}</p>
    </Card>
  )
}
