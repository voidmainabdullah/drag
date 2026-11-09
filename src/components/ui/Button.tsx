import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '#/utils/id'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gradient' | 'soft'
type Size = 'xs' | 'sm' | 'md'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:brightness-110 shadow-sm',
  gradient: 'gradient-brand text-white hover:brightness-110 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-fg',
  soft: 'bg-primary/10 text-primary hover:bg-primary/15',
  danger: 'bg-danger text-white hover:brightness-110',
}
const sizes: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs gap-1',
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: string
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ variant = 'secondary', size = 'sm', icon, iconRight, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'md' ? 16 : 14} />}
      {children}
      {iconRight}
    </button>
  )
})

export function IconButton({ icon, label, onClick, className, active, disabled, size = 16, danger }: { icon: string; label: string; onClick?: (e: React.MouseEvent) => void; className?: string; active?: boolean; disabled?: boolean; size?: number; danger?: boolean }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-subtle hover:text-fg disabled:opacity-40',
          active && 'bg-primary/10 text-primary',
          danger && 'hover:bg-danger/10 hover:text-danger',
          className,
        )}
      >
        <Icon name={icon} size={size} />
      </button>
    </Tooltip>
  )
}
