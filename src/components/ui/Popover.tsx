import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '#/utils/id'
import { Icon } from './Icon'

interface PopoverProps {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
}

/** Portal-based popover that never gets clipped by overflow containers. */
export function Popover({ trigger, children, align = 'left', width, className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number }>({ top: 0, left: 0, maxH: 400 })

  const place = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const w = panel.current?.offsetWidth ?? width ?? 220
    const h = panel.current?.offsetHeight ?? 200
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const flip = below < Math.min(h, 260) && above > below
    const top = flip ? Math.max(8, r.top - Math.min(h, above) - 4) : r.bottom + 4
    setPos({ top, left, maxH: Math.max(160, flip ? above : below) })
  }, [align, width])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || ref.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onResize = () => place()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)
    const raf = requestAnimationFrame(place)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
      cancelAnimationFrame(raf)
    }
  }, [open, place])

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref })}
      {open &&
        createPortal(
          <div
            ref={panel}
            style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxH }}
            className={cn('pop-in scroll-thin fixed z-[90] overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl', className)}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  )
}

export interface MenuItem {
  label?: string
  icon?: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  checked?: boolean
  hint?: string
}

export function Menu({ items, trigger, align = 'right', width = 200 }: { items: MenuItem[]; trigger: PopoverProps['trigger']; align?: 'left' | 'right'; width?: number }) {
  return (
    <Popover trigger={trigger} align={align} width={width}>
      {(close) => (
        <div role="menu">
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  close()
                  it.onClick?.()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition hover:bg-subtle disabled:opacity-40',
                  it.danger ? 'text-danger hover:bg-danger/10' : 'text-fg',
                )}
              >
                {it.icon && <Icon name={it.icon} size={14} className={it.danger ? '' : 'text-muted'} />}
                <span className="flex-1 truncate">{it.label}</span>
                {it.hint && <span className="text-[11px] text-muted">{it.hint}</span>}
                {it.checked && <Icon name="Check" size={14} className="text-primary" />}
              </button>
            ),
          )}
        </div>
      )}
    </Popover>
  )
}
