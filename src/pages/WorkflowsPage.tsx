import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useCtx, useModules, usePerms, useRecords, useWorkflows, useWsId } from '#/hooks/useData'
import { useRunStore, useWorkflowStore } from '#/stores/collections'
import { useSelectionStore } from '#/stores/selectionStore'
import { runWorkflowNow } from '#/services/workflowEngine'
import { canEnableWorkflow, setWorkflowEnabled } from '#/genius/service/builder'
import { recordTitle } from '#/utils/records'
import { nowIso, uid, cn } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import type { Workflow } from '#/types'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Badge, Card, EmptyState, Notice, PageHeader, Tabs } from '#/components/ui/misc'
import { Select, Switch } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { WorkflowEditor, triggerSummary } from '#/builders/WorkflowBuilder/WorkflowEditor'

type Tab = 'builder' | 'runs'

function RunLog({ workflowId }: { workflowId?: string }) {
  const ws = useWsId()
  const runs = useRunStore((s) => s.runs)
  const [status, setStatus] = useState<'all' | 'success' | 'skipped' | 'error'>('all')
  const list = useMemo(() => runs.filter((r) => r.workspaceId === ws && (!workflowId || r.workflowId === workflowId) && (status === 'all' || r.status === status)).slice(0, 300), [runs, ws, workflowId, status])
  const tone = { success: '#2DB67D', skipped: '#F5A524', error: '#EF4444' }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter runs by status" className="w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All statuses</option><option value="success">Success</option><option value="skipped">Skipped</option><option value="error">Errors</option></Select>
        <span className="text-xs text-muted">Showing latest {list.length}</span>
        <Button size="sm" variant="ghost" className="ml-auto" icon="Trash2" disabled={!runs.some((r) => r.workspaceId === ws && (!workflowId || r.workflowId === workflowId))} onClick={async () => { if (await confirmDialog({ title: 'Clear run log?', message: workflowId ? 'Clears runs for this workflow. Date-trigger runs may fire again for past dates.' : 'Clears every run in this workspace. Date-trigger runs may fire again for past dates.', confirmLabel: 'Clear log', danger: true })) { useRunStore.getState().clear(ws, workflowId); toast.success('Run log cleared') } }}>Clear log</Button>
      </div>
      {list.length === 0 ? <EmptyState icon="History" title="No runs yet" description="When a workflow runs — automatically or with “Run now” — it is recorded here." /> : (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">When</th>{!workflowId && <th className="px-3 py-2 text-left">Workflow</th>}<th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Details</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted">{format(new Date(r.at), 'MMM d, HH:mm:ss')}</td>
                {!workflowId && <td className="px-3 py-2 font-medium">{r.workflowName}</td>}
                <td className="px-3 py-2"><Badge color={tone[r.status]}>{r.status}</Badge></td>
                <td className="px-3 py-2">{r.message}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RunNow({ wf }: { wf: Workflow }) {
  const records = useRecords(wf.moduleId)
  const modules = useModules({ includeArchived: true })
  const ctx = useCtx()
  const m = modules.find((x) => x.id === wf.moduleId)
  const [rid, setRid] = useState('')
  const report = (res: { ran: number; total: number }) => (res.total === 0 ? toast.info('Nothing to run on', 'This module has no active records.') : toast.success(`Ran on ${res.ran} of ${res.total} record${res.total === 1 ? '' : 's'}`, 'Records that fail the conditions are logged as skipped.'))
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-subtle/40 p-3">
      <Icon name="Play" size={15} className="text-primary" />
      <span className="text-[13px] font-medium">Run manually</span>
      <Select aria-label="Record to run on" className="h-8 max-w-[240px] flex-1" value={rid} onChange={(e) => setRid(e.target.value)}>
        <option value="">All active records in {m?.name}</option>
        {m && records.slice(0, 300).map((r) => <option key={r.id} value={r.id}>{recordTitle(m, r, ctx)}</option>)}
      </Select>
      <Button size="sm" variant="primary" icon="Play" onClick={async () => {
        if (!wf.actions.length) return toast.warning('Add at least one action first')
        if (!rid && records.length > 1 && !(await confirmDialog({ title: `Run on ${records.length} records?`, message: `“${wf.name}” will execute its actions for every active record that passes the conditions. This works even if the workflow is disabled.`, confirmLabel: 'Run now' }))) return
        report(runWorkflowNow(wf, rid ? [rid] : undefined))
      }}>Run now</Button>
    </div>
  )
}

export function WorkflowsPage() {
  const ws = useWsId()
  const modules = useModules({ includeArchived: true })
  const all = useWorkflows()
  const perms = usePerms()
  const go = useGo()
  const sel = useSelectionStore()
  const [tab, setTab] = useState<Tab>('builder')
  const [dirty, setDirty] = useState(false)
  const canManage = perms.can('manageWorkflows')
  const wf = all.find((w) => w.id === sel.workflowId) ?? all[0]
  const store = useWorkflowStore.getState()

  useEffect(() => { if (wf && wf.id !== sel.workflowId) sel.set({ workflowId: wf.id }) }, [wf?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (id: string) => {
    if (id === wf?.id) return
    if (dirty && !(await confirmDialog({ title: 'Discard unsaved changes?', message: 'You have unsaved edits to this workflow.', confirmLabel: 'Discard' }))) return
    setDirty(false)
    sel.set({ workflowId: id })
  }

  const create = () => {
    const m = modules.find((x) => x.id === sel.moduleId && !x.archived) ?? modules.find((x) => !x.archived)
    if (!m) return toast.warning('Create a module first')
    const t = nowIso()
    const w: Workflow = { id: uid('wf'), workspaceId: ws, moduleId: m.id, name: 'New workflow', enabled: false, trigger: { type: 'record_created' }, conditions: [], actions: [], createdAt: t, updatedAt: t }
    store.add(w)
    sel.set({ workflowId: w.id })
    setTab('builder')
    toast.success('Workflow created', 'It stays disabled until you add actions and switch it on.')
  }

  return (
    <Page title="Workflows" wide skeleton="cards">
      <PageHeader title="Workflows" icon="Workflow" description="Automate follow-ups: WHEN something happens, IF conditions match, THEN do actions."
        actions={canManage && <Button variant="gradient" icon="Plus" onClick={create}>New workflow</Button>} />
      <div className="mb-5"><Notice tone="warning"><strong>Automations only run while Xcrm is open in a browser tab.</strong> There is no server, so nothing runs in the background. Date-based triggers are checked every minute while the app is open, and catch up (up to 7 days back) the next time you open it.</Notice></div>
      <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'builder', label: 'Builder', icon: 'Workflow' }, { id: 'runs', label: 'Run log', icon: 'History' }]} />
      {tab === 'runs' ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Select aria-label="Workflow filter" className="w-64" value={sel.workflowId ?? ''} onChange={(e) => sel.set({ workflowId: e.target.value || null })}><option value="">All workflows</option>{all.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          </div>
          <RunLog workflowId={sel.workflowId ?? undefined} />
        </div>
      ) : all.length === 0 ? (
        <EmptyState icon="Workflow" title="No workflows yet" description="Create one, or install a template that ships with ready-made automations." action={<>{canManage && <Button variant="primary" icon="Plus" onClick={create}>New workflow</Button>}<Button onClick={() => go('/templates')}>Browse templates</Button></>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            {all.map((w) => {
              const m = modules.find((x) => x.id === w.moduleId)
              return (
                <Card key={w.id} className={cn('p-3', w.id === wf?.id && 'border-primary ring-1 ring-primary/30')}>
                  <button type="button" onClick={() => void choose(w.id)} className="block w-full text-left">
                    <div className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold">{w.name}</span></div>
                    <div className="mt-0.5 truncate text-xs text-muted">{m?.name ?? 'Missing module'} · {triggerSummary(w, m)}</div>
                    <div className="text-[11px] text-muted">{w.conditions.length} condition(s) · {w.actions.length} action(s)</div>
                  </button>
                  <div className="mt-2 flex items-center justify-between">
                    <Switch checked={w.enabled} disabled={!canManage} onChange={(v) => { const r = setWorkflowEnabled(w.id, v); if (!r.ok) toast.warning('Not switched on', r.message) }} label={w.enabled ? 'On' : 'Off'} />
                    {canManage && (
                      <div className="flex gap-0.5">
                        <button type="button" aria-label={`Duplicate ${w.name}`} title="Duplicate" className="rounded p-1.5 text-muted hover:bg-subtle" onClick={() => { const t = nowIso(); const c: Workflow = { ...structuredClone(w), id: uid('wf'), name: `${w.name} (copy)`, enabled: false, createdAt: t, updatedAt: t }; store.add(c); sel.set({ workflowId: c.id }); toast.success('Workflow duplicated', 'The copy is disabled.') }}><Icon name="Copy" size={14} /></button>
                        <button type="button" aria-label={`Delete ${w.name}`} title="Delete" className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger" onClick={async () => { if (await confirmDialog({ title: `Delete “${w.name}”?`, message: 'Its run history stays in the log.', confirmLabel: 'Delete', danger: true })) { store.remove(w.id); if (w.id === wf?.id) { sel.set({ workflowId: null }); setDirty(false) } } }}><Icon name="Trash2" size={14} /></button>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
          {wf && (
            <div className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-5">
              {canManage ? (
                <>
                  <WorkflowEditor workflow={wf} onDirty={setDirty} onSave={(w) => {
                    // switching on goes through the same gate as the toggle: AI-built / consequential workflows need an approval
                    const turningOn = w.enabled && !all.find((x) => x.id === w.id)?.enabled
                    const gate = turningOn ? canEnableWorkflow({ ...wf, ...w }) : { ok: true as const }
                    store.update(w.id, gate.ok ? w : { ...w, enabled: false })
                    if (gate.ok) toast.success('Workflow saved')
                    else toast.warning('Saved, but left off', gate.message)
                  }} />
                  <RunNow wf={wf} />
                  <div><h3 className="mb-2 text-sm font-semibold">Recent runs</h3><RunLog workflowId={wf.id} /></div>
                </>
              ) : <EmptyState icon="Lock" title="You can’t edit workflows" description="Your role doesn’t include managing workflows." />}
            </div>
          )}
        </div>
      )}
    </Page>
  )
}
