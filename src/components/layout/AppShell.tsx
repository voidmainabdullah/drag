import { useEffect, useState, type ReactNode } from 'react'
import { PanelLeftClose, Pencil, X } from 'lucide-react'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUiStore } from '#/stores/uiStore'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { initApp } from '#/stores'
import { useHydrated } from '#/hooks/useData'
import { Toasts, ConfirmHost } from '#/components/ui/Overlays'
import { Skeleton } from '#/components/ui/misc'
import { Button } from '#/components/ui/Button'
import { RecordDrawer } from '#/components/records/RecordDrawer'
import { NewRecordModal } from '#/components/records/NewRecordModal'
import { cn } from '#/utils/id'
import { NavTree } from './NavTree'
import { BlankTools } from './BlankTools'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { AppLink } from './AppLink'

export function ThemeApplier() {
  const brand = useSettingsStore((s) => s.settings.brand)
  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('dark', brand.theme === 'dark')
    el.style.setProperty('--primary', brand.primary)
    el.style.setProperty('--accent', brand.accent)
    el.dataset.density = brand.density
  }, [brand])
  return null
}

/** Boots stores from localStorage on the client; SSR renders only the skeleton. */
export function AppBoot({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const hydrated = useHydrated()
  const ready = useWorkspaceStore((s) => s.ready)
  useEffect(() => {
    if (hydrated) initApp()
  }, [hydrated])
  return (
    <>
      <ThemeApplier />
      {hydrated && ready ? children : (fallback ?? <ShellSkeleton />)}
      {hydrated && <Toasts />}
      {hydrated && <ConfirmHost />}
    </>
  )
}

export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-app" aria-busy="true" aria-label="Loading Xcrm">
      <aside className="hidden w-64 shrink-0 space-y-3 border-r border-line bg-side p-4 lg:block">
        <Skeleton className="h-8 w-32" />
        {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
      </aside>
      <div className="flex-1">
        <div className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4"><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-72" /></div>
        <div className="space-y-4 p-6"><Skeleton className="h-7 w-56" /><div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-64" /></div>
      </div>
    </div>
  )
}

function Brand() {
  const brand = useSettingsStore((s) => s.settings.brand)
  return (
    <AppLink to="/" className="flex items-center gap-2.5">
      {brand.logo ? (
        <img src={brand.logo} alt={brand.brandName} className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="gradient-brand flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white shadow-sm">{brand.brandName.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="text-[17px] font-bold tracking-tight">{brand.brandName}</span>
    </AppLink>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const mobileOpen = useUiStore((s) => s.mobileNavOpen)
  const setMobile = useUiStore((s) => s.setMobileNav)
  const editing = useUiStore((s) => s.navEditing)
  const setEditing = useUiStore((s) => s.setNavEditing)
  const [desktopHidden, setDesktopHidden] = useState(false)

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Brand />
        {mobile && <button type="button" aria-label="Close menu" onClick={() => setMobile(false)} className="rounded-lg p-1.5 text-muted hover:bg-subtle"><X size={16} /></button>}
        {!mobile && <button type="button" aria-label="Hide sidebar" onClick={() => setDesktopHidden(true)} className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg"><PanelLeftClose size={16} /></button>}
      </div>
      <nav aria-label="Main navigation" className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <NavTree editing={editing} onNavigate={mobile ? () => setMobile(false) : undefined} />
        <BlankTools onNavigate={mobile ? () => setMobile(false) : undefined} />
      </nav>
      <div className="shrink-0 border-t border-line p-3">
        <Button size="sm" variant={editing ? 'primary' : 'ghost'} className="w-full justify-start" onClick={() => setEditing(!editing)}>
          <Pencil size={14} /> {editing ? 'Done customising' : 'Customise navigation'}
        </Button>
        {editing && <p className="mt-2 px-1 text-[11px] text-muted">Drag to reorder, use ⋯ to rename, hide, move or remove. Hidden items are dimmed.</p>}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-app">
      <aside className={cn('no-print sticky top-0 hidden h-screen w-[264px] shrink-0 border-r border-line bg-side lg:block', desktopHidden && 'lg:hidden')}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <aside className="slide-in-left absolute inset-y-0 left-0 w-[280px] max-w-[85vw] border-r border-line bg-side shadow-2xl">{sidebar(true)}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onToggleSidebar={() => {
            if (window.matchMedia('(min-width: 1024px)').matches) setDesktopHidden((v) => !v)
            else setMobile(!mobileOpen)
          }}
        />
        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
      <CommandPalette />
      <RecordDrawer />
      <NewRecordModal />
    </div>
  )
}
