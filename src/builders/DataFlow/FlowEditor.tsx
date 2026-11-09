import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import type { DataFlowLink, Field as FieldT, FlowActionType, FlowFieldMap, FlowSetValue, FlowTriggerType, WorkflowCondition } from '#/types'
import { useModules } from '#/hooks/useData'
import { OPERATORS, isChoiceType } from '#/utils/fieldTypes'
import { fieldsWithMeta } from '#/utils/records'
import { uid } from '#/utils/id'
import { FLOW_ACTIONS, FLOW_TRIGGERS, actionMeta, decodeLink, encodeLink, flowSummary, linkOptions, mappableSource, mappableTarget, suggestMappings, validateFlow } from '#/utils/dataflow'
import { Button } from '#/components/ui/Button'
import { Field, Input, Select, Switch } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { FieldInput } from '#/components/fields/FieldInput'
import { FilterValueInput } from '#/components/records/FilterEditor'
import { FIELD_TYPE_MAP } from '#/utils/fieldTypes'

const strip = (l: DataFlowLink) => JSON.stringify({ ...l, updatedAt: '', createdAt: '' })
const omit = (o: Record<string, unknown>, k: string): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k))
const typeLabel = (f: FieldT) => FIELD_TYPE_MAP[f.type]?.label ?? f.type

function Step({ n, tone, title, children, actions }: { n: string; tone: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white" style={{ background: tone }}>{n}</span>
        <h4 className="flex-1 text-[13px] font-semibold">{title}</h4>
        {actions}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  )
}

const RemoveBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
)

function FieldSelect({ value, onChange, fields, label, placeholder = 'Field…' }: { value: string; onChange: (v: string) => void; fields: FieldT[]; label: string; placeholder?: string }) {
  return (
    <Select aria-label={label} className="h-8 min-w-0 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {fields.map((f) => <option key={f.id} value={f.id}>{f.label} · {typeLabel(f)}</option>)}
    </Select>
  )
}

export interface FlowEditorProps {
  link: DataFlowLink
  isNew: boolean
  canEdit: boolean
  onSave: (l: DataFlowLink) => void
  onCancel: () => void
  onDelete?: () => void
  onDuplicate?: () => void
  onRunNow?: () => void
}

export function FlowEditor({ link, isNew, canEdit, onSave, onCancel, onDelete, onDuplicate, onRunNow }: FlowEditorProps) {
  const modules = useModules()
  const [w, setW] = useState<DataFlowLink>(link)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => { setW(link); setErrors([]) }, [link.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const source = modules.find((m) => m.id === w.sourceModuleId)
  const target = modules.find((m) => m.id === w.targetModuleId)
  const dirty = useMemo(() => isNew || strip(w) !== strip(link), [w, link, isNew])
  const links = useMemo(() => linkOptions(source, target), [source, target])
  const a = w.action

  if (!source || !target) {
    return (
      <div className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-[13px]">
        <p>One of the modules in this flow no longer exists, so it cannot run.</p>
        {onDelete && canEdit && <Button size="sm" variant="danger" icon="Trash2" onClick={onDelete}>Delete flow</Button>}
      </div>
    )
  }

  const patch = (p: Partial<DataFlowLink>) => setW((x) => ({ ...x, ...p }))
  const setTrigger = (p: Partial<DataFlowLink['trigger']>) => setW((x) => ({ ...x, trigger: { ...x.trigger, ...p } }))
  const setAction = (p: Partial<DataFlowLink['action']>) => setW((x) => ({ ...x, action: { ...x.action, ...p } }))
  const setCond = (id: string, p: Partial<WorkflowCondition>) => patch({ conditions: w.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) })

  const srcFields = source.fields.filter(mappableSource)
  const tgtFields = target.fields.filter(mappableTarget)
  const trigField = source.fields.find((f) => f.id === w.trigger.fieldId)
  const metaFields = fieldsWithMeta(source).filter((f) => f.type !== 'password')

  const changeType = (type: FlowActionType) => {
    const preferred = links.find((o) => o.link.side === (type === 'create_linked' ? 'target' : 'source')) ?? links[0]
    setW((x) => ({
      ...x,
      trigger: type === 'link_records' && x.trigger.type === 'record_deleted' ? { type: 'record_created' } : x.trigger,
      action: {
        type,
        mappings: type === 'create_linked' ? (x.action.mappings.length ? x.action.mappings : suggestMappings(source, target)) : x.action.mappings,
        defaults: x.action.defaults,
        sets: x.action.sets,
        linkField: x.action.linkField && links.some((o) => encodeLink(o.link) === encodeLink(x.action.linkField)) ? x.action.linkField : preferred?.link,
        matchSourceFieldId: x.action.matchSourceFieldId,
        matchTargetFieldId: x.action.matchTargetFieldId,
      },
    }))
  }

  const save = () => {
    const e = validateFlow(w, modules)
    setErrors(e)
    if (e.length) return
    onSave({ ...w, name: w.name.trim() })
  }

  const addMapping = () => setAction({ mappings: [...a.mappings, { id: uid('map'), sourceFieldId: '', targetFieldId: '' }] })
  const setMapping = (id: string, p: Partial<FlowFieldMap>) => setAction({ mappings: a.mappings.map((m) => (m.id === id ? { ...m, ...p } : m)) })
  const addSet = () => setAction({ sets: [...a.sets, { id: uid('set'), targetFieldId: '', mode: 'copy' }] })
  const setSet = (id: string, p: Partial<FlowSetValue>) => setAction({ sets: a.sets.map((s) => (s.id === id ? { ...s, ...p } : s)) })
  const defaultIds = Object.keys(a.defaults)
  const freeDefaultFields = tgtFields.filter((f) => !defaultIds.includes(f.id))
  const linkSelect = (required: boolean) => (
    <Field label={required ? 'Linked through (relationship)' : 'Also link the records through'} hint={links.length ? undefined : `${source.name} and ${target.name} have no relationship field between them yet. Add one in the Module Builder → Relationships.`}>
      <Select value={encodeLink(a.linkField)} disabled={!canEdit || !links.length} onChange={(e) => setAction({ linkField: decodeLink(e.target.value) })}>
        <option value="">{required ? 'Choose a relationship…' : 'Don’t link'}</option>
        {links.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </Field>
  )

  return (
    <div className="space-y-3">
      <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-80">
        <div className="space-y-2">
          <Field label="Flow name" required><Input value={w.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-subtle/60 px-3 py-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-1.5 font-medium"><Icon name={source.icon} size={14} />{source.name}<ArrowRight size={13} className="shrink-0 text-muted" /><Icon name={target.icon} size={14} />{target.name}</span>
            <Switch checked={w.enabled} onChange={(v) => patch({ enabled: v })} label={w.enabled ? 'On' : 'Off'} />
          </div>
        </div>

        <Step n="WHEN" tone="#7B68EE" title={`In ${source.name}`}>
          <Field label="Event" hint={FLOW_TRIGGERS.find((t) => t.id === w.trigger.type)?.hint}>
            <Select value={w.trigger.type} onChange={(e) => setTrigger({ type: e.target.value as FlowTriggerType, fieldId: undefined, value: undefined })}>
              {FLOW_TRIGGERS.filter((t) => !(a.type === 'link_records' && t.id === 'record_deleted')).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          {w.trigger.type === 'field_changed' && (
            <>
              <Field label="Field"><FieldSelect label="Trigger field" value={w.trigger.fieldId ?? ''} onChange={(v) => setTrigger({ fieldId: v || undefined, value: undefined })} fields={source.fields.filter((f) => f.type !== 'formula')} /></Field>
              {trigField && (
                <Field label="Only when it becomes (optional)">
                  {isChoiceType(trigField.type) ? (
                    <Select value={String(w.trigger.value ?? '')} onChange={(e) => setTrigger({ value: e.target.value || undefined })}><option value="">Any value</option>{trigField.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
                  ) : (
                    <Input value={String(w.trigger.value ?? '')} onChange={(e) => setTrigger({ value: e.target.value || undefined })} placeholder="Any value" />
                  )}
                </Field>
              )}
            </>
          )}
        </Step>

        <Step n="IF" tone="#F5A524" title="Conditions (all must match)" actions={<Button size="xs" icon="Plus" onClick={() => patch({ conditions: [...w.conditions, { id: uid('cnd'), fieldId: '', op: 'equals' }] })}>Add</Button>}>
          {w.conditions.length === 0 ? <p className="text-[13px] text-muted">No conditions — every matching event runs the flow.</p> : w.conditions.map((c) => {
            const f = metaFields.find((x) => x.id === c.fieldId)
            const needs = OPERATORS.find((o) => o.op === c.op)?.needsValue !== false
            return (
              <div key={c.id} className="space-y-1.5 rounded-lg border border-line p-2">
                <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
                  <Select aria-label="Condition field" className="h-8 text-[13px]" value={c.fieldId} onChange={(e) => setCond(c.id, { fieldId: e.target.value, value: undefined })}><option value="">Field…</option>{metaFields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
                  <Select aria-label="Condition operator" className="h-8 text-[13px]" value={c.op} onChange={(e) => setCond(c.id, { op: e.target.value as WorkflowCondition['op'] })}>{OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</Select>
                  <RemoveBtn label="Remove condition" onClick={() => patch({ conditions: w.conditions.filter((x) => x.id !== c.id) })} />
                </div>
                {needs && f && <FilterValueInput field={f} value={c.value} onChange={(v) => setCond(c.id, { value: v })} />}
              </div>
            )
          })}
        </Step>

        <Step n="THEN" tone={actionMeta(a.type).color} title={`In ${target.name}`}>
          <Field label="Action" hint={actionMeta(a.type).hint}>
            <Select value={a.type} onChange={(e) => changeType(e.target.value as FlowActionType)}>{FLOW_ACTIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
          </Field>

          {a.type === 'create_linked' && (
            <>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-medium">Field mapping</span>
                  <span className="flex gap-1">
                    <Button size="xs" variant="ghost" icon="Wand2" title="Pair fields that share a name" onClick={() => { const next = suggestMappings(source, target); setAction({ mappings: [...a.mappings, ...next.filter((n) => !a.mappings.some((m) => m.targetFieldId === n.targetFieldId))] }) }}>Auto-map</Button>
                    <Button size="xs" icon="Plus" onClick={addMapping}>Add</Button>
                  </span>
                </div>
                {a.mappings.length === 0 ? <p className="text-[13px] text-muted">No fields copied yet.</p> : (
                  <div className="space-y-1.5">
                    {a.mappings.map((m) => {
                      const sf = source.fields.find((f) => f.id === m.sourceFieldId)
                      const tf = target.fields.find((f) => f.id === m.targetFieldId)
                      return (
                        <div key={m.id}>
                          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
                            <FieldSelect label="Source field" value={m.sourceFieldId} onChange={(v) => setMapping(m.id, { sourceFieldId: v })} fields={srcFields} placeholder={`${source.name} field…`} />
                            <ArrowRight size={13} className="text-muted" />
                            <FieldSelect label="Target field" value={m.targetFieldId} onChange={(v) => setMapping(m.id, { targetFieldId: v })} fields={tgtFields} placeholder={`${target.name} field…`} />
                            <RemoveBtn label="Remove mapping" onClick={() => setAction({ mappings: a.mappings.filter((x) => x.id !== m.id) })} />
                          </div>
                          {sf && tf && sf.type !== tf.type && <p className="mt-0.5 pl-1 text-[11px] text-muted">{typeLabel(sf)} → {typeLabel(tf)}: converted through text.</p>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] font-medium">Default values</span>
                  <Button size="xs" icon="Plus" disabled={!freeDefaultFields.length} onClick={() => setAction({ defaults: { ...a.defaults, [freeDefaultFields[0].id]: '' } })}>Add</Button>
                </div>
                {defaultIds.length === 0 ? <p className="text-[13px] text-muted">Optional values set on every new {target.name} record. Text supports {'{{title}}'}, {'{{today}}'} or {'{{field_id}}'}.</p> : (
                  <div className="space-y-2">
                    {defaultIds.map((fid) => {
                      const f = target.fields.find((x) => x.id === fid)
                      return (
                        <div key={fid} className="space-y-1.5 rounded-lg border border-line p-2">
                          <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
                            <Select aria-label="Default value field" className="h-8 text-[13px]" value={fid} onChange={(e) => setAction({ defaults: { ...omit(a.defaults, fid), [e.target.value]: '' } })}>
                              {tgtFields.filter((x) => x.id === fid || !defaultIds.includes(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                            </Select>
                            <RemoveBtn label="Remove default value" onClick={() => setAction({ defaults: omit(a.defaults, fid) })} />
                          </div>
                          {f && <FieldInput field={{ ...f, required: false }} value={a.defaults[fid]} onChange={(v) => setAction({ defaults: { ...a.defaults, [fid]: v } })} ownerModuleId={target.id} />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {linkSelect(false)}
              <p className="text-xs text-muted">The linked record is created once per source record. Later runs update it instead of creating duplicates.</p>
            </>
          )}

          {a.type === 'update_linked' && (
            <>
              {linkSelect(true)}
              <div>
                <div className="mb-1.5 flex items-center justify-between"><span className="text-[13px] font-medium">Fields to update in {target.name}</span><Button size="xs" icon="Plus" onClick={addSet}>Add</Button></div>
                {a.sets.length === 0 ? <p className="text-[13px] text-muted">Nothing to update yet.</p> : (
                  <div className="space-y-2">
                    {a.sets.map((s) => {
                      const tf = target.fields.find((f) => f.id === s.targetFieldId)
                      return (
                        <div key={s.id} className="space-y-1.5 rounded-lg border border-line p-2">
                          <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
                            <FieldSelect label="Target field" value={s.targetFieldId} onChange={(v) => setSet(s.id, { targetFieldId: v, value: undefined })} fields={tgtFields} placeholder={`${target.name} field…`} />
                            <RemoveBtn label="Remove update" onClick={() => setAction({ sets: a.sets.filter((x) => x.id !== s.id) })} />
                          </div>
                          <Select aria-label="Set mode" className="h-8 text-[13px]" value={s.mode} onChange={(e) => setSet(s.id, { mode: e.target.value as FlowSetValue['mode'], value: undefined, sourceFieldId: undefined })}>
                            <option value="copy">Copy from a {source.name} field</option>
                            <option value="value">Set to a fixed value</option>
                          </Select>
                          {s.mode === 'copy' ? (
                            <FieldSelect label="Source field" value={s.sourceFieldId ?? ''} onChange={(v) => setSet(s.id, { sourceFieldId: v })} fields={srcFields} placeholder={`${source.name} field…`} />
                          ) : tf ? (
                            <FieldInput field={{ ...tf, required: false }} value={s.value} onChange={(v) => setSet(s.id, { value: v })} ownerModuleId={target.id} />
                          ) : <Input disabled placeholder="Pick a target field first" />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {a.type === 'link_records' && (
            <>
              {linkSelect(true)}
              <Field label={`Match this ${source.name} field…`}><FieldSelect label="Source match field" value={a.matchSourceFieldId ?? ''} onChange={(v) => setAction({ matchSourceFieldId: v || undefined })} fields={srcFields} /></Field>
              <Field label={`…with this ${target.name} field`}><FieldSelect label="Target match field" value={a.matchTargetFieldId ?? ''} onChange={(v) => setAction({ matchTargetFieldId: v || undefined })} fields={target.fields.filter((f) => f.type !== 'password')} /></Field>
              <p className="text-xs text-muted">Matching ignores upper/lower case. If nothing matches, the run is logged as skipped.</p>
            </>
          )}
        </Step>
      </fieldset>

      {errors.length > 0 && <ul className="list-disc rounded-lg border border-danger/30 bg-danger/10 py-2 pr-3 pl-7 text-[13px]" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {!canEdit && <p className="text-xs text-warning">Your role can’t change data flows.</p>}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="Save" onClick={save} disabled={!dirty}>{isNew ? 'Create flow' : 'Save flow'}</Button>
          <Button variant="ghost" onClick={() => { if (isNew || !dirty) onCancel(); else { setW(link); setErrors([]) } }}>{isNew ? 'Cancel' : dirty ? 'Discard changes' : 'Close'}</Button>
          {!isNew && dirty && <span className="text-xs text-warning">Unsaved changes</span>}
        </div>
      )}
      {canEdit && !isNew && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {onRunNow && <Button size="sm" icon="Play" disabled={dirty || w.trigger.type === 'record_deleted' || !w.enabled} title={dirty ? 'Save your changes first' : w.enabled ? undefined : 'Turn the flow on first'} onClick={onRunNow}>Run on existing records</Button>}
          {onDuplicate && <Button size="sm" icon="Copy" onClick={onDuplicate}>Duplicate</Button>}
          {onDelete && <Button size="sm" variant="danger" icon="Trash2" onClick={onDelete}>Delete</Button>}
        </div>
      )}
      <p className="text-[11px] text-muted">{flowSummary(w, modules)}. Runs only while Xcrm is open in a browser tab.</p>
    </div>
  )
}
