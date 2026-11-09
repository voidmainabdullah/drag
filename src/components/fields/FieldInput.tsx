import { useState } from 'react'
import { Star, X } from 'lucide-react'
import type { Field, FileMeta } from '#/types'
import { Input, Select, Switch, Textarea, Checkbox } from '#/components/ui/controls'
import { useUsers } from '#/hooks/useData'
import { cn } from '#/utils/id'
import { SignaturePad } from './SignaturePad'
import { FileInput } from './FileInput'
import { RelationPicker } from './RelationPicker'

const toLocalDt = (iso: unknown): string => {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function TagInput({ value, onChange, disabled, placeholder }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          {t}
          {!disabled && (
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              <X size={11} />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          aria-label="Add tag"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={add}
          placeholder={value.length ? '' : (placeholder ?? 'Type and press Enter')}
          className="min-w-[100px] flex-1 bg-transparent text-sm outline-none"
        />
      )}
    </div>
  )
}

export interface FieldInputProps {
  field: Field
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
  ownerModuleId?: string
  recordId?: string
  invalid?: boolean
}

export function FieldInput({ field, value, onChange, disabled, ownerModuleId, recordId, invalid }: FieldInputProps) {
  const users = useUsers()
  const ro = disabled || field.readOnly
  const ph = field.placeholder
  const bad = invalid ? 'border-danger' : ''
  switch (field.type) {
    case 'shortText':
      return <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={ro} maxLength={field.maxLength} className={bad} />
    case 'password':
      return <Input type="password" autoComplete="new-password" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={ro} className={bad} />
    case 'email':
      return <Input type="email" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph ?? 'name@example.com'} disabled={ro} className={bad} />
    case 'phone':
      return <Input type="tel" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph ?? '+1 555 123 4567'} disabled={ro} className={bad} />
    case 'website':
      return <Input type="url" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph ?? 'https://'} disabled={ro} className={bad} />
    case 'longText':
      return <Textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={ph} disabled={ro} maxLength={field.maxLength} className={bad} />
    case 'number':
    case 'currency':
    case 'percentage':
      return (
        <div className="relative">
          {field.type === 'currency' && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs text-muted">{field.currency ?? 'USD'}</span>}
          <Input
            type="number"
            step="any"
            min={field.min}
            max={field.max}
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder={ph}
            disabled={ro}
            className={cn(bad, field.type === 'currency' && 'pl-12', field.type === 'percentage' && 'pr-8')}
          />
          {field.type === 'percentage' && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">%</span>}
        </div>
      )
    case 'rating': {
      const max = field.max ?? 5
      const n = Number(value) || 0
      return (
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label={field.label}>
          {Array.from({ length: max }).map((_, i) => (
            <button key={i} type="button" disabled={ro} aria-label={`${i + 1} star`} onClick={() => onChange(n === i + 1 ? '' : i + 1)} className="p-0.5 disabled:cursor-default">
              <Star size={20} className={i < n ? 'fill-warning text-warning' : 'text-line'} />
            </button>
          ))}
        </div>
      )
    }
    case 'date':
      return <Input type="date" value={String(value ?? '').slice(0, 10)} onChange={(e) => onChange(e.target.value)} disabled={ro} className={bad} />
    case 'datetime':
      return <Input type="datetime-local" value={toLocalDt(value)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : '')} disabled={ro} className={bad} />
    case 'time':
      return <Input type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={ro} className={bad} />
    case 'dropdown':
      return (
        <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={ro} className={bad}>
          <option value="">{ph ?? 'Select…'}</option>
          {field.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      )
    case 'radio':
      return (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="radiogroup">
          {field.options?.map((o) => (
            <label key={o.id} className="inline-flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="radio" disabled={ro} checked={value === o.id} onChange={() => onChange(o.id)} name={field.id} className="accent-[var(--primary)]" />
              {o.label}
            </label>
          ))}
        </div>
      )
    case 'multiSelect':
    case 'checkboxes': {
      const arr = Array.isArray(value) ? (value as string[]) : []
      const toggle = (id: string) => onChange(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])
      if (field.type === 'checkboxes')
        return (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {field.options?.map((o) => (
              <Checkbox key={o.id} checked={arr.includes(o.id)} onChange={() => toggle(o.id)} label={o.label} disabled={ro} />
            ))}
          </div>
        )
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = arr.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                disabled={ro}
                aria-pressed={on}
                onClick={() => toggle(o.id)}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-transparent text-white' : 'border-line text-muted hover:bg-subtle')}
                style={on ? { background: o.color ?? 'var(--primary)' } : undefined}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    case 'yesNo':
      return <Switch checked={!!value} onChange={onChange} disabled={ro} label={value ? 'Yes' : 'No'} />
    case 'tags':
      return <TagInput value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} disabled={ro} placeholder={ph} />
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input type="color" aria-label="Pick colour" disabled={ro} value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#7b68ee'} onChange={(e) => onChange(e.target.value)} className="size-9 rounded-lg" />
          <Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="#7B68EE" disabled={ro} className={cn('max-w-[140px]', bad)} />
        </div>
      )
    case 'address': {
      const a = (value && typeof value === 'object' ? value : {}) as Record<string, string>
      const set = (k: string, v: string) => onChange({ street: '', city: '', state: '', zip: '', country: '', ...a, [k]: v })
      return (
        <div className="grid grid-cols-6 gap-2">
          <Input className="col-span-6" placeholder="Street address" value={a.street ?? ''} onChange={(e) => set('street', e.target.value)} disabled={ro} />
          <Input className="col-span-3" placeholder="City" value={a.city ?? ''} onChange={(e) => set('city', e.target.value)} disabled={ro} />
          <Input className="col-span-3" placeholder="State / region" value={a.state ?? ''} onChange={(e) => set('state', e.target.value)} disabled={ro} />
          <Input className="col-span-2" placeholder="ZIP" value={a.zip ?? ''} onChange={(e) => set('zip', e.target.value)} disabled={ro} />
          <Input className="col-span-4" placeholder="Country" value={a.country ?? ''} onChange={(e) => set('country', e.target.value)} disabled={ro} />
        </div>
      )
    }
    case 'file':
    case 'image':
    case 'document':
      return <FileInput type={field.type} value={(Array.isArray(value) ? value : []) as FileMeta[]} onChange={onChange} disabled={ro} />
    case 'signature':
      return <SignaturePad value={typeof value === 'string' ? value : ''} onChange={onChange} disabled={ro} />
    case 'user':
      return (
        <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={ro} className={bad}>
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      )
    case 'relationship':
      return <RelationPicker field={field} value={value} onChange={onChange} ownerModuleId={ownerModuleId} recordId={recordId} disabled={ro} />
    case 'formula':
      return <div className="rounded-lg border border-dashed border-line bg-subtle px-3 py-2 text-xs text-muted">Calculated automatically from other fields</div>
    case 'autoId':
      return <div className="rounded-lg border border-dashed border-line bg-subtle px-3 py-2 text-xs text-muted">{value ? String(value) : 'Generated automatically when saved'}</div>
  }
}
