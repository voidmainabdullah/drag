import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import type { ActionType, Field as FieldT, Module, TriggerType, Workflow, WorkflowAction, WorkflowCondition } from '#/types'
import { useAllModules, useModules, useUsers } from '#/hooks/useData'
import { OPERATORS, isChoiceType, isDateType } from '#/utils/fieldTypes'
import { uid } from '#/utils/id'
import { Button } from '#/components/ui/Button'
import { Field, Input, Select, Switch, Textarea } from '#/components/ui/controls'
import { FieldInput } from '#/components/fields/FieldInput'
import { FilterValueInput } from '#/components/records/FilterEditor'
import { fieldsWithMeta } from '#/utils/records'
import { Icon } from '#/components/ui/Icon'

export const TRIGGERS: { id: TriggerType; label: string; hint: string }[] = [
  { id: 'record_created', label: 'A record is created', hint: 'Runs right after a new record is saved' },
  { id: 'record_updated', label: 'A record is updated', hint: 'Runs after any edit to a record' },
  { id: 'record_deleted', label: 'A record is deleted', hint: 'Runs when a record is moved to the trash' },
  { id: 'field_changed', label: 'A field changes', hint: 'Runs when the chosen field gets a new value' },
  { id: 'status_changed', label: 'A status changes', hint: 'Runs when a dropdown field changes (optionally to one value)' },
  { id: 'date_reached', label: 'A date is reached', hint: 'Runs on the day of a date field (checked while the app is open)' },
  { id: 'manual', label: 'Manually, with a button', hint: 'Only runs when you click “Run now” or use the record menu' },
]

export const ACTIONS: { id: ActionType; label: string; icon: string }[] = [
  { id: 'update_record', label: 'Update a field', icon: 'Pencil' },
  { id: 'change_status', label: 'Change status', icon: 'RefreshCw' },
  { id: 'create_task', label: 'Create a task', icon: 'CheckSquare' },
  { id: 'create_followup', label: 'Create a follow-up task', icon: 'CalendarClock' },
  { id: 'create_record', label: 'Create a record in a module', icon: 'FilePlus' },
  { id: 'assign_user', label: 'Assign a user', icon: 'UserPlus' },
  { id: 'add_tag', label: 'Add a tag', icon: 'Tag' },
  { id: 'notify', label: 'Show a notification', icon: 'Bell' },
]

export function triggerSummary(w: Workflow, m?: Module): string {
  const t = w.trigger
  const f = m?.fields.find((x) => x.id === t.fieldId)
  const base = TRIGGERS.find((x) => x.id === t.type)?.label ?? t.type
  if ((t.type === 'field_changed' || t.type === 'status_changed') && f) return `${f.label} changes`
  if (t.type === 'date_reached' && f) return `${f.label} reached${t.offsetDays ? ` (${t.offsetDays > 0 ? '+' : ''}${t.offsetDays}d)` : ''}`
  return base
}

function StepCard({ n, tone, title, children, actions }: { n: string; tone: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white" style={{ background: tone }}>{n}</span>
        <span className="flex-1 text-[13px] font-semibold">{title}</span>
        {actions}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function ActionEditor({ action, module, onChange }: { action: WorkflowAction; module: Module; onChange: (p: Partial<WorkflowAction>) => void }) {
  const modules = useAllModules()
  const users = useUsers()
  const target = modules.find((m) => m.id === action.moduleId)
  const editable = (m: Module) => m.fields.filter((f) => f.type !== 'formula' && f.type !== 'autoId')
  const field = module.fields.find((f) => f.id === action.fieldId)
  switch (action.type) {
    case 'update_record':
    case 'change_status': {
      const list = action.type === 'change_status' ? module.fields.filter((f) => f.type === 'dropdown' || f.type === 'radio') : editable(module)
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Field"><Select value={action.fieldId ?? ''} onChange={(e) => onChange({ fieldId: e.target.value || undefined, value: undefined })}><option value="">Choose a field…</option>{list.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
          <Field label="New value" hint="Supports {{title}}, {{today}}, {{value}}, or {{field_id}}">
            {field ? <FieldInput field={{ ...field, required: false }} value={action.value} onChange={(v) => onChange({ value: v })} ownerModuleId={module.id} /> : <Input disabled placeholder="Pick a field first" />}
          </Field>
        </div>
      )
    }
    case 'assign_user':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="User field"><Select value={action.fieldId ?? ''} onChange={(e) => onChange({ fieldId: e.target.value || undefined })}><option value="">Choose a field…</option>{module.fields.filter((f) => f.type === 'user').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
          <Field label="Assign to"><Select value={action.userId ?? ''} onChange={(e) => onChange({ userId: e.target.value || undefined })}><option value="">Choose a user…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          {module.fields.every((f) => f.type !== 'user') && <p className="text-xs text-warning sm:col-span-2">This module has no User field. Add one in the Field Manager first.</p>}
        </div>
      )
    case 'add_tag':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tag field"><Select value={action.fieldId ?? ''} onChange={(e) => onChange({ fieldId: e.target.value || undefined })}><option value="">Choose a field…</option>{module.fields.filter((f) => ['tags', 'multiSelect', 'checkboxes'].includes(f.type)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
          <Field label="Tag to add"><Input value={String(action.value ?? '')} onChange={(e) => onChange({ value: e.target.value })} placeholder="e.g. VIP" /></Field>
        </div>
      )
    case 'create_task':
    case 'create_followup':
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Task title" className="sm:col-span-3"><Input value={action.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder={action.type === 'create_followup' ? 'Follow up: {{title}}' : 'Task for {{title}}'} /></Field>
          <Field label="Due in (days)"><Input type="number" min={0} value={action.days ?? (action.type === 'create_followup' ? 2 : 0)} onChange={(e) => onChange({ days: Math.max(0, Number(e.target.value) || 0) })} /></Field>
          <Field label="Assignee" className="sm:col-span-2"><Select value={action.userId ?? 'owner'} onChange={(e) => onChange({ userId: e.target.value })}><option value="owner">Record creator</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        </div>
      )
    case 'notify':
      return <Field label="Message" hint="Shown as a toast and written to the activity log"><Input value={action.message ?? ''} onChange={(e) => onChange({ message: e.target.value })} placeholder="Workflow notification for {{title}}" /></Field>
    case 'create_record':
      return (
        <div className="space-y-3">
          <Field label="Create in module"><Select value={action.moduleId ?? ''} onChange={(e) => onChange({ moduleId: e.target.value || undefined, values: {} })}><option value="">Choose a module…</option>{modules.filter((m) => !m.archived).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          {target && (
            <div className="space-y-2 rounded-lg bg-subtle/50 p-3">
              <p className="text-xs text-muted">Optional values. Use tokens like {'{{title}}'}, or {'{{id}}'} to link back to the triggering record.</p>
              {editable(target).slice(0, 14).map((f) => (
                <div key={f.id} className="grid items-center gap-2 sm:grid-cols-[160px_1fr]">
                  <label className="truncate text-[13px]" htmlFor={`cv-${action.id}-${f.id}`}>{f.label}</label>
                  <Input id={`cv-${action.id}-${f.id}`} value={action.values?.[f.id] ?? ''} onChange={(e) => onChange({ values: { ...(action.values ?? {}), [f.id]: e.target.value } })} />
                </div>
              ))}
            </div>
          )}
        </div>
      )
  }
}

export function WorkflowEditor({ workflow, onSave, onDirty }: { workflow: Workflow; onSave: (w: Workflow) => void; onDirty?: (d: boolean) => void }) {
  const modules = useModules()
  const [w, setW] = useState<Workflow>(workflow)
  const [errors, setErrors] = useState<string[]>([])
  useEffect(() => { setW(workflow); setErrors([]) }, [workflow.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = useMemo(() => JSON.stringify(w) !== JSON.stringify(workflow), [w, workflow])
  useEffect(() => onDirty?.(dirty), [dirty]) // eslint-disable-line react-hooks/exhaustive-deps

  const module = modules.find((m) => m.id === w.moduleId)
  if (!module) return <p className="text-sm text-danger">The module for this workflow no longer exists.</p>
  const fields = fieldsWithMeta(module)
  const patch = (p: Partial<Workflow>) => setW((x) => ({ ...x, ...p }))
  const setTrigger = (p: Partial<Workflow['trigger']>) => setW((x) => ({ ...x, trigger: { ...x.trigger, ...p } }))
  const setCond = (id: string, p: Partial<WorkflowCondition>) => patch({ conditions: w.conditions.map((c) => (c.id === id ? { ...c, ...p } : c)) })
  const setAct = (id: string, p: Partial<WorkflowAction>) => patch({ actions: w.actions.map((a) => (a.id === id ? { ...a, ...p } : a)) })
  const moveAct = (i: number, d: -1 | 1) => { const a = [...w.actions]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); patch({ actions: a }) }

  const trig = w.trigger
  const trigField = module.fields.find((f) => f.id === trig.fieldId)

  const validate = (): string[] => {
    const e: string[] = []
    if (!w.name.trim()) e.push('Give the workflow a name.')
    if ((trig.type === 'field_changed' || trig.type === 'status_changed' || trig.type === 'date_reached') && !trigField) e.push('Choose the field for the trigger.')
    w.conditions.forEach((c, i) => { if (!c.fieldId) e.push(`Condition ${i + 1}: choose a field.`) })
    if (!w.actions.length) e.push('Add at least one action.')
    w.actions.forEach((a, i) => {
      const n = `Action ${i + 1}`
      if ((a.type === 'update_record' || a.type === 'change_status' || a.type === 'assign_user' || a.type === 'add_tag') && !a.fieldId) e.push(`${n}: choose a field.`)
      if (a.type === 'assign_user' && !a.userId) e.push(`${n}: choose a user.`)
      if (a.type === 'add_tag' && !String(a.value ?? '').trim()) e.push(`${n}: enter a tag.`)
      if (a.type === 'create_record' && !a.moduleId) e.push(`${n}: choose a module.`)
    })
    return e
  }
  const save = () => {
    const e = validate()
    setErrors(e)
    if (e.length) return
    onSave({ ...w, name: w.name.trim() })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Workflow name" required><Input value={w.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
        <div className="flex items-end pb-1.5"><Switch checked={w.enabled} onChange={(v) => patch({ enabled: v })} label={w.enabled ? 'Enabled' : 'Disabled'} /></div>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={1} className="min-h-[36px] py-1.5" value={w.description ?? ''} onChange={(e) => patch({ description: e.target.value || undefined })} /></Field>
      </div>

      <StepCard n="WHEN" tone="#7B68EE" title="Trigger">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Module"><Select value={w.moduleId} onChange={(e) => patch({ moduleId: e.target.value, trigger: { type: trig.type }, conditions: [], actions: w.actions.filter((a) => a.type === 'notify' || a.type.startsWith('create')).map((a) => ({ ...a })) })}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="Event" hint={TRIGGERS.find((t) => t.id === trig.type)?.hint}><Select value={trig.type} onChange={(e) => setTrigger({ type: e.target.value as TriggerType, fieldId: undefined, value: undefined, offsetDays: undefined })}>{TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
          {(trig.type === 'field_changed' || trig.type === 'status_changed') && (
            <>
              <Field label="Field"><Select value={trig.fieldId ?? ''} onChange={(e) => setTrigger({ fieldId: e.target.value || undefined, value: undefined })}><option value="">Choose a field…</option>{module.fields.filter((f) => trig.type === 'status_changed' ? f.type === 'dropdown' || f.type === 'radio' : f.type !== 'formula').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
              <Field label="Only when it becomes (optional)">{trigField && (isChoiceType(trigField.type) ? <Select value={String(trig.value ?? '')} onChange={(e) => setTrigger({ value: e.target.value || undefined })}><option value="">Any value</option>{trigField.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select> : <Input value={String(trig.value ?? '')} onChange={(e) => setTrigger({ value: e.target.value || undefined })} placeholder="Any value" />)}</Field>
            </>
          )}
          {trig.type === 'date_reached' && (
            <>
              <Field label="Date field"><Select value={trig.fieldId ?? ''} onChange={(e) => setTrigger({ fieldId: e.target.value || undefined })}><option value="">Choose a field…</option>{module.fields.filter((f) => isDateType(f.type)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
              <Field label="Offset (days)" hint="Negative = before the date, positive = after"><Input type="number" value={trig.offsetDays ?? 0} onChange={(e) => setTrigger({ offsetDays: Number(e.target.value) || 0 })} /></Field>
            </>
          )}
        </div>
      </StepCard>

      <StepCard n="IF" tone="#F5A524" title="Conditions (all must match)" actions={<Button size="xs" icon="Plus" onClick={() => patch({ conditions: [...w.conditions, { id: uid('cond'), fieldId: '', op: 'equals' }] })}>Add condition</Button>}>
        {w.conditions.length === 0 ? <p className="text-[13px] text-muted">No conditions — the actions run every time the trigger fires.</p> : (
          <div className="space-y-2">
            {w.conditions.map((c) => {
              const f: FieldT | undefined = fields.find((x) => x.id === c.fieldId)
              const needs = OPERATORS.find((o) => o.op === c.op)?.needsValue !== false
              return (
                <div key={c.id} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]">
                  <Select aria-label="Condition field" value={c.fieldId} onChange={(e) => setCond(c.id, { fieldId: e.target.value, value: undefined })}><option value="">Field…</option>{fields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select>
                  <Select aria-label="Condition operator" value={c.op} onChange={(e) => setCond(c.id, { op: e.target.value as WorkflowCondition['op'] })}>{OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</Select>
                  {needs && f ? <FilterValueInput field={f} value={c.value} onChange={(v) => setCond(c.id, { value: v })} /> : <span />}
                  <button type="button" aria-label="Remove condition" onClick={() => patch({ conditions: w.conditions.filter((x) => x.id !== c.id) })} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </StepCard>

      <StepCard n="THEN" tone="#2DB67D" title="Actions (run in order)" actions={<Button size="xs" icon="Plus" onClick={() => patch({ actions: [...w.actions, { id: uid('act'), type: 'notify', message: '' }] })}>Add action</Button>}>
        {w.actions.length === 0 ? <p className="text-[13px] text-muted">Add an action to tell the workflow what to do.</p> : (
          <div className="space-y-3">
            {w.actions.map((a, i) => (
              <div key={a.id} className="rounded-lg border border-line p-3">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-success/15 text-[11px] font-bold text-success">{i + 1}</span>
                  <Icon name={ACTIONS.find((x) => x.id === a.type)?.icon} size={14} className="text-muted" />
                  <Select aria-label="Action type" className="h-8 max-w-[260px]" value={a.type} onChange={(e) => setW((x) => ({ ...x, actions: x.actions.map((y) => (y.id === a.id ? { id: a.id, type: e.target.value as ActionType } : y)) }))}>{ACTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
                  <div className="ml-auto flex">
                    <button type="button" aria-label="Move action up" disabled={i === 0} onClick={() => moveAct(i, -1)} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30"><ArrowUp size={14} /></button>
                    <button type="button" aria-label="Move action down" disabled={i === w.actions.length - 1} onClick={() => moveAct(i, 1)} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30"><ArrowDown size={14} /></button>
                    <button type="button" aria-label="Remove action" onClick={() => patch({ actions: w.actions.filter((x) => x.id !== a.id) })} className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
                  </div>
                </div>
                <ActionEditor action={a} module={module} onChange={(p) => setAct(a.id, p)} />
              </div>
            ))}
          </div>
        )}
      </StepCard>

      {errors.length > 0 && <ul className="list-disc rounded-lg border border-danger/30 bg-danger/10 py-2 pr-3 pl-7 text-[13px]" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon="Save" onClick={save} disabled={!dirty}>Save workflow</Button>
        {dirty && <Button variant="ghost" onClick={() => { setW(workflow); setErrors([]) }}>Discard changes</Button>}
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
      </div>
    </div>
  )
}
