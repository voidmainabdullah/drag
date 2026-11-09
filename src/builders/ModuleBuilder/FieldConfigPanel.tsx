import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Field, FieldAccess, FilterOp, Module } from '#/types'
import { CURRENCIES, FIELD_TYPE_MAP, OPERATORS, OPTION_COLORS, isChoiceType } from '#/utils/fieldTypes'
import { validateFormula } from '#/utils/formula'
import { slug, uid } from '#/utils/id'
import { useAllModules, useRoles } from '#/hooks/useData'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Checkbox, Field as FormField, Input, Select, Textarea } from '#/components/ui/controls'
import { Notice } from '#/components/ui/misc'
import { FieldInput } from '#/components/fields/FieldInput'
import { FilterValueInput } from '#/components/records/FilterEditor'

const FORMULA_HELP = 'Use {field_name} to reference fields. Operators: + - * / % ^ = != < > <= >= && ||. Functions: IF, ROUND, ABS, MIN, MAX, SUM, AVG, CONCAT, UPPER, LOWER, LEN, TODAY, DAYS_BETWEEN, AND, OR, NOT.'

export function FieldConfigPanel({ module, field, isNew, onClose, onSave }: { module: Module; field: Field; isNew: boolean; onClose: () => void; onSave: (f: Field) => void }) {
  const [f, setF] = useState<Field>(() => structuredClone(field))
  const [nameTouched, setNameTouched] = useState(!isNew)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const modules = useAllModules()
  const roles = useRoles()
  const t = f.type
  const set = (patch: Partial<Field>) => setF((x) => ({ ...x, ...patch }))
  const others = module.fields.filter((x) => x.id !== f.id)
  const targetModule = modules.find((m) => m.id === f.relation?.moduleId)
  const condField = others.find((x) => x.id === f.condition?.fieldId)

  const formulaError = useMemo(() => (t === 'formula' && f.formula ? validateFormula(f.formula) : null), [t, f.formula])

  const save = () => {
    const e: Record<string, string> = {}
    if (!f.label.trim()) e.label = 'Label is required'
    const name = slug(f.name || f.label)
    if (others.some((x) => x.name === name)) e.name = 'Another field already uses this API name'
    if (isChoiceType(t) && (f.options ?? []).filter((o) => o.label.trim()).length === 0) e.options = 'Add at least one option'
    if (t === 'relationship' && !f.relation?.moduleId) e.relation = 'Choose the module to link to'
    if (t === 'formula') {
      const fe = validateFormula(f.formula ?? '')
      if (fe) e.formula = fe
    }
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) e.min = 'Min cannot exceed max'
    setErrors(e)
    if (Object.keys(e).length) return
    onSave({
      ...f,
      label: f.label.trim(),
      name,
      options: isChoiceType(t) ? (f.options ?? []).filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() })) : undefined,
      condition: f.condition?.fieldId ? f.condition : undefined,
    })
  }

  const textual = ['shortText', 'longText', 'email', 'phone', 'website', 'password'].includes(t)
  const numeric = ['number', 'currency', 'percentage'].includes(t)
  const canDefault = !['formula', 'autoId', 'signature', 'file', 'image', 'document', 'relationship', 'password'].includes(t)
  const canUnique = ['shortText', 'email', 'phone', 'website', 'number', 'autoId'].includes(t)

  return (
    <Modal open onClose={onClose} size="lg" title={isNew ? `New ${FIELD_TYPE_MAP[t].label.toLowerCase()} field` : `Edit field: ${field.label}`} description={FIELD_TYPE_MAP[t].hint}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{isNew ? 'Add field' : 'Save field'}</Button></>}>
      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <FormField label="Label" required error={errors.label}>
            <Input autoFocus value={f.label} onChange={(e) => set({ label: e.target.value, ...(nameTouched ? {} : { name: slug(e.target.value) }) })} />
          </FormField>
          <FormField label="API name" error={errors.name} hint="Used in formulas, e.g. {name}">
            <Input value={f.name} onChange={(e) => { setNameTouched(true); set({ name: slug(e.target.value) }) }} />
          </FormField>
          <FormField label="Placeholder"><Input value={f.placeholder ?? ''} onChange={(e) => set({ placeholder: e.target.value })} /></FormField>
          <FormField label="Group / section label" hint="Optional heading used to organise fields"><Input value={f.group ?? ''} onChange={(e) => set({ group: e.target.value || undefined })} /></FormField>
          <FormField label="Help text" className="sm:col-span-2"><Input value={f.description ?? ''} onChange={(e) => set({ description: e.target.value })} placeholder="Shown under the field" /></FormField>
          <FormField label="Width in forms">
            <Select value={f.width} onChange={(e) => set({ width: e.target.value as Field['width'] })}><option value="full">Full width</option><option value="half">Half</option><option value="third">One third</option></Select>
          </FormField>
          {canDefault && (
            <FormField label="Default value">
              {t === 'date' ? (
                <Select value={f.defaultValue === '{{today}}' ? 'today' : f.defaultValue ? 'fixed' : ''} onChange={(e) => set({ defaultValue: e.target.value === 'today' ? '{{today}}' : undefined })}><option value="">None</option><option value="today">Today</option></Select>
              ) : (
                <FieldInput field={{ ...f, readOnly: false, required: false }} value={f.defaultValue ?? ''} onChange={(v) => set({ defaultValue: v === '' ? undefined : v })} />
              )}
            </FormField>
          )}
        </section>

        <section className="flex flex-wrap gap-x-6 gap-y-2">
          {!['formula', 'autoId'].includes(t) && <Checkbox checked={!!f.required} onChange={(v) => set({ required: v })} label="Required" />}
          {canUnique && <Checkbox checked={!!f.unique} onChange={(v) => set({ unique: v })} label="Unique value" />}
          <Checkbox checked={!!f.readOnly} onChange={(v) => set({ readOnly: v })} label="Read-only in forms" disabled={t === 'formula' || t === 'autoId'} />
        </section>

        {(textual || numeric || t === 'rating') && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Validation</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              {numeric && <>
                <FormField label="Minimum value" error={errors.min}><Input type="number" value={f.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
                <FormField label="Maximum value"><Input type="number" value={f.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
              </>}
              {t === 'rating' && <FormField label="Number of stars"><Select value={f.max ?? 5} onChange={(e) => set({ max: Number(e.target.value) })}>{[3, 4, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>}
              {(t === 'shortText' || t === 'longText' || t === 'password') && <>
                <FormField label="Minimum length"><Input type="number" min={0} value={f.minLength ?? ''} onChange={(e) => set({ minLength: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
                <FormField label="Maximum length"><Input type="number" min={0} value={f.maxLength ?? ''} onChange={(e) => set({ maxLength: e.target.value === '' ? undefined : Number(e.target.value) })} /></FormField>
              </>}
              {textual && !['shortText', 'longText', 'password'].includes(t) && <p className="text-xs text-muted sm:col-span-2">{FIELD_TYPE_MAP[t].label} fields are validated automatically (format check).</p>}
            </div>
          </section>
        )}

        {t === 'currency' && <FormField label="Currency"><Select value={f.currency ?? 'USD'} onChange={(e) => set({ currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></FormField>}
        {t === 'autoId' && (
          <FormField label="ID prefix" hint="Records get IDs like PREFIX-0001, PREFIX-0002…"><Input value={f.idPrefix ?? ''} maxLength={8} onChange={(e) => set({ idPrefix: e.target.value.toUpperCase() })} /></FormField>
        )}
        {t === 'password' && <Notice tone="warning">Password fields are masked in the interface but stored as plain text in this browser. Don’t store real credentials.</Notice>}

        {isChoiceType(t) && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Options</h4>
            <div className="space-y-1.5">
              {(f.options ?? []).map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input type="color" aria-label="Option colour" value={/^#[0-9a-f]{6}$/i.test(o.color ?? '') ? o.color : '#7b68ee'} onChange={(e) => set({ options: f.options!.map((x) => (x.id === o.id ? { ...x, color: e.target.value } : x)) })} className="size-8 shrink-0 rounded" />
                  <Input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => set({ options: f.options!.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
                  <button type="button" aria-label="Move up" disabled={i === 0} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30" onClick={() => { const a = [...f.options!]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; set({ options: a }) }}><ArrowUp size={14} /></button>
                  <button type="button" aria-label="Move down" disabled={i === (f.options?.length ?? 0) - 1} className="rounded p-1.5 text-muted hover:bg-subtle disabled:opacity-30" onClick={() => { const a = [...f.options!]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; set({ options: a }) }}><ArrowDown size={14} /></button>
                  <button type="button" aria-label="Remove option" className="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger" onClick={() => set({ options: f.options!.filter((x) => x.id !== o.id) })}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
            {errors.options && <p className="mt-1 text-xs text-danger">{errors.options}</p>}
            <Button size="xs" variant="soft" className="mt-2" onClick={() => set({ options: [...(f.options ?? []), { id: uid('opt'), label: `Option ${(f.options?.length ?? 0) + 1}`, color: OPTION_COLORS[(f.options?.length ?? 0) % OPTION_COLORS.length] }] })}><Plus size={12} /> Add option</Button>
            <p className="mt-2 text-xs text-muted">Renaming an option keeps existing records linked to it.</p>
          </section>
        )}

        {t === 'formula' && (
          <section className="space-y-2">
            <FormField label="Formula" required error={errors.formula ?? formulaError ?? undefined} hint={FORMULA_HELP}>
              <Textarea value={f.formula ?? ''} onChange={(e) => set({ formula: e.target.value })} className="font-mono text-[13px]" placeholder="{quantity} * {unit_price}" spellCheck={false} />
            </FormField>
            <div className="flex flex-wrap gap-1.5">
              {others.filter((x) => x.type !== 'formula').map((x) => <button key={x.id} type="button" onClick={() => set({ formula: `${f.formula ?? ''}{${x.name}}` })} className="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-[11px] hover:bg-primary/10">{`{${x.name}}`}</button>)}
            </div>
            {!errors.formula && !formulaError && f.formula && <p className="text-xs text-success">Formula is valid. It is evaluated safely with a built-in parser (no code execution).</p>}
          </section>
        )}

        {t === 'relationship' && (
          <section className="grid gap-4 sm:grid-cols-2">
            <FormField label="Link to module" required error={errors.relation}>
              <Select value={f.relation?.moduleId ?? ''} onChange={(e) => set({ relation: { moduleId: e.target.value, cardinality: f.relation?.cardinality ?? 'many-to-one', lookupFieldId: undefined } })}>
                <option value="">Choose a module…</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === module.id ? ' (this module)' : ''}</option>)}
              </Select>
            </FormField>
            <FormField label="Relationship type">
              <Select value={f.relation?.cardinality ?? 'many-to-one'} onChange={(e) => set({ relation: { moduleId: f.relation?.moduleId ?? '', lookupFieldId: f.relation?.lookupFieldId, cardinality: e.target.value as NonNullable<Field['relation']>['cardinality'] } })}>
                <option value="many-to-one">Many to one — links one record (shared)</option>
                <option value="one-to-one">One to one — links one record (exclusive)</option>
                <option value="one-to-many">One to many — links several (each exclusive)</option>
                <option value="many-to-many">Many to many — links several (shared)</option>
              </Select>
            </FormField>
            <FormField label="Lookup field" hint="Show this field of the linked record in tables instead of its title" className="sm:col-span-2">
              <Select value={f.relation?.lookupFieldId ?? ''} onChange={(e) => f.relation && set({ relation: { ...f.relation, lookupFieldId: e.target.value || undefined } })} disabled={!targetModule}>
                <option value="">Record title</option>
                {targetModule?.fields.filter((x) => x.type !== 'relationship').map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </Select>
            </FormField>
          </section>
        )}

        <section>
          <h4 className="mb-2 text-sm font-semibold">Conditional visibility</h4>
          {others.length === 0 ? <p className="text-xs text-muted">Add other fields first to use conditions.</p> : (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
              <Select aria-label="Condition field" value={f.condition?.fieldId ?? ''} onChange={(e) => set({ condition: e.target.value ? { fieldId: e.target.value, op: f.condition?.op ?? 'equals', value: undefined } : undefined })}>
                <option value="">Always visible</option>
                {others.map((x) => <option key={x.id} value={x.id}>Show when {x.label}…</option>)}
              </Select>
              {f.condition && <Select aria-label="Condition operator" value={f.condition.op} onChange={(e) => set({ condition: { ...f.condition!, op: e.target.value as FilterOp } })}>{OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</Select>}
              {f.condition && condField && OPERATORS.find((o) => o.op === f.condition!.op)?.needsValue && <FilterValueInput field={condField} value={f.condition.value} onChange={(v) => set({ condition: { ...f.condition!, value: v } })} />}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-1 text-sm font-semibold">Field-level permissions</h4>
          <p className="mb-2 text-xs text-muted">Interface-level only (not a security boundary). Roles default to “edit”.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                {r.name}
                <Select aria-label={`Access for ${r.name}`} className="h-7 w-28 text-xs" value={f.permissions?.[r.id] ?? 'edit'} onChange={(e) => { const next = { ...(f.permissions ?? {}) }; if (e.target.value === 'edit') delete next[r.id]; else next[r.id] = e.target.value as FieldAccess; set({ permissions: Object.keys(next).length ? next : undefined }) }}>
                  <option value="edit">Can edit</option><option value="view">View only</option><option value="hidden">Hidden</option>
                </Select>
              </label>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
