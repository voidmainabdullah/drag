import { formatDistanceToNow } from 'date-fns'
import { Star } from 'lucide-react'
import { useAllModules, useWsId } from '#/hooks/useData'
import { useSettingsStore } from '#/stores/settingsStore'
import { useUiStore } from '#/stores/uiStore'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Card, EmptyState, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'

type Target = { moduleId?: string; recordId?: string }

export function useOpenTarget() {
  const go = useGo()
  const modules = useAllModules()
  const showRecord = useUiStore((s) => s.showRecord)
  return (t: Target) => {
    if (t.moduleId && !modules.some((m) => m.id === t.moduleId)) return toast.warning('That item no longer exists')
    if (t.recordId && t.moduleId) showRecord(t.moduleId, t.recordId)
    else if (t.moduleId) go(`/m/${t.moduleId}`)
  }
}

export function RecentPage() {
  const ws = useWsId()
  const recents = useSettingsStore((s) => s.settings.recents[ws]) ?? []
  const modules = useAllModules()
  const open = useOpenTarget()
  return (
    <Page title="Recent" skeleton="table">
      <PageHeader title="Recent" icon="Clock" description="Records and modules you opened lately in this workspace."
        actions={<Button icon="Trash2" disabled={recents.length === 0} onClick={async () => { if (await confirmDialog({ title: 'Clear recent history?', confirmLabel: 'Clear' })) { useSettingsStore.getState().clearRecents(ws); toast.success('Recent history cleared') } }}>Clear history</Button>} />
      {recents.length === 0 ? <EmptyState icon="Clock" title="Nothing here yet" description="Open a record or module and it will show up here." /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {recents.map((r) => {
            const m = modules.find((x) => x.id === r.moduleId)
            return (
              <li key={`${r.moduleId}:${r.recordId ?? ''}`}>
                <button type="button" onClick={() => open(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle">
                  <span className="flex size-8 items-center justify-center rounded-lg text-white" style={{ background: m?.color ?? '#94A3B8' }}><Icon name={r.recordId ? 'FileText' : (m?.icon ?? 'Box')} size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium">{r.label}</span><span className="text-xs text-muted">{m?.name ?? 'Deleted module'}{r.recordId ? ' · record' : ' · module'}</span></span>
                  <span className="shrink-0 text-xs text-muted">{formatDistanceToNow(new Date(r.at), { addSuffix: true })}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Page>
  )
}

export function FavouritesPage() {
  const ws = useWsId()
  const favs = useSettingsStore((s) => s.settings.favourites[ws]) ?? []
  const modules = useAllModules()
  const open = useOpenTarget()
  return (
    <Page title="Favourites" skeleton="cards">
      <PageHeader title="Favourites" icon="Star" description="Quick access to the records and modules you starred. Star a record from its drawer." />
      {favs.length === 0 ? <EmptyState icon="Star" title="No favourites yet" description="Open a record and click the star in its header to pin it here." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {favs.map((f) => {
            const m = modules.find((x) => x.id === f.moduleId)
            return (
              <Card key={`${f.moduleId}:${f.recordId ?? ''}`} onClick={() => open(f)} className="flex items-center gap-3 p-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: m?.color ?? '#94A3B8' }}><Icon name={f.recordId ? 'FileText' : (m?.icon ?? 'Box')} size={16} /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium">{f.label}</div><div className="truncate text-xs text-muted">{m?.name ?? 'Deleted module'}</div></div>
                <button type="button" aria-label={`Remove ${f.label} from favourites`} onClick={(e) => { e.stopPropagation(); useSettingsStore.getState().toggleFavourite(ws, f); toast.info('Removed from favourites') }} className="rounded p-1.5 text-warning hover:bg-subtle"><Star size={16} className="fill-warning" /></button>
              </Card>
            )
          })}
        </div>
      )}
    </Page>
  )
}
