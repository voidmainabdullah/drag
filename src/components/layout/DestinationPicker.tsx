import { useId } from 'react'
import { DESTINATION_OPTIONS, type Destination, type DestinationMode } from '#/services/destination'
import { Field, Input } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'

/** Radio list used by New module, Module Builder and Template install: where should this go? */
export function DestinationPicker({ value, onChange, namePlaceholder = 'e.g. Acme Sales', workspaceName }: { value: Destination; onChange: (d: Destination) => void; namePlaceholder?: string; workspaceName?: string }) {
  const group = useId()
  const set = (mode: DestinationMode) => onChange({ ...value, mode })
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-[13px] font-medium">Where should it go?</legend>
      {DESTINATION_OPTIONS.map((o) => {
        const on = value.mode === o.id
        return (
          <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition', on ? 'border-primary bg-primary/5' : 'border-line hover:bg-subtle')}>
            <input type="radio" name={group} className="mt-1 size-4 accent-[var(--primary)]" checked={on} onChange={() => set(o.id)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium"><Icon name={o.icon} size={14} className="text-muted" />{o.label}{o.id === 'current' && workspaceName ? <span className="font-normal text-muted">· {workspaceName}</span> : null}</span>
              <span className="mt-0.5 block text-xs text-muted">{o.hint}</span>
              {o.id === 'new' && on && (
                <span className="mt-2 block">
                  <Field label="New workspace name" required>
                    <Input autoFocus value={value.workspaceName} onChange={(e) => onChange({ ...value, workspaceName: e.target.value })} placeholder={namePlaceholder} />
                  </Field>
                </span>
              )}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
