import { useState } from 'react'
import { format } from 'date-fns'
import type { Workspace } from '#/types'
import { useModules, usePerms, useRecords, useWorkspace } from '#/hooks/useData'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { useSaveStatus, flushAll } from '#/stores'
import { deleteWorkspace } from '#/services/workspaceService'
import { DATA_KEYS, KEYS, removeKey, storageUsage } from '#/services/storage/storageService'
import { formatBytes } from '#/utils/fieldTypes'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { WorkspaceDialog } from '#/components/layout/WorkspaceDialog'
import { Button } from '#/components/ui/Button'
import { Badge, Card, Notice, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'

const KEY_LABEL: Record<string, string> = {
  [KEYS.workspaces]: 'Workspaces', [KEYS.modules]: 'Modules & fields', [KEYS.records]: 'Records', [KEYS.templates]: 'Saved templates', [KEYS.forms]: 'Forms', [KEYS.views]: 'Views',
  [KEYS.dashboards]: 'Dashboards', [KEYS.workflows]: 'Workflows', [KEYS.workflowRuns]: 'Workflow run log', [KEYS.settings]: 'Settings & navigation', [KEYS.users]: 'Team', [KEYS.roles]: 'Roles', [KEYS.activities]: 'Activity log',
}
const SHORTCUTS = [['⌘/Ctrl + K', 'Open the command palette'], ['Esc', 'Close dialogs, drawers and menus'], ['Enter', 'Confirm in name/rename dialogs'], ['Tab / Shift+Tab', 'Move between controls']]

export function SettingsPage() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const current = useWorkspace()
  const setCurrent = useWorkspaceStore((s) => s.setCurrent)
  const perms = usePerms()
  const modules = useModules({ includeArchived: true, includeSystem: true })
  const records = useRecords()
  const save = useSaveStatus()
  const [dialog, setDialog] = useState<Workspace | 'new' | null>(null)
  const [usage, setUsage] = useState(() => storageUsage())
  const can = perms.can('accessSettings')
  const maxBytes = Math.max(1, ...Object.values(usage.perKey))
  const persisted = typeof navigator !== 'undefined' && 'storage' in navigator

  const remove = async (w: Workspace) => {
    if (workspaces.length <= 1) return toast.error('You need at least one workspace')
    const ok = await confirmDialog({ title: `Delete workspace “${w.name}”?`, message: 'All of its modules, records, forms, views, dashboards and workflows are permanently deleted.', confirmLabel: 'Delete workspace', danger: true, requireText: w.name })
    if (ok && deleteWorkspace(w.id)) toast.success('Workspace deleted')
  }
  const reset = async () => {
    const ok = await confirmDialog({ title: 'Erase ALL Xcrm data?', message: 'This deletes every workspace, record, file and setting stored in this browser and starts fresh. It cannot be undone — download a backup first.', confirmLabel: 'Erase everything', danger: true, requireText: 'ERASE' })
    if (!ok) return
    flushAll()
    DATA_KEYS.forEach(removeKey)
    removeKey(KEYS.version)
    try { window.indexedDB.deleteDatabase('xcrm-files') } catch { /* ignore */ }
    window.location.assign('/')
  }

  return (
    <Page title="Settings" skeleton="form">
      <PageHeader title="Settings" icon="Settings" description="Workspaces, storage and housekeeping." />
      {!can && <div className="mb-4"><Notice>Your role can view settings but not change them.</Notice></div>}
      <div className="space-y-5">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-semibold">Workspaces</h2>{can && <Button size="sm" variant="primary" icon="Plus" onClick={() => setDialog('new')}>New workspace</Button>}</div>
          <ul className="divide-y divide-line">
            {workspaces.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="flex size-9 items-center justify-center rounded-lg text-white" style={{ background: w.color }}><Icon name={w.icon} size={17} /></span>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[14px] font-medium">{w.name}{w.id === current?.id && <Badge color="#2DB67D">Current</Badge>}</div>{w.description && <div className="truncate text-xs text-muted">{w.description}</div>}</div>
                {w.id !== current?.id && <Button size="xs" onClick={() => { setCurrent(w.id); toast.info(`Switched to ${w.name}`) }}>Switch</Button>}
                {can && <Button size="xs" onClick={() => setDialog(w)}>Edit</Button>}
                {can && <Button size="xs" variant="ghost" disabled={workspaces.length <= 1} onClick={() => void remove(w)}>Delete</Button>}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Saving & storage</h2>
            <div className="flex gap-2">
              <Button size="sm" icon="Save" onClick={() => { flushAll(); setUsage(storageUsage()); toast.success('Everything is saved') }}>Save now</Button>
              <Button size="sm" icon="RefreshCw" onClick={() => setUsage(storageUsage())}>Refresh</Button>
            </div>
          </div>
          <p className="mb-3 text-[13px] text-muted">Changes save automatically a moment after you make them. {save.failed ? <span className="text-danger">The last save failed — storage may be full or blocked.</span> : save.pending ? 'Saving…' : save.savedAt ? `Last saved ${format(save.savedAt, 'HH:mm:ss')}.` : 'Nothing to save right now.'}</p>
          <div className="mb-3 text-[13px]"><strong>{formatBytes(usage.bytes)}</strong> used of roughly 5 MB of browser storage · {modules.length} modules · {records.length} records · attached files are stored separately in IndexedDB.</div>
          <ul className="space-y-1.5">{Object.entries(usage.perKey).sort((a, b) => b[1] - a[1]).map(([k, bytes]) => (
            <li key={k} className="grid grid-cols-[150px_1fr_70px] items-center gap-3 text-xs"><span className="truncate">{KEY_LABEL[k] ?? k}</span><span className="h-2 overflow-hidden rounded-full bg-subtle"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, (bytes / maxBytes) * 100)}%` }} /></span><span className="text-right text-muted tabular-nums">{formatBytes(bytes)}</span></li>
          ))}</ul>
          {persisted && <div className="mt-4"><Button size="sm" icon="Shield" onClick={async () => { try { const ok = await navigator.storage.persist(); ok ? toast.success('Storage marked persistent', 'Your browser is less likely to evict Xcrm data.') : toast.info('Browser declined', 'It may still keep your data; back up regularly.') } catch { toast.error('Not supported in this browser') } }}>Ask browser to keep my data</Button></div>}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Keyboard shortcuts</h2>
          <dl className="grid gap-2 sm:grid-cols-2">{SHORTCUTS.map(([k, d]) => <div key={k} className="flex items-center gap-3 text-[13px]"><kbd className="rounded-md border border-line bg-subtle px-2 py-0.5 font-mono text-xs">{k}</kbd><span className="text-muted">{d}</span></div>)}</dl>
        </Card>

        {can && (
          <Card className="border-danger/30 p-5">
            <h2 className="text-[15px] font-semibold text-danger">Danger zone</h2>
            <p className="mt-1 mb-3 text-[13px] text-muted">Erase every workspace, record and file stored by Xcrm in this browser and return to a fresh start.</p>
            <Button variant="danger" icon="Trash2" onClick={() => void reset()}>Erase all data</Button>
          </Card>
        )}
      </div>
      {dialog && <WorkspaceDialog open onClose={() => setDialog(null)} workspace={dialog === 'new' ? undefined : dialog} />}
    </Page>
  )
}
