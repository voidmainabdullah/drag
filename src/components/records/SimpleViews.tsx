import { recordTitle, valueOf } from '#/utils/records'
import { Checkbox } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { FieldValue } from '#/components/fields/FieldValue'
import { Thumb } from '#/components/fields/FileInput'
import { cn } from '#/utils/id'
import type { FileMeta } from '#/types'
import type { ViewProps } from './viewTypes'

export function ListView({ module, records, ctx, fields, selected, onSelect, onOpen }: ViewProps) {
  const [, ...rest] = fields
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {records.map((r) => (
        <li key={r.id} onClick={() => onOpen(r.id)} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-primary/5', selected.has(r.id) && 'bg-primary/10')}>
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={selected.has(r.id)} onChange={(v) => { const n = new Set(selected); v ? n.add(r.id) : n.delete(r.id); onSelect(n) }} label={<span className="sr-only">Select</span>} />
          </span>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${module.color} 14%, transparent)`, color: module.color }}><Icon name={module.icon} size={15} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{recordTitle(module, r, ctx)}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {rest.slice(0, 4).map((f) => { const v = valueOf(module, r, f, ctx); return v === '' || v == null ? null : <span key={f.id} className="inline-flex items-center gap-1"><FieldValue field={f} value={v} ctx={ctx} compact /></span> })}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function CardView({ module, records, ctx, fields, onOpen }: ViewProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {records.map((r) => (
        <div key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer rounded-xl border border-line bg-surface p-4 transition hover:border-primary/40 hover:shadow-md">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${module.color} 14%, transparent)`, color: module.color }}><Icon name={module.icon} size={15} /></span>
            <h3 className="truncate text-sm font-semibold">{recordTitle(module, r, ctx)}</h3>
          </div>
          <dl className="space-y-1.5 text-[13px]">
            {fields.slice(1, 7).map((f) => {
              const v = valueOf(module, r, f, ctx)
              if (v === '' || v == null || (Array.isArray(v) && !v.length)) return null
              return <div key={f.id} className="flex gap-2"><dt className="w-24 shrink-0 truncate text-muted">{f.label}</dt><dd className="min-w-0 flex-1"><FieldValue field={f} value={v} ctx={ctx} compact /></dd></div>
            })}
          </dl>
        </div>
      ))}
    </div>
  )
}

export function GalleryView({ module, records, config, ctx, fields, onOpen }: ViewProps) {
  const img = module.fields.find((f) => f.id === config.imageFieldId) ?? module.fields.find((f) => f.type === 'image')
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {records.map((r) => {
        const files = img ? ((r.data[img.id] as FileMeta[] | undefined) ?? []) : []
        const sub = fields.find((f) => f.id !== img?.id && f.id !== fields[0]?.id)
        return (
          <div key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer overflow-hidden rounded-xl border border-line bg-surface transition hover:border-primary/40 hover:shadow-md">
            <div className="flex aspect-[4/3] items-center justify-center bg-subtle">
              {files[0] ? <Thumb file={files[0]} fill /> : <Icon name={module.icon} size={34} className="text-muted/40" />}
            </div>
            <div className="p-3">
              <div className="truncate text-sm font-semibold">{recordTitle(module, r, ctx)}</div>
              {sub && <div className="mt-1 truncate text-xs text-muted"><FieldValue field={sub} value={valueOf(module, r, sub, ctx)} ctx={ctx} compact /></div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
