import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useWorkflows, useWsId } from '#/hooks/useData'
import { activateWorkflow, historyOf, restore, reviewWorkflow, rollback } from '#/genius/service/actions'
import { setWorkflowEnabled } from '#/genius/service/builder'
import { useGeniusStore } from '#/genius/state/geniusStore'
import type { GeniusVersion } from '#/genius/state/types'
import type { WorkflowPreview } from '#/genius/workflow/preview'
import type { Workflow } from '#/types'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Checkbox } from '#/components/ui/controls'
import { Badge, Card, EmptyState, Notice } from '#/components/ui/misc'
import { confirmDialog, toast } from '#/utils/toast'

export function HistoryPanel({ canUndo }: { canUndo: boolean }) {
  const ws = useWsId()
  const versions = useGeniusStore((s) => s.versions)
  const list = useMemo(() => historyOf(ws), [versions, ws]) // eslint-disable-line react-hooks/exhaustive-deps
  const [conflict, setConflict] = useState<{ id: string; conflicts: string[]; mode: 'undo' | 'restore'; number: number } | null>(null)

  const doUndo = async (v: GeniusVersion, force = false) => {
    if (!force && !(await confirmDialog({ title: `Undo version ${v.number}?`, message: 'Only the parts this version changed go back. Your records, and later edits to other parts, are kept.', confirmLabel: 'Undo' }))) return
    const r = rollback(v.id, { force })
    if (r.ok) {
      setConflict(null)
      toast.success(`Version ${v.number} undone`, r.version.warnings[0])
    } else if ('conflicts' in r && r.conflicts.length) setConflict({ id: v.id, conflicts: r.conflicts, mode: 'undo', number: v.number })
    else toast.error('Not undone', r.error)
  }
  const doRestore = async (v: GeniusVersion, force = false) => {
    if (!force && !(await confirmDialog({ title: `Go back to version ${v.number}?`, message: 'Every newer change is undone, newest first. Records are kept.', confirmLabel: 'Restore', danger: true }))) return
    const r = restore(ws, v.number, { force })
    if (r.ok) {
      setConflict(null)
      toast.success(`Restored to version ${v.number}`, `${r.undone} newer change${r.undone === 1 ? '' : 's'} undone`)
    } else if (r.conflicts?.length) setConflict({ id: v.id, conflicts: r.conflicts, mode: 'restore', number: v.number })
    else toast.error('Not restored', r.error)
  }

  if (!list.length) return <EmptyState icon="History" title="No versions yet" description="Every applied change is saved as a version here, so you can undo it." />
  const latestOpen = list.find((v) => !v.undone && v.kind !== 'restore')?.id
  return (
    <div className="space-y-3">
      {conflict && (
        <Notice tone="warning" icon="AlertTriangle">
          <strong>Later edits touch the same parts, so nothing was changed.</strong>
          <ul className="mt-1 list-disc pl-4">{conflict.conflicts.slice(0, 6).map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="xs" onClick={() => setConflict(null)}>Keep my edits</Button>
            <Button size="xs" variant="danger" onClick={() => { const v = list.find((x) => x.id === conflict.id); if (v) void (conflict.mode === 'undo' ? doUndo(v, true) : doRestore(v, true)) }}>Overwrite my edits and {conflict.mode === 'undo' ? 'undo' : 'restore'}</Button>
          </div>
        </Notice>
      )}
      <ol className="space-y-2" aria-label="Version history">
        {list.map((v) => (
          <li key={v.id}>
            <Card className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">v{v.number}</span><Badge>{v.kind === 'build' ? 'new build' : v.kind === 'patch' ? 'change' : 'undo / restore'}</Badge>{v.undone && <Badge color="#6B7280">undone</Badge>}<span className="text-xs text-muted">{format(new Date(v.createdAt), 'MMM d, HH:mm')}</span></div>
                  <p className="mt-0.5 text-[13px]">{v.summary}</p>
                  {v.request && <p className="mt-0.5 line-clamp-2 text-xs text-muted">“{v.request}”</p>}
                  <p className="mt-0.5 text-xs text-muted">{v.keys.length} component{v.keys.length === 1 ? '' : 's'} touched{v.warnings.length ? ` · ${v.warnings[0]}` : ''}</p>
                </div>
                {canUndo && v.kind !== 'restore' && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="xs" icon="RotateCcw" disabled={!!v.undone} onClick={() => void doUndo(v)} aria-label={`Undo version ${v.number}`}>Undo</Button>
                    {v.id !== latestOpen && <Button size="xs" variant="ghost" onClick={() => void doRestore(v)} aria-label={`Restore to version ${v.number}`}>Restore to here</Button>}
                  </div>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PreviewBody({ p }: { p: WorkflowPreview }) {
  return (
    <div className="space-y-3 text-[13px]">
      <Notice tone="success" icon="ShieldCheck">This is a dry run. Nothing was changed and nothing was sent. {p.notes.join(' ')}</Notice>
      <p>{p.matching} of {p.considered} record{p.considered === 1 ? '' : 's'} would be picked up. It would update {p.totals.updates}, create {p.totals.creates} record(s), create {p.totals.tasks} task(s) and show {p.totals.notifications} notification(s). {p.totals.failures ? `${p.totals.failures} step(s) would fail.` : ''}</p>
      {p.reasons.length > 0 && <p><strong>Why it needs approval:</strong> {p.reasons.join('; ')}</p>}
      {p.sample.length > 0 && (
        <div>
          <h4 className="mb-1 font-semibold">Example</h4>
          <ul className="space-y-2">{p.sample.slice(0, 3).map((s) => (
            <li key={s.recordId} className="rounded-lg border border-line p-2"><div className="font-medium">{s.title}</div><ul className="mt-1 list-disc pl-4 text-xs text-muted">{s.node.steps.map((st) => <li key={st.actionId}>{st.summary}</li>)}</ul></li>
          ))}</ul>
        </div>
      )}
    </div>
  )
}

export function AutomationsPanel({ canManage }: { canManage: boolean }) {
  const all = useWorkflows()
  const list = all.filter((w) => w.origin === 'ai')
  const [open, setOpen] = useState<{ wf: Workflow; preview: WorkflowPreview } | null>(null)
  const [ok, setOk] = useState(false)

  const review = (wf: Workflow) => {
    const p = reviewWorkflow(wf.id)
    if (!p) return toast.error('Could not preview this workflow')
    setOk(false)
    setOpen({ wf, preview: p })
  }
  const approve = () => {
    if (!open) return
    const r = activateWorkflow(open.wf.id, { approved: ok, note: 'Approved after reviewing the dry run' })
    if (r.ok) {
      toast.success(`“${open.wf.name}” is on`, 'It runs only while this app is open in a browser.')
      setOpen(null)
    } else toast.error('Not switched on', r.message)
  }

  if (!list.length) return <EmptyState icon="Workflow" title="No AI-built automations" description="Automations that Genius designs appear here, switched off, until you review and approve them." />
  return (
    <div className="space-y-3">
      <Notice tone="warning"><strong>Automations run only while Xcrm is open in a browser tab.</strong> There is no background server and no way to send email, SMS or WhatsApp, so none of these can message anyone.</Notice>
      <ul className="space-y-2" aria-label="AI-built automations">
        {list.map((w) => (
          <li key={w.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{w.name}</span><Badge color={w.enabled ? '#2DB67D' : '#6B7280'}>{w.enabled ? 'On' : 'Off'}</Badge>{w.consequential && <Badge color="#F5A524">changes data</Badge>}{w.approval ? <Badge color="#3B82F6">approved</Badge> : <Badge color="#F5A524">awaiting approval</Badge>}</div>
                {w.description && <p className="mt-0.5 text-xs text-muted">{w.description}</p>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" icon="Eye" onClick={() => review(w)} aria-label={`Review dry run of ${w.name}`}>Review dry run</Button>
                  {w.enabled && <Button size="xs" variant="ghost" onClick={() => { const r = setWorkflowEnabled(w.id, false); if (r.ok) toast.success('Switched off'); else toast.error('Not changed', r.message) }}>Switch off</Button>}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Dry run: ${open.wf.name}` : 'Dry run'} size="lg"
        footer={<>
          <Checkbox checked={ok} onChange={setOk} label="I have read this dry run and approve switching this automation on" />
          <Button onClick={() => setOpen(null)}>Close</Button>
          <Button variant="gradient" icon="Check" disabled={!ok || !!open?.wf.enabled} onClick={approve}>Approve and switch on</Button>
        </>}>
        {open && <PreviewBody p={open.preview} />}
      </Modal>
    </div>
  )
}
