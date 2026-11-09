import { useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, MoreHorizontal } from 'lucide-react'
import type { ID, NavItem } from '#/types'
import { useSettingsStore } from '#/stores/settingsStore'
import { useModuleStore } from '#/stores/moduleStore'
import { useAllModules, usePerms, useWsId } from '#/hooks/useData'
import { confirmDialog } from '#/utils/toast'
import { cn } from '#/utils/id'
import { Icon } from '#/components/ui/Icon'
import { Menu } from '#/components/ui/Popover'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Input, Select, Field } from '#/components/ui/controls'
import { IconPicker } from '#/components/ui/Overlays'
import { DEFAULT_SECTIONS } from '#/services/navService'
import { AppLink, usePathname } from './AppLink'

const EMPTY: NavItem[] = []

function useNavData() {
  const ws = useWsId()
  const nav = useSettingsStore((s) => s.settings.nav[ws]) ?? EMPTY
  const modules = useAllModules()
  const perms = usePerms()
  return { ws, nav, modules, perms }
}

export function NavTree({ editing, onNavigate }: { editing: boolean; onNavigate?: () => void }) {
  const { ws, nav, modules, perms } = useNavData()
  const st = useSettingsStore.getState
  const [editItem, setEditItem] = useState<NavItem | null>(null)
  const [addTo, setAddTo] = useState<{ parentId: ID | null } | null>(null)
  const pathname = usePathname()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const moduleMap = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules])
  const children = useMemo(() => {
    const map = new Map<ID | null, NavItem[]>()
    for (const i of nav) {
      const k = i.parentId ?? null
      map.set(k, [...(map.get(k) ?? []), i])
    }
    map.forEach((v) => v.sort((a, b) => a.order - b.order))
    return map
  }, [nav])

  const visible = (i: NavItem): boolean => {
    if (editing) return true
    if (i.hidden) return false
    if (i.type === 'module') {
      const m = i.moduleId ? moduleMap.get(i.moduleId) : undefined
      return !!m && !m.archived && m.visible && perms.canModule(m, 'view')
    }
    if (i.type === 'category' || i.type === 'folder') return (children.get(i.id) ?? []).some(visible)
    return true
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const a = nav.find((i) => i.id === active.id)
    const o = nav.find((i) => i.id === over.id)
    if (!a || !o) return
    const s = st()
    const sameParent = (a.parentId ?? null) === (o.parentId ?? null)
    if (sameParent) {
      const sibs = (children.get(a.parentId ?? null) ?? []).map((x) => x.id)
      const from = sibs.indexOf(a.id)
      const to = sibs.indexOf(o.id)
      sibs.splice(from, 1)
      sibs.splice(to, 0, a.id)
      s.reorderNav(ws, a.parentId ?? null, sibs)
      return
    }
    if (a.type === 'category') return
    if (o.type === 'category' || o.type === 'folder') s.moveNavItem(ws, a.id, o.id)
    else {
      const sibs = children.get(o.parentId ?? null) ?? []
      s.moveNavItem(ws, a.id, o.parentId ?? null, sibs.findIndex((x) => x.id === o.id))
    }
  }

  const remove = async (item: NavItem) => {
    const count = nav.length ? [...(children.get(item.id) ?? [])].length : 0
    const ok = await confirmDialog({
      title: `Remove "${item.label}" from navigation?`,
      message: item.type === 'module' ? 'The module and its records are kept — it stays available under All Modules.' : count ? `This removes the ${item.type} and the ${count} item(s) inside it from the sidebar. Modules and their data are not deleted.` : 'This only changes the sidebar. No data is deleted.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    // remember that these modules were taken out of the sidebar on purpose (restores must not re-add them)
    const gone: ID[] = []
    const walk = (i: NavItem) => {
      if (i.type === 'module' && i.moduleId) gone.push(i.moduleId)
      ;(children.get(i.id) ?? []).forEach(walk)
    }
    walk(item)
    st().removeNavItem(ws, item.id)
    gone.forEach((id) => useModuleStore.getState().update(id, { showInNav: false }))
  }

  const roots = (children.get(null) ?? []).filter(visible)

  const renderNode = (item: NavItem, depth: number): React.ReactNode => (
    <Row key={item.id} item={item} depth={depth} editing={editing} childrenItems={(children.get(item.id) ?? []).filter(visible)} renderChild={renderNode} pathname={pathname} onNavigate={onNavigate} onEdit={() => setEditItem(item)} onAdd={() => setAddTo({ parentId: item.id })} onRemove={() => void remove(item)} nav={nav} ws={ws} />
  )

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={roots.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">{roots.map((r) => renderNode(r, 0))}</div>
        </SortableContext>
      </DndContext>
      {editing && (
        <Button size="sm" variant="soft" className="mt-3 w-full" icon="Plus" onClick={() => setAddTo({ parentId: null })}>
          Add category
        </Button>
      )}
      {editItem && <EditDialog item={editItem} ws={ws} onClose={() => setEditItem(null)} />}
      {addTo && <AddDialog parentId={addTo.parentId} ws={ws} nav={nav} onClose={() => setAddTo(null)} />}
    </>
  )
}

interface RowProps {
  item: NavItem
  depth: number
  editing: boolean
  childrenItems: NavItem[]
  renderChild: (i: NavItem, depth: number) => React.ReactNode
  pathname: string
  onNavigate?: () => void
  onEdit: () => void
  onAdd: () => void
  onRemove: () => void
  nav: NavItem[]
  ws: ID
}

function Row({ item, depth, editing, childrenItems, renderChild, pathname, onNavigate, onEdit, onAdd, onRemove, nav, ws }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editing })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : item.hidden ? 0.55 : 1 }
  const s = useSettingsStore.getState()
  const container = item.type === 'category' || item.type === 'folder'
  const path = item.type === 'module' ? `/m/${item.moduleId}` : (item.path ?? '/')
  const active = item.type === 'module' || item.type === 'route' ? (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/')) : false

  const moveTargets = nav.filter((n) => (n.type === 'category' || n.type === 'folder') && n.id !== item.id && n.id !== item.parentId && !isInside(nav, n.id, item.id))
  const menu = (
    <Menu
      items={[
        { label: 'Rename & change icon', icon: 'Pencil', onClick: onEdit },
        { label: item.hidden ? 'Show in sidebar' : 'Hide from sidebar', icon: item.hidden ? 'Eye' : 'Eye', onClick: () => s.updateNavItem(ws, item.id, { hidden: !item.hidden }) },
        ...(container ? [{ label: 'Add item inside…', icon: 'Plus', onClick: onAdd }] : []),
        ...(item.type !== 'category' && moveTargets.length ? [{ divider: true }, ...moveTargets.slice(0, 12).map((t) => ({ label: `Move to ${t.label}`, icon: 'ArrowUpDown', onClick: () => s.moveNavItem(ws, item.id, t.id) }))] : []),
        { divider: true },
        { label: 'Remove from navigation', icon: 'Trash2', danger: true, onClick: onRemove },
      ]}
      trigger={({ toggle, ref }) => (
        <button ref={ref} type="button" aria-label={`Options for ${item.label}`} onClick={toggle} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg">
          <MoreHorizontal size={14} />
        </button>
      )}
    />
  )

  const handle = editing && (
    <button type="button" aria-label={`Drag ${item.label}`} className="cursor-grab touch-none rounded p-0.5 text-muted/70 hover:text-fg active:cursor-grabbing" {...attributes} {...listeners}>
      <GripVertical size={13} />
    </button>
  )

  if (container) {
    const collapsed = !!item.collapsed && !editing
    const isCat = item.type === 'category'
    return (
      <div ref={setNodeRef} style={style}>
        <div className={cn('group flex items-center gap-0.5', !isCat && 'pl-1')} style={{ paddingLeft: !isCat ? 6 + depth * 4 : 0 }}>
          {handle}
          <button type="button" aria-expanded={!collapsed} onClick={() => s.updateNavItem(ws, item.id, { collapsed: !item.collapsed })} className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-subtle', isCat ? 'text-[11px] font-semibold tracking-wider text-muted uppercase' : 'text-[13px] font-medium text-fg')}>
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {!isCat && <Icon name={item.icon} size={15} className="text-muted" />}
            {isCat && <Icon name={item.icon} size={13} />}
            <span className="truncate">{item.label}</span>
          </button>
          {editing && (
            <>
              <button type="button" aria-label={item.hidden ? 'Show' : 'Hide'} onClick={() => s.updateNavItem(ws, item.id, { hidden: !item.hidden })} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg">
                {item.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              {menu}
            </>
          )}
        </div>
        {!collapsed && (
          <SortableContext items={childrenItems.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <div className={cn('mt-0.5 space-y-0.5', !isCat && 'ml-3 border-l border-line pl-1')}>{childrenItems.map((c) => renderChild(c, depth + 1))}</div>
            {editing && childrenItems.length === 0 && <div className="px-6 py-1 text-[11px] text-muted">Empty — use ⋯ to add items</div>}
          </SortableContext>
        )}
      </div>
    )
  }

  const inner = (
    <>
      <Icon name={item.icon} size={16} className={active ? 'text-primary' : 'text-muted'} />
      <span className="truncate">{item.label}</span>
    </>
  )
  const cls = cn('flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition', active ? 'bg-primary/10 font-semibold text-primary' : 'text-fg/85 hover:bg-subtle')
  return (
    <div ref={setNodeRef} style={style} className="group flex items-center gap-0.5">
      {handle}
      {item.type === 'link' && item.path ? (
        <a href={item.path} target={/^https?:/.test(item.path) ? '_blank' : undefined} rel="noreferrer noopener" className={cls}>
          {inner}
        </a>
      ) : (
        <AppLink to={path} className={cls} onClick={onNavigate}>
          {inner}
        </AppLink>
      )}
      {editing && (
        <>
          <button type="button" aria-label={item.hidden ? 'Show' : 'Hide'} onClick={() => s.updateNavItem(ws, item.id, { hidden: !item.hidden })} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg">
            {item.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          {menu}
        </>
      )}
    </div>
  )
}

function isInside(nav: NavItem[], candidateId: ID, ancestorId: ID): boolean {
  let cur = nav.find((n) => n.id === candidateId)
  while (cur) {
    if (cur.parentId === ancestorId) return true
    cur = nav.find((n) => n.id === cur!.parentId)
  }
  return false
}

function EditDialog({ item, ws, onClose }: { item: NavItem; ws: ID; onClose: () => void }) {
  const [label, setLabel] = useState(item.label)
  const [icon, setIcon] = useState(item.icon)
  const save = () => {
    if (!label.trim()) return
    useSettingsStore.getState().updateNavItem(ws, item.id, { label: label.trim(), icon })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title="Edit navigation item" size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!label.trim()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Label"><Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
        <Field label="Icon"><IconPicker value={icon} onChange={setIcon} /></Field>
      </div>
    </Modal>
  )
}

type Kind = 'category' | 'folder' | 'page' | 'module' | 'link'

function AddDialog({ parentId, ws, nav, onClose }: { parentId: ID | null; ws: ID; nav: NavItem[]; onClose: () => void }) {
  const modules = useAllModules()
  const [kind, setKind] = useState<Kind>(parentId ? 'folder' : 'category')
  const [label, setLabel] = useState('')
  const [icon, setIcon] = useState(kind === 'category' ? 'Folder' : 'Folder')
  const [url, setUrl] = useState('')
  const [page, setPage] = useState('/modules')
  const [moduleId, setModuleId] = useState('')
  const pages = DEFAULT_SECTIONS.flatMap((s) => s.items)
  const unplaced = modules.filter((m) => !nav.some((n) => n.moduleId === m.id))
  const parent = nav.find((n) => n.id === parentId)

  const submit = () => {
    const s = useSettingsStore.getState()
    if (kind === 'category') {
      if (!label.trim()) return
      s.addNavItem(ws, { label: label.trim(), icon, type: 'category', parentId: null })
    } else if (kind === 'folder') {
      if (!label.trim()) return
      s.addNavItem(ws, { label: label.trim(), icon, type: 'folder', parentId })
    } else if (kind === 'page') {
      const p = pages.find((x) => x.path === page)
      if (!p) return
      s.addNavItem(ws, { label: label.trim() || p.label, icon: p.icon, type: 'route', path: p.path, parentId, key: p.key })
    } else if (kind === 'module') {
      const m = modules.find((x) => x.id === moduleId)
      if (!m) return
      s.addNavItem(ws, { label: m.name, icon: m.icon, type: 'module', moduleId: m.id, parentId })
      if (m.showInNav === false) useModuleStore.getState().update(m.id, { showInNav: undefined })
    } else {
      if (!label.trim() || !url.trim()) return
      s.addNavItem(ws, { label: label.trim(), icon: 'Link', type: 'link', path: /^https?:\/\//i.test(url) ? url : `https://${url}`, parentId })
    }
    onClose()
  }

  const kinds: { id: Kind; label: string }[] = parentId
    ? [{ id: 'folder', label: 'Folder / subcategory' }, { id: 'module', label: 'Module' }, { id: 'page', label: 'Page' }, { id: 'link', label: 'External link' }]
    : [{ id: 'category', label: 'Category' }]
  return (
    <Modal open onClose={onClose} title={parentId ? `Add to ${parent?.label ?? 'navigation'}` : 'New category'} size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Add</Button></>}>
      <div className="space-y-4">
        {kinds.length > 1 && (
          <Field label="What do you want to add?">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{kinds.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>
          </Field>
        )}
        {(kind === 'category' || kind === 'folder' || kind === 'link') && <Field label="Name"><Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === 'link' ? 'e.g. Help centre' : 'e.g. Customer care'} /></Field>}
        {kind === 'link' && <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" /></Field>}
        {(kind === 'category' || kind === 'folder') && <Field label="Icon"><IconPicker value={icon} onChange={setIcon} /></Field>}
        {kind === 'page' && (
          <Field label="Page">
            <Select value={page} onChange={(e) => setPage(e.target.value)}>{pages.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</Select>
          </Field>
        )}
        {kind === 'module' && (
          <Field label="Module" hint={unplaced.length ? undefined : 'All modules are already in the navigation.'}>
            <Select value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="">Choose a module…</option>
              {unplaced.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  )
}
