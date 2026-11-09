import { useEffect, useMemo, useRef, useState } from 'react'
import { usePerms, useWorkflows, useWsId } from '#/hooks/useData'
import { readConfig } from '#/genius/config/storePort'
import { applyProposal, rejectProposal } from '#/genius/service/actions'
import { buildStatus } from '#/genius/service/builder'
import { runGenius, type RunOutput, type StepEvent } from '#/genius/service/run'
import { fetchHealth, httpTransport } from '#/genius/service/transport'
import { useGeniusStore } from '#/genius/state/geniusStore'
import type { QuestionAnswer } from '#/genius/state/types'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Icon } from '#/components/ui/Icon'
import { Textarea } from '#/components/ui/controls'
import { Badge, Card, Notice, PageHeader, Tabs } from '#/components/ui/misc'
import { AutomationsPanel, HistoryPanel } from '#/components/genius/GeniusHistory'
import { ClarifyForm, ProposalView, StatusBadge, StepList, type ShownStep } from '#/components/genius/GeniusParts'
import { confirmDialog, toast } from '#/utils/toast'

type Tab = 'build' | 'history' | 'automations'

const EXAMPLES: { mode: string; icon: string; text: string }[] = [
  { mode: 'New build', icon: 'Sparkles', text: 'Create a CRM for my school academy: students, guardians, classes, attendance and fees' },
  { mode: 'New build', icon: 'Sparkles', text: 'Create a CRM for a letting agency with landlords, properties, enquiries, tenancies and rent payments' },
  { mode: 'Extend', icon: 'Plus', text: 'Add a notes field to Students' },
  { mode: 'Change a rule', icon: 'Scale', text: 'Make the admission number required and unique for Students' },
  { mode: 'Ask', icon: 'MessageSquare', text: 'How is Outstanding calculated?' },
  { mode: 'Ask', icon: 'MessageSquare', text: 'Simulate the fee reminder workflow without sending anything' },
  { mode: 'Undo', icon: 'RotateCcw', text: 'Undo the last change' },
]

const LIMITS = [
  'Genius designs and changes your CRM configuration: modules, fields, relationships, calculations, forms, views, pipelines, workflows, dashboards and roles. It never edits or deletes your records.',
  'Nothing is applied until you press “Apply change”. Every applied change becomes a version you can undo. Modules that hold records are archived, never deleted.',
  'Automations run only while this app is open in a browser tab. There is no background server, and no email, SMS or WhatsApp channel, so Genius cannot build anything that messages people. Such parts are listed as “not implementable”.',
  'Role limits here protect the screens of this browser session. They are not server-side security.',
  'Money is calculated exactly (no floating point), in a single currency per calculation. There is no exchange-rate conversion.',
  'AI output can be wrong. It is checked by six automatic stages, but read the summary and the dry run before you approve anything.',
  'Genius needs the server secret GROQ_API_KEY. Without it, only exact changes made by code (rename, switch a workflow off, explain a calculation, undo) work.',
]

export function GeniusPage() {
  const ws = useWsId()
  const perms = usePerms()
  const workflows = useWorkflows()
  const proposals = useGeniusStore((s) => s.proposals)
  const versions = useGeniusStore((s) => s.versions)
  const pendingQs = useGeniusStore((s) => s.memory[ws]?.pendingQuestions)
  const [tab, setTab] = useState<Tab>('build')
  const [request, setRequest] = useState('')
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [steps, setSteps] = useState<StepEvent[]>([])
  const [saveStep, setSaveStep] = useState<ShownStep | null>(null)
  const [out, setOut] = useState<RunOutput | null>(null)
  const [health, setHealth] = useState<{ groqConfigured: boolean } | 'unreachable' | null>(null)
  const ac = useRef<AbortController | null>(null)
  const canBuild = perms.can('manageFields')

  useEffect(() => {
    let live = true
    fetchHealth().then((h) => live && setHealth(h)).catch(() => live && setHealth('unreachable'))
    return () => { live = false }
  }, [])

  const status = useMemo(() => buildStatus(ws), [ws, proposals, versions, workflows])
  const pending = proposals.filter((p) => p.workspaceId === ws && (p.state === 'draft' || p.state === 'validated')).at(-1)
  const shown = out?.kind === 'proposal' ? (proposals.find((p) => p.id === out.proposal.id) ?? out.proposal) : pending && !out ? pending : null
  const externalAutomation = !!shown && shown.state !== 'accepted' && shown.notImplementable.length > 0

  const run = async (text: string, answers?: QuestionAnswer[]) => {
    if (!text.trim() || running) return
    const ctl = new AbortController()
    ac.current = ctl
    setRunning(true)
    setOut(null)
    setSteps([])
    setSaveStep(null)
    try {
      const res = await runGenius({ workspaceId: ws, request: text, answers, signal: ctl.signal, onStep: (e) => setSteps((prev) => (prev.some((s) => s.id === e.id) ? prev.map((s) => (s.id === e.id ? e : s)) : [...prev, e])) }, { transport: httpTransport })
      if (!ctl.signal.aborted) setOut(res)
    } catch (e) {
      setOut({ kind: 'error', code: 'unexpected', message: `Something went wrong. Your CRM is unchanged.${e instanceof Error ? ` (${e.message})` : ''}`, retryable: true, intent: 'new_build', correlationId: '', steps: [], usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, calls: 0, latencyMs: 0, source: 'groq' } })
    } finally {
      setRunning(false)
    }
  }
  const cancel = () => {
    ac.current?.abort()
    setRunning(false)
    toast.info('Cancelled', 'Nothing was changed.')
  }

  const accept = async () => {
    if (!shown) return
    const destructive = shown.changes.filter((c) => c.destructive)
    if (destructive.length && !(await confirmDialog({ title: 'This change removes parts of your CRM', message: `${destructive.map((c) => c.label).slice(0, 5).join('; ')}. Your records are kept, but these definitions go away (you can undo it from the history).`, confirmLabel: 'Apply change', danger: true }))) return
    setSaving(true)
    const t0 = performance.now()
    setSaveStep({ id: 'save', label: 'Saving to your CRM', status: 'running' })
    const r = applyProposal(shown.id, { confirmDestructive: destructive.length > 0 })
    setSaving(false)
    setSaveStep({ id: 'save', label: 'Saving to your CRM', status: r.ok ? 'done' : 'error', detail: r.ok ? `saved as version ${r.version.number}` : r.error, ms: Math.round(performance.now() - t0) })
    if (r.ok) toast.success(r.duplicate ? 'Already applied' : 'Change applied', `Saved as version ${r.version.number}. You can undo it from History.`)
    else toast.error('Nothing was changed', r.error)
  }
  const reject = () => {
    if (shown && rejectProposal(shown.id)) {
      setOut(null)
      toast.info('Proposal rejected', 'Your CRM is unchanged.')
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void run(request)
    }
  }

  const clarifyQs = out?.kind === 'clarify' ? out.questions : !out && !running && pendingQs?.length ? pendingQs : null

  return (
    <Page title="Genius AI Builder" wide skeleton="cards">
      <PageHeader title="Genius AI Builder" icon="Sparkles" description="Describe what you need in plain words. Genius designs it, checks it, shows you exactly what would change, and only then builds it." actions={<StatusBadge status={status.status} label={status.label} externalAutomation={externalAutomation} />} />

      {health === 'unreachable' && <div className="mb-4"><Notice tone="warning">The AI service could not be reached. Exact changes, explanations and undo still work offline.</Notice></div>}
      {health && health !== 'unreachable' && !health.groqConfigured && <div className="mb-4"><Notice tone="warning"><strong>The AI model is not connected yet.</strong> The server secret <code>GROQ_API_KEY</code> has not been added. Until then only changes made directly by code (rename, switch a workflow off, explain a calculation, undo) work.</Notice></div>}
      {!canBuild && <div className="mb-4"><Notice tone="info">Your role cannot change the CRM configuration, so you can ask questions but not apply changes.</Notice></div>}

      <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'build', label: 'Build', icon: 'Sparkles' }, { id: 'history', label: 'History', icon: 'History', count: versions.filter((v) => v.workspaceId === ws).length }, { id: 'automations', label: 'Automations', icon: 'Workflow' }]} />

      {tab === 'history' && <HistoryPanel canUndo={canBuild} />}
      {tab === 'automations' && <AutomationsPanel canManage={perms.can('manageWorkflows')} />}

      {tab === 'build' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <label htmlFor="genius-request" className="text-sm font-semibold">What should Genius do?</label>
              <Textarea id="genius-request" className="min-h-[120px]" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={onKey} disabled={running} maxLength={4000} placeholder="e.g. Create a CRM for my school academy, or: add a Notes field to Students" aria-describedby="genius-hint" />
              <p id="genius-hint" className="text-xs text-muted">New build, extend, change a rule, ask a question or undo. Press Ctrl/⌘ + Enter to send.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="gradient" icon="Sparkles" onClick={() => void run(request)} disabled={running || !request.trim()}>{running ? 'Working…' : 'Send to Genius'}</Button>
                {running && <Button onClick={cancel}>Cancel</Button>}
                {request && !running && <Button variant="ghost" onClick={() => { setRequest(''); setOut(null); setSteps([]) }}>Clear</Button>}
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Try an example</h2>
              <ul className="space-y-1.5">
                {EXAMPLES.map((e) => (
                  <li key={e.text}>
                    <button type="button" onClick={() => { setRequest(e.text); setOut(null); setSteps([]) }} disabled={running} className="flex w-full items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-left text-[13px] transition hover:bg-subtle focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
                      <Icon name={e.icon} size={14} className="mt-0.5 shrink-0 text-primary" />
                      <span className="min-w-0"><Badge className="mr-1.5">{e.mode}</Badge>{e.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <details className="rounded-xl border border-line bg-surface p-4 text-[13px]">
              <summary className="cursor-pointer text-sm font-semibold">What Genius can and cannot do</summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
            </details>
          </div>

          <div className="min-w-0 space-y-4" aria-live="polite">
            {(steps.length > 0 || running || saveStep) && <Card className="p-4"><h2 className="mb-2 text-sm font-semibold">What Genius is doing</h2><StepList steps={saveStep ? [...steps, saveStep] : steps} running={running} /></Card>}

            {out?.kind === 'error' && (
              <Notice tone="danger">
                <strong>{out.message}</strong>
                <p className="mt-1 text-xs text-muted">Your request is kept in the box on the left, so you can send it again.{out.retryable ? '' : ' Reword it first if this keeps happening.'}</p>
                <div className="mt-2 flex gap-2">{out.retryable && <Button size="xs" icon="RefreshCw" onClick={() => void run(request)}>Try again</Button>}</div>
              </Notice>
            )}
            {out?.kind === 'answer' && (
              <Card className="space-y-2 p-4">
                <div className="flex items-center gap-2"><Icon name="MessageSquare" size={15} className="text-primary" /><h2 className="text-sm font-semibold">Answer</h2><Badge>{out.source === 'deterministic' ? 'from your configuration, no AI' : 'AI answer, nothing changed'}</Badge></div>
                <p className="whitespace-pre-wrap text-[13px]">{out.text}</p>
                {out.references.length > 0 && <p className="text-xs text-muted">Based on: {out.references.join(', ')}</p>}
              </Card>
            )}
            {out?.kind === 'restore' && (
              <Card className="space-y-3 p-4">
                <div className="flex items-center gap-2"><Icon name="RotateCcw" size={15} className="text-primary" /><h2 className="text-sm font-semibold">Undo</h2></div>
                <p className="whitespace-pre-wrap text-[13px]">{out.text}</p>
                {out.target && <Button icon="RotateCcw" onClick={() => { setTab('history') }}>Open History to confirm the undo</Button>}
              </Card>
            )}
            {clarifyQs && (
              <Card className="p-4">
                <h2 className="mb-2 text-sm font-semibold">Before I design this</h2>
                <ClarifyForm questions={clarifyQs} disabled={running} onSubmit={(a) => void run(request, a)} />
              </Card>
            )}
            {shown && <ProposalView proposal={shown} report={out?.kind === 'proposal' && out.proposal.id === shown.id ? out.outcome.report : undefined} cfg={readConfig(ws)} onAccept={() => void accept()} onReject={reject} saving={saving} canApply={canBuild} deterministic={out?.kind === 'proposal' ? out.deterministic : false} />}
            {shown?.state === 'accepted' && shown.needsApproval.length > 0 && (
              <Notice tone="info" icon="ShieldCheck">Applied. The automations are switched off. <button type="button" className="font-medium text-primary underline" onClick={() => setTab('automations')}>Review and approve them</button> when you are ready.</Notice>
            )}
            {!out && !running && !shown && !clarifyQs && (
              <Card className="p-8 text-center"><Icon name="Sparkles" size={28} className="mx-auto mb-2 text-primary" /><h2 className="text-sm font-semibold">Nothing in progress</h2><p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">Write a request or pick an example. You will see every step, then a preview of exactly what would change.</p></Card>
            )}
          </div>
        </div>
      )}
    </Page>
  )
}