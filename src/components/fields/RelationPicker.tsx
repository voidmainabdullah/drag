import { useMemo, useState } from 'react'
import { Link2, X } from 'lucide-react'
import type { Field } from '#/types'
import { useCtx, useModule, useRecords } from '#/hooks/useData'
import { recordTitle, searchRecords, toIds } from '#/utils/records'
import { isSingleRel } from '#/utils/fieldTypes'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { SearchInput } from '#/components/ui/controls'
import { Badge, EmptyState } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { useUiStore } from '#/stores/uiStore'

export function RelationPicker({ field, value, onChange, ownerModuleId, recordId, disabled }: { field: Field; value: unknown; onChange: (v: string | string[]) => void; ownerModuleId?: string; recordId?: string; disabled?: boolean }) {
  const target = useModule(field.relation?.moduleId)
  const targetRecords = useRecords(target?.id)
  const ownerRecords = useRecords(ownerModuleId)
  const ctx = useCtx()
  const showRecord = useUiStore((s) => s.showRecord)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const single = isSingleRel(field)
  const ids = toIds(value)
  const card = field.relation?.cardinality

  const taken = useMemo(() => {
    // one-to-one / one-to-many: a target can only belong to one source record
    if (card !== 'one-to-one' && card !== 'one-to-many') return new Set<string>()
    const set = new Set<string>()
    for (const r of ownerRecords) if (r.id !== recordId) toIds(r.data[field.id]).forEach((x) => set.add(x))
    return set
  }, [card, ownerRecords, recordId, field.id])

  if (!target) return <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">The related module no longer exists.</div>

  const list = searchRecords(target, targetRecords, q, ctx).filter((r) => !taken.has(r.id) || ids.includes(r.id))
  const toggle = (id: string) => {
    if (single) {
      onChange(ids[0] === id ? '' : id)
      setOpen(false)
    } else onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {ids.map((id) => {
          const rec = ctx.records.get(id)
          return (
            <span key={id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-subtle py-0.5 pr-1 pl-2 text-[13px]">
              <Icon name={target.icon} size={12} className="text-muted" />
              <button type="button" className="max-w-[180px] truncate hover:underline" onClick={() => rec && showRecord(target.id, id)}>
                {rec ? recordTitle(target, rec, ctx) : 'Deleted record'}
              </button>
              {!disabled && (
                <button type="button" aria-label="Unlink" className="rounded p-0.5 text-muted hover:text-danger" onClick={() => onChange(single ? '' : ids.filter((x) => x !== id))}>
                  <X size={12} />
                </button>
              )}
            </span>
          )
        })}
        {!disabled && (
          <Button size="xs" onClick={() => setOpen(true)}>
            <Link2 size={12} /> {ids.length ? (single ? 'Change' : 'Add link') : `Link ${target.name}`}
          </Button>
        )}
        {disabled && !ids.length && <span className="text-xs text-muted">—</span>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`Link ${target.name}`} description={card ? `Relationship: ${card.replace(/-/g, ' ')}` : undefined} footer={<Button variant="primary" onClick={() => setOpen(false)}>Done</Button>}>
        <SearchInput value={q} onChange={setQ} placeholder={`Search ${target.name.toLowerCase()}…`} className="mb-3" />
        {list.length === 0 ? (
          <EmptyState icon={target.icon} title={`No ${target.name.toLowerCase()} to link`} description={targetRecords.length ? 'Nothing matches your search, or the records are already linked elsewhere.' : `Create a record in ${target.name} first.`} />
        ) : (
          <ul className="space-y-1">
            {list.slice(0, 200).map((r) => {
              const on = ids.includes(r.id)
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => toggle(r.id)} className={cn('flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-subtle', on ? 'border-primary bg-primary/5' : 'border-line')}>
                    <span className={cn('flex size-4 items-center justify-center rounded-full border', on ? 'border-primary bg-primary text-white' : 'border-line')}>{on && <Icon name="Check" size={10} strokeWidth={3} />}</span>
                    <span className="flex-1 truncate">{recordTitle(target, r, ctx)}</span>
                    <Badge>{r.id.slice(-4).toUpperCase()}</Badge>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </div>
  )
}
