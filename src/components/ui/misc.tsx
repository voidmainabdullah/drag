import type { ReactNode } from 'react'
import { cn } from '#/utils/id'
import { Icon } from './Icon'

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium', !color && 'bg-subtle text-muted', className)}
      style={color ? { background: `color-mix(in srgb, ${color} 16%, transparent)`, color } : undefined}
    >
      {children}
    </span>
  )
}

export function Avatar({ name, color = '#7B68EE', size = 28 }: { name: string; color?: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?'
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: color, fontSize: size * 0.4 }} title={name}>
      {initials}
    </span>
  )
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('rounded-xl border border-line bg-surface', onClick && 'cursor-pointer transition hover:border-primary/40 hover:shadow-md', className)}>
      {children}
    </div>
  )
}

export function EmptyState({ icon = 'Inbox', title, description, action }: { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} />
}

export function PageSkeleton({ variant = 'cards' }: { variant?: 'cards' | 'table' | 'form' }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      {variant === 'cards' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-line bg-surface p-4">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      )}
      {variant === 'table' && (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}
      {variant === 'form' && (
        <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function PageHeader({ title, description, actions, icon }: { title: string; description?: string; actions?: ReactNode; icon?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon name={icon} size={20} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: string; icon?: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('scroll-thin flex gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition',
            value === t.id ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.icon && <Icon name={t.icon} size={14} />}
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-subtle px-1.5 text-[10px]">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition', value === o.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-primary/30 border-t-primary" style={{ width: size, height: size }} />
}

export function Notice({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: string }) {
  const tones = { info: 'bg-primary/8 text-fg border-primary/25', warning: 'bg-warning/10 border-warning/30 text-fg', danger: 'bg-danger/10 border-danger/30 text-fg', success: 'bg-success/10 border-success/30 text-fg' }
  const ic = icon ?? { info: 'Info', warning: 'AlertTriangle', danger: 'AlertTriangle', success: 'BadgeCheck' }[tone]
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]', tones[tone])}>
      <Icon name={ic} size={15} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
