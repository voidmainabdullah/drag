import { useState } from 'react'
import { Check, ChevronsUpDown, LogOut, CloudCheck, CloudOff, Command as CommandIcon, Menu as MenuIcon, Moon, Plus, Search, Sun } from 'lucide-react'
import { format } from 'date-fns'
import { useCurrentUser, useModules, usePerms, useRoles, useWorkspace } from '#/hooks/useData'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUserStore } from '#/stores/userStore'
import { useUiStore } from '#/stores/uiStore'
import { useSaveStatus } from '#/stores'
import { Icon } from '#/components/ui/Icon'
import { Menu, Popover } from '#/components/ui/Popover'
import { Avatar } from '#/components/ui/misc'
import { signOut, useAuthStore } from '#/genius/auth/authStore'
import { Tooltip } from '#/components/ui/Tooltip'
import { cn } from '#/utils/id'
import { useGo } from './AppLink'
import { WorkspaceDialog } from './WorkspaceDialog'

export function Topbar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const ws = useWorkspace()
  const authEmail = useAuthStore((s) => s.email)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const setCurrent = useWorkspaceStore((s) => s.setCurrent)
  const theme = useSettingsStore((s) => s.settings.brand.theme)
  const setBrand = useSettingsStore((s) => s.setBrand)
  const setCommandOpen = useUiStore((s) => s.setCommandOpen)
  const startNewRecord = useUiStore((s) => s.startNewRecord)
  const user = useCurrentUser()
  const users = useUserStore((s) => s.users)
  const roles = useRoles()
  const updateUser = useUserStore((s) => s.updateUser)
  const setCurrentUser = useSettingsStore((s) => s.setCurrentUser)
  const modules = useModules()
  const perms = usePerms()
  const save = useSaveStatus()
  const go = useGo()
  const [newWs, setNewWs] = useState(false)
  const role = roles.find((r) => r.id === user?.roleId)

  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur sm:px-4">
      <button type="button" aria-label="Toggle sidebar" onClick={onToggleSidebar} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg">
        <MenuIcon size={18} />
      </button>

      <Popover
        width={280}
        trigger={({ toggle, ref }) => (
          <button ref={ref} type="button" onClick={toggle} aria-label="Switch workspace" className="flex max-w-[200px] items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm font-medium hover:bg-subtle">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-white" style={{ background: ws?.color ?? '#7B68EE' }}>
              <Icon name={ws?.icon} size={14} />
            </span>
            <span className="hidden truncate sm:inline">{ws?.name ?? 'Workspace'}</span>
            <ChevronsUpDown size={14} className="shrink-0 text-muted" />
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Workspaces</div>
            {workspaces.map((w) => (
              <button key={w.id} type="button" onClick={() => { setCurrent(w.id); close(); go('/') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-subtle">
                <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: w.color }}><Icon name={w.icon} size={14} /></span>
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === ws?.id && <Check size={14} className="text-primary" />}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <button type="button" onClick={() => { close(); setNewWs(true) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-subtle"><Plus size={14} className="text-muted" /> New workspace</button>
            <button type="button" onClick={() => { close(); go('/workspace') }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-subtle"><Icon name="Settings" size={14} className="text-muted" /> Manage workspaces</button>
          </div>
        )}
      </Popover>

      <button type="button" onClick={() => setCommandOpen(true)} className="mx-1 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-subtle/60 px-3 text-left text-sm text-muted transition hover:bg-subtle sm:max-w-md" aria-label="Search">
        <Search size={15} />
        <span className="flex-1 truncate">Search modules, records, pages…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium sm:flex"><CommandIcon size={10} />K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <span className={cn('hidden items-center gap-1 px-2 text-xs md:flex', save.failed ? 'text-danger' : 'text-muted')} aria-live="polite">
          {save.failed ? <CloudOff size={14} /> : <CloudCheck size={14} />}
          {save.failed ? 'Not saved' : save.pending ? 'Saving…' : save.savedAt ? `Saved ${format(save.savedAt, 'HH:mm:ss')}` : 'Autosave on'}
        </span>

        <Menu
          width={230}
          items={[
            ...modules.slice(0, 8).map((m) => ({ label: `New ${m.name.replace(/s$/, '').toLowerCase()}`, icon: m.icon, disabled: !perms.canModule(m, 'create'), onClick: () => startNewRecord(m.id) })),
            { divider: true },
            { label: 'New module', icon: 'Box', disabled: !perms.can('manageFields'), onClick: () => go('/module-builder') },
            { label: 'Install template', icon: 'LayoutTemplate', onClick: () => go('/templates') },
          ]}
          trigger={({ toggle, ref }) => (
            <button ref={ref} type="button" onClick={toggle} className="gradient-brand flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-white shadow-sm hover:brightness-110">
              <Plus size={16} /> <span className="hidden sm:inline">New</span>
            </button>
          )}
        />

        <Tooltip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <button type="button" aria-label="Toggle theme" onClick={() => setBrand({ theme: theme === 'dark' ? 'light' : 'dark' })} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg">
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </Tooltip>

        <Popover
          align="right"
          width={270}
          trigger={({ toggle, ref }) => (
            <button ref={ref} type="button" onClick={toggle} aria-label="Account and role" className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-subtle">
              <Avatar name={user?.name ?? '?'} color={user?.color} size={30} />
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-[13px] font-medium">{user?.name}</span>
                <span className="block text-[11px] text-muted">{role?.name}</span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <div>
              <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Acting as</div>
              {users.map((u) => (
                <button key={u.id} type="button" onClick={() => { setCurrentUser(u.id); close() }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-subtle">
                  <Avatar name={u.name} color={u.color} size={22} />
                  <span className="flex-1 truncate">{u.name}</span>
                  <span className="text-[11px] text-muted">{roles.find((r) => r.id === u.roleId)?.name}</span>
                  {u.id === user?.id && <Check size={14} className="text-primary" />}
                </button>
              ))}
              <div className="my-1 h-px bg-line" />
              <div className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Role for {user?.name}</div>
              {roles.map((r) => (
                <button key={r.id} type="button" onClick={() => { if (user) updateUser(user.id, { roleId: r.id }); close() }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-subtle">
                  <span className="flex-1">{r.name}</span>
                  {r.id === user?.roleId && <Check size={14} className="text-primary" />}
                </button>
              ))}
              <p className="mt-1 rounded-lg bg-warning/10 px-2.5 py-2 text-[11px] text-muted">Roles are enforced in the interface only. Anyone with access to this signed-in browser session can change them — they tidy the UI, they are not server-side security.</p>
              <div className="my-1 h-px bg-line" />
              <div className="truncate px-2.5 py-1 text-[11px] text-muted" title={authEmail}>Signed in as {authEmail ?? 'this account'}</div>
              <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-subtle"><LogOut size={14} />Sign out</button>
            </div>
          )}
        </Popover>
      </div>
      <WorkspaceDialog open={newWs} onClose={() => setNewWs(false)} />
    </header>
  )
}
