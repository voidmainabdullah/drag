import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import type { DataFlowLink, ID } from '#/types'
import { useDataFlows, useModules, usePerms, useRecords, useWsId } from '#/hooks/useData'
import { useRunStore } from '#/stores/collections'
import { deleteFlow, duplicateFlow, saveFlow, setFlowEnabled, setNodePositions } from '#/services/dataFlowService'
import { MAX_FLOW_DEPTH, runFlowNow } from '#/services/dataFlowEngine'
import { FLOW_ACTIONS, actionMeta, autoArrange, flowSummary, newFlow, relationEdges } from '#/utils/dataflow'
import { confirmDialog, toast } from '#/utils/toast'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Field, Select, Switch } from '#/components/ui/controls'
import { Badge, EmptyState, Notice, Tabs } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { useGo } from '#/components/layout/AppLink'
import { DataFlowCanvas, type CanvasHandle, type CanvasSelection } from './DataFlowCanvas'
import { FlowEditor } from './FlowEditor'

type Tab = 'canvas' | 'runs'

function RunLog() {
  const ws = useWsId()
  const runs = useRunStore((s) => s.runs)
  const list = useMemo(() => runs.filter((r) => r.workspaceId === ws && r.kind === 'dataflow').slice(0, 300), [runs, ws])
  const tone = { success: '#2DB67D', skipped: '#F5A524', error: '#EF4444' }
  const clear = async () => {
    if (!(await confirmDialog({ title: 'Clear data flow runs?', message: 'Removes the data flow entries from this workspace’s run log. Workflow runs are kept.', confirmLabel: 'Clear', danger: true }))) return
    const st = useRunStore.getState()
    st.setAll(st.runs.filter((r) => !(r.workspaceId === ws && r.kind === 'dataflow')))
    toast.success('Data flow runs cleared')
  }
  return (
    <div className="space-y-3">
      <Notice tone="warning"><strong>Data flows only run while Xcrm is open in a browser tab.</strong> There is no server, so records changed elsewhere or while the app is closed are not picked up. Use “Run on existing records” in a flow to catch up.</Notice>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Latest {list.length} run{list.length === 1 ? '' : 's'} · also listed in the Workflows run log</span>
        <Button size="sm" variant="ghost" className="ml-auto" icon="Trash2" disabled={!list.length} onClick={clear}>Clear log</Button>
      </div>
      {list.length === 0 ? <EmptyState icon="History" title="No data flow runs yet" description="When a flow runs — automatically or with “Run on existing records” — it is recorded here." /> : (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Flow</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Details</th></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted">{format(new Date(r.at), 'MMM d, HH:mm:ss')}</td>
                <td className="px-3 py-2 font-medium">{r.workflowName.replace(/^Data flow: /, '')}</td>
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

function NewFlowDialog({ open, source, onClose, onCreate }: { open: boolean; source?: ID; onClose: () => void; onCreate: (s: ID, t: ID) => void }) {
  const modules = useModules()
  const [s, setS] = useState('')
  const [t, setT] = useState('')
  const sv = s || source || modules[0]?.id || ''
  const tv = t || modules.find((m) => m.id !== sv)?.id || modules[0]?.id || ''
  const close = () => { setS(''); setT(''); onClose() }
  return (
    <Modal open={open} onClose={close} title="New data flow" description="Pick the module that triggers the flow and the module it acts on. They can be the same module."
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={!sv || !tv} onClick={() => { onCreate(sv, tv); setS(''); setT('') }}>Continue</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Source module" hint="Its records trigger the flow"><Select value={sv} onChange={(e) => setS(e.target.value)}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
        <Field label="Target module" hint="Where the action happens"><Select value={tv} onChange={(e) => setT(e.target.value)}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
      </div>
    </Modal>
  )
}

interface Props {
  /** limit the canvas to one module and the modules it is connected to (module settings tab) */
  focusModuleId?: ID
}

export function DataFlowWorkspace({ focusModuleId }: Props) {
  const ws = useWsId()
  const go = useGo()
  const modules = useModules()
  const flows = useDataFlows()
  const records = useRecords()
  const perms = usePerms()
  const canEdit = perms.can('manageWorkflows')
  const canvas = useRef<CanvasHandle>(null)

  const [tab, setTab] = useState<Tab>('canvas')
  const [selection, setSelection] = useState<CanvasSelection | null>(null)
  const [draft, setDraft] = useState<DataFlowLink | null>(null)
  const [dialog, setDialog] = useState<{ source?: ID } | null>(null)
  const [showAll, setShowAll] = useState(false)

  const rels = useMemo(() => relationEdges(modules), [modules])
  const recordCounts = useMemo(() => {
    const c: Record<ID, number> = {}
    for (const r of records) c[r.moduleId] = (c[r.moduleId] ?? 0) + 1
    return c
  }, [records])

  const focusing = !!focusModuleId && !showAll && modules.some((m) => m.id === focusModuleId)
  const visibleIds = useMemo(() => {
    if (!focusing) return new Set(modules.map((m) => m.id))
    const s = new Set<ID>([focusModuleId!])
    for (const f of flows) {
      if (f.sourceModuleId === focusModuleId) s.add(f.targetModuleId)
      if (f.targetModuleId === focusModuleId) s.add(f.sourceModuleId)
    }
    for (const r of rels) {
      if (r.fromId === focusModuleId) s.add(r.toId)
      if (r.toId === focusModuleId) s.add(r.fromId)
    }
    return s
  }, [focusing, focusModuleId, modules, flows, rels])
  const shownFlows = useMemo(() => flows.filter((f) => visibleIds.has(f.sourceModuleId) && visibleIds.has(f.targetModuleId)), [flows, visibleIds])
  const shownRels = useMemo(() => rels.filter((r) => visibleIds.has(r.fromId) && visibleIds.has(r.toId)), [rels, visibleIds])

  const modName = (id: ID) => modules.find((m) => m.id === id)?.name ?? 'Deleted module'
  const selFlow = selection?.kind === 'flow' ? (draft?.id === selection.id ? draft : flows.find((f) => f.id === selection.id)) : undefined
  const selRel = selection?.kind === 'rel' ? rels.find((r) => r.id === selection.id) : undefined
  const selNode = selection?.kind === 'node' ? modules.find((m) => m.id === selection.id) : undefined

  const select = (s: CanvasSelection | null) => {
    if (draft && s?.id !== draft.id) setDraft(null)
    setSelection(s)
  }
  const startFlow = (sId: ID, tId: ID) => {
    if (!canEdit) return toast.warning('You can’t edit data flows', 'Your role does not include managing workflows.')
    const s = modules.find((m) => m.id === sId)
    const t = modules.find((m) => m.id === tId)
    if (!s || !t) return
    const f = newFlow(ws, s, t)
    setDraft(f)
    setSelection({ kind: 'flow', id: f.id })
    setDialog(null)
    setTab('canvas')
  }
  const arrange = () => {
    if (!modules.length) return
    const edges = [...flows.map((f) => ({ from: f.sourceModuleId, to: f.targetModuleId })), ...rels.map((r) => ({ from: r.fromId, to: r.toId }))]
    setNodePositions(autoArrange(modules, edges))
    setTimeout(() => canvas.current?.fit(), 80)
    toast.success('Modules arranged', 'Laid out left to right following the lines.')
  }
  const remove = async (f: DataFlowLink) => {
    if (!(await confirmDialog({ title: `Delete “${f.name}”?`, message: 'The flow stops running. Records it already created or changed are kept.', confirmLabel: 'Delete flow', danger: true }))) return
    deleteFlow(f.id)
    setSelection(null)
    toast.success('Flow deleted')
  }
  const runNow = async (f: DataFlowLink) => {
    if (!(await confirmDialog({ title: 'Run on existing records?', message: `Applies “${f.name}” to every active record in ${modName(f.sourceModuleId)} now, creating or updating records in ${modName(f.targetModuleId)} as the flow says.`, confirmLabel: 'Run now' }))) return
    const res = runFlowNow(f)
    if (res.total === 0) toast.info('Nothing to run on', `${modName(f.sourceModuleId)} has no active records.`)
    else toast.success(`Ran on ${res.ran} of ${res.total} record${res.total === 1 ? '' : 's'}`, 'Records that fail the conditions are logged as skipped.')
  }

  const runCount = useRunStore((s) => s.runs).filter((r) => r.workspaceId === ws && r.kind === 'dataflow').length

  if (modules.length === 0) {
    return <EmptyState icon="Network" title="No modules to connect yet" description="Data flows connect modules. Create a module (or install a template) first." action={<><Button variant="primary" icon="Plus" onClick={() => go('/modules')}>Go to modules</Button><Button onClick={() => go('/templates')}>Browse templates</Button></>} />
  }

  const panelHeight = 'clamp(520px, calc(100vh - 300px), 900px)'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'canvas', label: 'Canvas', icon: 'Network' }, { id: 'runs', label: 'Run log', icon: 'History', count: runCount || undefined }]} />
        {tab === 'canvas' && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {focusModuleId && <Button size="sm" variant="ghost" icon={showAll ? 'EyeOff' : 'Eye'} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Only connected modules' : 'Show all modules'}</Button>}
            <Button size="sm" icon="Wand2" disabled={!canEdit} onClick={arrange} title="Lay modules out left to right following the lines">Auto-arrange</Button>
            <Button size="sm" variant="primary" icon="Plus" disabled={!canEdit} onClick={() => setDialog({ source: focusModuleId })}>New flow</Button>
          </div>
        )}
      </div>

      {tab === 'runs' ? <RunLog /> : (
        <>
          {!canEdit && <Notice tone="info">Your role can view data flows but not change them. Ask a workspace admin for the “Manage workflows” permission.</Notice>}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <DataFlowCanvas
              ref={canvas}
              modules={modules}
              visibleIds={visibleIds}
              flows={shownFlows}
              rels={shownRels}
              draft={draft}
              selection={selection}
              focusModuleId={focusing ? focusModuleId : undefined}
              canEdit={canEdit}
              recordCounts={recordCounts}
              height={panelHeight}
              onSelect={select}
              onConnect={startFlow}
              onStartFrom={(id) => setDialog({ source: id })}
              onOpenModule={(id) => go(`/m/${id}`)}
            />

            <aside className="scroll-thin overflow-y-auto rounded-xl border border-line bg-subtle/30 p-3" style={{ height: panelHeight }} aria-label="Data flow details">
              {selFlow ? (
                <FlowEditor
                  key={selFlow.id}
                  link={selFlow}
                  isNew={draft?.id === selFlow.id}
                  canEdit={canEdit}
                  onSave={(l) => { const saved = saveFlow(l); setDraft(null); setSelection({ kind: 'flow', id: saved.id }); toast.success('Flow saved', saved.enabled ? 'It runs whenever the trigger happens while Xcrm is open.' : 'It is switched off for now.') }}
                  onCancel={() => { setDraft(null); setSelection(null) }}
                  onDelete={draft?.id === selFlow.id ? undefined : () => remove(selFlow)}
                  onDuplicate={draft?.id === selFlow.id ? undefined : () => { const c = duplicateFlow(selFlow.id); if (c) { setSelection({ kind: 'flow', id: c.id }); toast.success('Flow duplicated', 'The copy is switched off until you enable it.') } }}
                  onRunNow={draft?.id === selFlow.id ? undefined : () => runNow(selFlow)}
                />
              ) : selRel ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2"><Icon name="Link2" size={16} /><h3 className="text-sm font-semibold">Relationship field</h3></div>
                  <p className="text-[13px]"><strong>{modName(selRel.fromId)}</strong> → <strong>{modName(selRel.toId)}</strong> via “{selRel.label}”.</p>
                  <p className="text-xs text-muted">This line is drawn from an existing relationship field, so it updates automatically. Add or remove the field in the module’s field settings.</p>
                  <div className="flex flex-wrap gap-2"><Button size="sm" icon="ExternalLink" onClick={() => go(`/m/${selRel.fromId}`)}>Open {modName(selRel.fromId)}</Button><Button size="sm" disabled={!canEdit} icon="Plus" onClick={() => startFlow(selRel.fromId, selRel.toId)}>New flow along it</Button></div>
                </div>
              ) : selNode ? (
                <NodePanel moduleName={selNode.name} color={selNode.color} icon={selNode.icon} records={recordCounts[selNode.id] ?? 0}
                  incoming={flows.filter((f) => f.targetModuleId === selNode.id)} outgoing={flows.filter((f) => f.sourceModuleId === selNode.id)}
                  modName={modName} canEdit={canEdit} onPick={(id) => setSelection({ kind: 'flow', id })}
                  onOpen={() => go(`/m/${selNode.id}`)} onNew={() => setDialog({ source: selNode.id })} />
              ) : (
                <FlowList flows={shownFlows} modules={modules} canEdit={canEdit} onPick={(id) => setSelection({ kind: 'flow', id })} onNew={() => setDialog({ source: focusModuleId })} />
              )}
            </aside>
          </div>
          <p className="text-xs text-muted">Drag a module to move it, drag from its <strong>+</strong> handle onto another module to connect them, drag the background to pan, Ctrl/⌘ + scroll to zoom. Chained flows stop after {MAX_FLOW_DEPTH} steps so they can’t loop forever.</p>
        </>
      )}

      <NewFlowDialog open={!!dialog} source={dialog?.source} onClose={() => setDialog(null)} onCreate={startFlow} />
    </div>
  )
}

function FlowList({ flows, modules, canEdit, onPick, onNew }: { flows: DataFlowLink[]; modules: ReturnType<typeof useModules>; canEdit: boolean; onPick: (id: string) => void; onNew: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Icon name="Network" size={16} /><h3 className="flex-1 text-sm font-semibold">Flows{flows.length ? ` (${flows.length})` : ''}</h3><Button size="sm" icon="Plus" disabled={!canEdit} onClick={onNew}>New</Button></div>
      {flows.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing connected yet. Drag from the <strong>+</strong> handle of one module onto another, or press New. A flow says: <em>when</em> something happens to a record, <em>if</em> it matches, <em>then</em> create, update or link records in another module.</p>
      ) : (
        <ul className="space-y-2">
          {flows.map((f) => {
            const meta = actionMeta(f.action.type)
            return (
              <li key={f.id} className="rounded-xl border border-line bg-surface p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onPick(f.id)}>
                    <span className="block truncate text-[13px] font-semibold hover:underline">{f.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">{flowSummary(f, modules)}</span>
                  </button>
                  <Switch checked={f.enabled} disabled={!canEdit} label={`${f.enabled ? 'Disable' : 'Enable'} ${f.name}`} onChange={(v) => setFlowEnabled(f.id, v)} />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-[11px] text-muted">{FLOW_ACTIONS.map((a) => <span key={a.id} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: a.color }} />{a.label}</span>)}</div>
    </div>
  )
}

function NodePanel({ moduleName, color, icon, records, incoming, outgoing, modName, canEdit, onPick, onOpen, onNew }: { moduleName: string; color: string; icon: string; records: number; incoming: DataFlowLink[]; outgoing: DataFlowLink[]; modName: (id: ID) => string; canEdit: boolean; onPick: (id: string) => void; onOpen: () => void; onNew: () => void }) {
  const List = ({ title, items, other }: { title: string; items: DataFlowLink[]; other: (f: DataFlowLink) => ID }) => (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-muted uppercase">{title} ({items.length})</h4>
      {items.length === 0 ? <p className="text-xs text-muted">None</p> : (
        <ul className="space-y-1">{items.map((f) => <li key={f.id}><button type="button" onClick={() => onPick(f.id)} className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[13px] hover:bg-subtle"><span className="size-2 rounded-full" style={{ background: actionMeta(f.action.type).color }} /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="text-xs text-muted">{modName(other(f))}</span></button></li>)}</ul>
      )}
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-lg text-white" style={{ background: color }}><Icon name={icon} size={18} /></span><div><h3 className="text-sm font-semibold">{moduleName}</h3><p className="text-xs text-muted">{records} active record{records === 1 ? '' : 's'}</p></div></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" icon="ExternalLink" onClick={onOpen}>Open records</Button><Button size="sm" variant="primary" icon="Plus" disabled={!canEdit} onClick={onNew}>New flow from here</Button></div>
      <List title="Outgoing" items={outgoing} other={(f) => f.targetModuleId} />
      <List title="Incoming" items={incoming} other={(f) => f.sourceModuleId} />
    </div>
  )
}
