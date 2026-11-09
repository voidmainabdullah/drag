import { Check, Minus, Star } from 'lucide-react'
import type { CrmRecord, Field, FileMeta, Module } from '#/types'
import { displayValue, recordTitle, toIds, valueOf, type Ctx } from '#/utils/records'
import { isEmpty } from '#/utils/fieldTypes'
import { Badge, Avatar } from '#/components/ui/misc'
import { useUiStore } from '#/stores/uiStore'
import { Thumb } from './FileInput'
import { openStoredFile } from '#/hooks/useFileUrl'

export function FieldValue({ field, value, ctx, compact }: { field: Field; value: unknown; ctx: Ctx; compact?: boolean }) {
  const showRecord = useUiStore((s) => s.showRecord)
  if (isEmpty(value) && value !== false && value !== 0) return <span className="text-muted/60">—</span>
  switch (field.type) {
    case 'dropdown':
    case 'radio': {
      const o = field.options?.find((x) => x.id === value)
      return <Badge color={o?.color ?? '#64748B'}>{o?.label ?? String(value)}</Badge>
    }
    case 'multiSelect':
    case 'checkboxes':
      return (
        <span className="flex flex-wrap gap-1">
          {toIds(value).map((id) => {
            const o = field.options?.find((x) => x.id === id)
            return (
              <Badge key={id} color={o?.color ?? '#64748B'}>
                {o?.label ?? id}
              </Badge>
            )
          })}
        </span>
      )
    case 'tags':
      return (
        <span className="flex flex-wrap gap-1">
          {toIds(value).map((t) => (
            <Badge key={t} color="#7B68EE">
              {t}
            </Badge>
          ))}
        </span>
      )
    case 'yesNo':
      return value ? <Check size={15} className="text-success" aria-label="Yes" /> : <Minus size={15} className="text-muted" aria-label="No" />
    case 'rating':
      return (
        <span className="inline-flex" aria-label={`${value} stars`}>
          {Array.from({ length: Number(value) || 0 }).map((_, i) => (
            <Star key={i} size={13} className="fill-warning text-warning" />
          ))}
        </span>
      )
    case 'email':
      return (
        <a href={`mailto:${value}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
          {String(value)}
        </a>
      )
    case 'phone':
      return (
        <a href={`tel:${value}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
          {String(value)}
        </a>
      )
    case 'website': {
      const href = /^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`
      return (
        <a href={href} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="text-primary hover:underline">
          {String(value)}
        </a>
      )
    }
    case 'color':
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-4 rounded border border-line" style={{ background: String(value) }} />
          {String(value)}
        </span>
      )
    case 'user': {
      const u = ctx.users.get(String(value))
      return u ? (
        <span className="inline-flex items-center gap-1.5">
          <Avatar name={u.name} color={u.color} size={20} />
          {u.name}
        </span>
      ) : (
        <span className="text-muted">Unknown user</span>
      )
    }
    case 'signature':
      return <img src={String(value)} alt="Signature" className="h-8 rounded border border-line bg-white" />
    case 'file':
    case 'image':
    case 'document': {
      const files = (Array.isArray(value) ? value : []) as FileMeta[]
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          {files.slice(0, compact ? 2 : 10).map((f) =>
            field.type === 'image' ? (
              <button type="button" key={f.id} onClick={(e) => { e.stopPropagation(); void openStoredFile(f.id, f.name) }} title={f.name}>
                <Thumb file={f} size={compact ? 24 : 40} />
              </button>
            ) : (
              <button type="button" key={f.id} onClick={(e) => { e.stopPropagation(); void openStoredFile(f.id, f.name, true) }} className="max-w-[160px] truncate rounded-md bg-subtle px-1.5 py-0.5 text-xs text-primary hover:underline">
                {f.name}
              </button>
            ),
          )}
          {files.length > (compact ? 2 : 10) && <span className="text-xs text-muted">+{files.length - (compact ? 2 : 10)}</span>}
        </span>
      )
    }
    case 'relationship': {
      const target = field.relation ? ctx.modules.get(field.relation.moduleId) : undefined
      const lookup = target && field.relation?.lookupFieldId ? target.fields.find((f) => f.id === field.relation!.lookupFieldId) : undefined
      return (
        <span className="flex flex-wrap gap-1">
          {toIds(value).map((id) => {
            const rec = ctx.records.get(id)
            if (!rec || !target) return <Badge key={id}>Deleted record</Badge>
            const label = lookup ? displayValue(lookup, valueOf(target, rec, lookup, ctx), ctx) || recordTitle(target, rec, ctx) : recordTitle(target, rec, ctx)
            return (
              <button type="button" key={id} onClick={(e) => { e.stopPropagation(); showRecord(target.id, id) }} className="max-w-[200px] truncate rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20">
                {label}
              </button>
            )
          })}
        </span>
      )
    }
    case 'password':
      return <span className="tracking-widest">••••••••</span>
    case 'longText':
      return <span className={compact ? 'line-clamp-1' : 'whitespace-pre-wrap'}>{String(value)}</span>
    default:
      return <span className={compact ? 'truncate' : ''}>{displayValue(field, value, ctx)}</span>
  }
}

export function RecordFieldValue({ module, record, field, ctx, compact }: { module: Module; record: CrmRecord; field: Field; ctx: Ctx; compact?: boolean }) {
  return <FieldValue field={field} value={valueOf(module, record, field, ctx)} ctx={ctx} compact={compact} />
}
