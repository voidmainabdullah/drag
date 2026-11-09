import { useSettingsStore } from '#/stores/settingsStore'
import { useWorkspace } from '#/hooks/useData'
import { BLANK_TOOL_KEYS, DEFAULT_SECTIONS } from '#/services/navService'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { AppLink, usePathname } from './AppLink'

const TOOLS = DEFAULT_SECTIONS.flatMap((s) => s.items).filter((i) => BLANK_TOOL_KEYS.includes(i.key))

/**
 * An empty workspace has no default sidebar items on purpose. So the app stays navigable, this small
 * launcher (not part of the editable navigation) offers the few pages needed to start building.
 * It disappears as soon as the user adds a page to the sidebar themselves.
 */
export function BlankTools({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useWorkspace()
  const nav = useSettingsStore((s) => (ws ? s.settings.nav[ws.id] : undefined)) ?? []
  const pathname = usePathname()
  if (!ws?.blank || nav.some((i) => i.type === 'route')) return null
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Workspace tools</div>
      <div className="space-y-0.5">
        {TOOLS.map((t) => {
          const active = t.path === '/' ? pathname === '/' : pathname === t.path || pathname.startsWith(t.path + '/')
          return (
            <AppLink key={t.key} to={t.path} onClick={onNavigate} className={cn('flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition', active ? 'bg-primary/10 font-semibold text-primary' : 'text-fg/85 hover:bg-subtle')}>
              <Icon name={t.icon} size={16} className={active ? 'text-primary' : 'text-muted'} />
              <span className="truncate">{t.label}</span>
            </AppLink>
          )
        })}
      </div>
      <p className="mt-2 px-2 text-[11px] text-muted">This workspace starts empty. Use “Customise navigation” to add your own pages here.</p>
    </div>
  )
}
