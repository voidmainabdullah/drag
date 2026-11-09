import { useMemo, useState, type ReactNode } from 'react'
import { Controller, useForm, type FieldErrors, type Resolver } from 'react-hook-form'
import type { CrmRecord, Field, FormSection, Module } from '#/types'
import { defaultValueFor } from '#/utils/fieldTypes'
import { displayValue, makeCtx, valueOf } from '#/utils/records'
import { isFieldVisible, validateRecordData } from '#/utils/validation'
import { useRecordStore } from '#/stores/recordStore'
import { useUserStore } from '#/stores/userStore'
import { useModuleStore } from '#/stores/moduleStore'
import { usePerms } from '#/hooks/useData'
import { Button } from '#/components/ui/Button'
import { cn, uid } from '#/utils/id'
import { FieldInput } from './FieldInput'

export interface FormRendererProps {
  module: Module
  sections?: FormSection[]
  initial?: Record<string, unknown>
  recordId?: string
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>
  onCancel?: () => void
  submitLabel?: string
  roleAccess?: boolean
  accent?: string
  radius?: number
  footerExtra?: ReactNode
  /** show explicit "can't submit" notice */
  disabled?: boolean
}

export function FormRenderer({ module, sections, initial, recordId, onSubmit, onCancel, submitLabel = 'Save', roleAccess = true, accent, radius, footerExtra, disabled }: FormRendererProps) {
  const perms = usePerms()
  const [submitting, setSubmitting] = useState(false)

  const secs: FormSection[] = useMemo(() => {
    if (sections?.length) return sections
    const editable = module.fields.filter((f) => f.type !== 'formula' && f.type !== 'autoId')
    return [{ id: uid('sec'), title: '', columns: 2, items: editable.map((f) => ({ fieldId: f.id })) }]
  }, [sections, module.fields])

  const fieldById = useMemo(() => new Map(module.fields.map((f) => [f.id, f])), [module.fields])
  const accessible = (f: Field) => !roleAccess || perms.fieldAccess(f) !== 'hidden'
  const inForm = useMemo(() => {
    const ids = new Set<string>()
    secs.forEach((s) => s.items.forEach((i) => ids.add(i.fieldId)))
    return module.fields.filter((f) => ids.has(f.id))
  }, [secs, module.fields])

  const defaults = useMemo(() => {
    const d: Record<string, unknown> = {}
    for (const f of module.fields) d[f.id] = initial && initial[f.id] !== undefined ? initial[f.id] : defaultValueFor(f)
    return d
  }, [module.fields, initial])

  const resolver: Resolver<Record<string, unknown>> = async (values) => {
    const fields = inForm.filter((f) => accessible(f) && !(roleAccess && perms.fieldAccess(f) === 'view'))
    const errs = validateRecordData(module, values, { existing: useRecordStore.getState().records, selfId: recordId, fields })
    if (!Object.keys(errs).length) return { values, errors: {} }
    const errors: FieldErrors<Record<string, unknown>> = {}
    for (const [k, message] of Object.entries(errs)) (errors as Record<string, unknown>)[k] = { type: 'validate', message }
    return { values: {}, errors }
  }

  const { control, handleSubmit, watch, formState } = useForm<Record<string, unknown>>({ defaultValues: defaults, resolver, mode: 'onSubmit', reValidateMode: 'onChange' })
  const values = watch()

  const submit = handleSubmit(async (data) => {
    const out: Record<string, unknown> = {}
    for (const f of inForm) {
      if (!accessible(f) || (roleAccess && perms.fieldAccess(f) === 'view')) continue
      if (f.type === 'formula' || f.type === 'autoId') continue
      if (!isFieldVisible(module, f, data)) {
        out[f.id] = defaultValueFor({ ...f, defaultValue: undefined })
        continue
      }
      out[f.id] = data[f.id]
    }
    setSubmitting(true)
    try {
      await onSubmit(out)
    } finally {
      setSubmitting(false)
    }
  })

  const ctx = useMemo(() => makeCtx(useModuleStore.getState().modules, useRecordStore.getState().records, useUserStore.getState().users), [])
  const tmpRecord = { id: recordId ?? 'tmp', data: values } as unknown as CrmRecord
  const style = accent ? ({ ['--primary' as string]: accent } as React.CSSProperties) : undefined

  return (
    <form onSubmit={submit} noValidate style={style} className="space-y-6">
      {secs.map((s) => {
        const items = s.items.map((i) => fieldById.get(i.fieldId)).filter((f): f is Field => !!f && accessible(f) && isFieldVisible(module, f, values))
        if (!items.length) return null
        const cols = s.columns
        return (
          <section key={s.id} className="space-y-3">
            {(s.title || s.description) && (
              <div className="border-b border-line pb-1.5">
                {s.title && <h3 className="text-sm font-semibold">{s.title}</h3>}
                {s.description && <p className="text-xs text-muted">{s.description}</p>}
              </div>
            )}
            <div className={cn('grid gap-x-4 gap-y-4 grid-cols-1', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3')}>
              {items.map((f) => {
                const span = f.width === 'full' || cols === 1 ? cols : 1
                const view = roleAccess && perms.fieldAccess(f) === 'view'
                const err = formState.errors[f.id]?.message as string | undefined
                return (
                  <div key={f.id} className={cn('space-y-1.5', span === 2 && 'sm:col-span-2', span === 3 && 'sm:col-span-3')}>
                    <label className="block text-[13px] font-medium">
                      {f.label}
                      {f.required && <span className="ml-0.5 text-danger">*</span>}
                      {view && <span className="ml-1.5 text-[11px] font-normal text-muted">(read only)</span>}
                    </label>
                    {f.type === 'formula' ? (
                      <div className="rounded-lg border border-dashed border-line bg-subtle px-3 py-2 text-sm">{displayValue(f, valueOf(module, tmpRecord, f, ctx), ctx) || <span className="text-muted">—</span>}</div>
                    ) : (
                      <Controller control={control} name={f.id} render={({ field: rhf }) => <FieldInput field={f} value={rhf.value} onChange={rhf.onChange} disabled={view || disabled} ownerModuleId={module.id} recordId={recordId} invalid={!!err} />} />
                    )}
                    {f.description && !err && <p className="text-xs text-muted">{f.description}</p>}
                    {err && <p className="text-xs text-danger" role="alert">{err}</p>}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      {Object.keys(formState.errors).length > 0 && <p className="text-xs text-danger" role="alert">Please fix the highlighted fields.</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {footerExtra}
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" size="md" disabled={submitting || disabled} style={radius !== undefined ? { borderRadius: radius } : undefined}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
