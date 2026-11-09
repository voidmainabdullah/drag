import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useUiStore } from '#/stores/uiStore'
import { Modal } from './Modal'
import { Button } from './Button'
import { Input } from './controls'
import { Icon, PICKER_ICONS } from './Icon'
import { Popover } from './Popover'
import { cn } from '#/utils/id'
import { OPTION_COLORS } from '#/utils/fieldTypes'

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)
  if (typeof document === 'undefined') return null
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle }
  const tone = { success: 'text-success', error: 'text-danger', info: 'text-primary', warning: 'text-warning' }
  return createPortal(
    <div className="pointer-events-none fixed right-4 bottom-4 z-[120] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const I = icon[t.kind]
        return (
          <div key={t.id} className="pointer-events-auto pop-in flex items-start gap-3 rounded-xl border border-line bg-surface p-3 shadow-xl">
            <I size={18} className={cn('mt-0.5 shrink-0', tone[t.kind])} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{t.title}</div>
              {t.message && <div className="mt-0.5 text-xs break-words text-muted">{t.message}</div>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-fg">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

export function ConfirmHost() {
  const c = useUiStore((s) => s.confirmState)
  const close = useUiStore((s) => s.closeConfirm)
  const [typed, setTyped] = useState('')
  useEffect(() => setTyped(''), [c])
  if (!c) return null
  const blocked = !!c.requireText && typed.trim() !== c.requireText
  return (
    <Modal
      open
      onClose={() => close(false)}
      title={c.title}
      size="sm"
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={c.danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => close(true)}>
            {c.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {c.message && <p className="text-sm text-muted">{c.message}</p>}
      {c.requireText && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[13px]">
            Type <strong>{c.requireText}</strong> to confirm.
          </p>
          <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
    </Modal>
  )
}

export function NameDialog({ open, title, label, initial = '', confirmLabel = 'Save', onClose, onSubmit, description }: { open: boolean; title: string; label: string; initial?: string; confirmLabel?: string; description?: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial)
  useEffect(() => {
    if (open) setV(initial)
  }, [open, initial])
  const submit = () => {
    if (!v.trim()) return
    onSubmit(v.trim())
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!v.trim()} onClick={submit}>{confirmLabel}</Button></>}>
      <label className="mb-1.5 block text-[13px] font-medium">{label}</label>
      <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
    </Modal>
  )
}

export function IconPicker({ value, onChange, color }: { value: string; onChange: (v: string) => void; color?: string }) {
  return (
    <Popover
      width={300}
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" onClick={toggle} aria-label="Choose icon" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-subtle">
          <span className="flex size-6 items-center justify-center rounded-md" style={{ background: color ? `color-mix(in srgb, ${color} 18%, transparent)` : undefined, color }}>
            <Icon name={value} size={15} />
          </span>
          <span className="text-muted">Icon</span>
        </button>
      )}
    >
      {(close) => (
        <div className="grid grid-cols-8 gap-1 p-1">
          {PICKER_ICONS.map((n) => (
            <button
              key={n}
              type="button"
              title={n}
              aria-label={n}
              onClick={() => {
                onChange(n)
                close()
              }}
              className={cn('flex size-8 items-center justify-center rounded-lg text-muted hover:bg-subtle hover:text-fg', value === n && 'bg-primary/10 text-primary')}
            >
              <Icon name={n} size={16} />
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPTION_COLORS.map((c) => (
        <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => onChange(c)} className={cn('size-6 rounded-full border-2 border-transparent', value.toLowerCase() === c.toLowerCase() && 'border-fg')} style={{ background: c }} />
      ))}
      <input type="color" aria-label="Custom colour" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#7b68ee'} onChange={(e) => onChange(e.target.value)} className="size-7 rounded" />
    </div>
  )
}
