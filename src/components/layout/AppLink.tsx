import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export function AppLink({ to, className, children, onClick, title }: { to: string; className?: string; children: ReactNode; onClick?: () => void; title?: string }) {
  return (
    <Link to={to as never} className={className} onClick={onClick} title={title}>
      {children}
    </Link>
  )
}

export function useGo() {
  const navigate = useNavigate()
  return (to: string) => void navigate({ to: to as never })
}

export function usePathname(): string {
  return useRouterState({ select: (s) => s.location.pathname })
}
