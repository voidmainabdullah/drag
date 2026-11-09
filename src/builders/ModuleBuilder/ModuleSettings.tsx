import { useEffect, useState } from 'react'
import type { Module, ModuleAccess } from '#/types'
import { useModuleStore } from '#/stores/moduleStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useAllModules, usePerms, useRoles, useWsId } from '#/hooks/useData'
import { renameModule, setModuleInSidebar } from '#/services/moduleService'
import { Button } from '#/components/ui/Button'
import { Checkbox, Field, Input, Select, Switch, Textarea } from '#/components/ui/controls'
import { ColorPicker, IconPicker } from '#/components/ui/Overlays'
import { Notice } from '#/components/ui/misc'
import { toast } from '#/utils/toast'

const ACTIONS: (keyof ModuleAccess)[] = ['view', 'create', 'edit', 'delete']

export function ModuleSettings({ module }: { module: Module }) {
  const perms = usePerms()
  const ws = useWsId()
  const roles = useRoles()
  const modules = useAllModules()
  const nav = useSettingsStore((s) => s.settings.nav[ws]) ?? []
  const canEdit = perms.can('manageFields')
  const [name, setName] = useState(module.name)
  const [description, setDescription] = useState(module.description ?? '')
  const [category, setCategory] = useState(module.category ?? '')
  const [folder, setFolder] = useState(module.folder ?? '')
  useEffect(() => {
    setName(module.name)
    setDescription(module.description ?? '')
    setCategory(module.category ?? '')
    setFolder(module.folder ?? '')
  }, [module.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const ms = useModuleStore.getState()
  const navItem = nav.find((n) => n.moduleId === module.id)
  const containers = nav.filter((n) => n.type === 'category' || n.type === 'folder' || (n.type === 'module' && n.moduleId !== module.id))
  const dirty = name.trim() !== module.name || description !== (module.description ?? '') || category !== (module.category ?? '') || folder !== (module.folder ?? '')

  const save = () => {
    if (!name.trim()) return toast.error('Name is required')
    if (name.trim() !== module.name) renameModule(module.id, name)
    ms.update(module.id, { description: description || undefined, category: category.trim() || undefined, folder: folder.trim() || undefined })
    toast.success('Module settings saved')
  }

  const toggleSidebar = (show: boolean) => {
    setModuleInSidebar(module.id, show)
    toast.success(show ? 'Shown in the sidebar' : 'Hidden from the sidebar', show ? undefined : 'Find it under All Modules any time.')
  }

  const setIcon = (icon: string) => {
    ms.update(module.id, { icon })
    if (navItem) useSettingsStore.getState().updateNavItem(ws, navItem.id, { icon })
  }

  const setParentModule = (parentId: string) => {
    ms.update(module.id, { parentId: parentId || undefined })
    const st = useSettingsStore.getState()
    if (navItem) {
      const parentNav = parentId ? nav.find((n) => n.moduleId === parentId) : undefined
      if (parentNav) st.moveNavItem(ws, navItem.id, parentNav.id)
      else if (parentId === '') {
        const cat = nav.find((n) => n.type === 'category' && n.label === 'Business Management') ?? nav.find((n) => n.type === 'category')
        if (cat) st.moveNavItem(ws, navItem.id, cat.id)
      }
    }
  }

  const effective = (roleId: string, a: keyof ModuleAccess): boolean => {
    const o = module.permissions?.[roleId]
    if (o) return o[a]
    const r = roles.find((x) => x.id === roleId)
    const key = { view: 'viewModules', create: 'createRecords', edit: 'editRecords', delete: 'deleteRecords' }[a] as keyof NonNullable<typeof r>['permissions']
    return !!r?.permissions[key]
  }
  const setAccess = (roleId: string, a: keyof ModuleAccess, v: boolean) => {
    const cur: ModuleAccess = { view: effective(roleId, 'view'), create: effective(roleId, 'create'), edit: effective(roleId, 'edit'), delete: effective(roleId, 'delete') }
    ms.update(module.id, { permissions: { ...(module.permissions ?? {}), [roleId]: { ...cur, [a]: v } } })
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field label="Module name" required><Input value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category label" hint="Groups modules on the All Modules page"><Input value={category} disabled={!canEdit} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Sales" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-[64px]" value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Folder label" hint="Optional sub-grouping"><Input value={folder} disabled={!canEdit} onChange={(e) => setFolder(e.target.value)} /></Field>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Icon"><IconPicker value={module.icon} color={module.color} onChange={setIcon} /></Field>
          <Field label="Colour"><ColorPicker value={module.color} onChange={(c) => ms.update(module.id, { color: c })} /></Field>
        </div>
        <Field label="Parent module (makes this a submodule)">
          <Select value={module.parentId ?? ''} disabled={!canEdit} onChange={(e) => setParentModule(e.target.value)}>
            <option value="">None — top level</option>
            {modules.filter((m) => m.id !== module.id && m.parentId !== module.id && !m.system).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Sidebar location">
          <Select value={navItem?.parentId ?? ''} disabled={!canEdit || !navItem} onChange={(e) => navItem && useSettingsStore.getState().moveNavItem(ws, navItem.id, e.target.value || null)}>
            {!navItem && <option value="">Not in sidebar</option>}
            {containers.map((c) => <option key={c.id} value={c.id}>{c.type === 'category' ? c.label : `${nav.find((p) => p.id === c.parentId)?.label ?? ''} › ${c.label}`}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3 sm:col-span-2">
          <div className="space-y-1">
            <Switch checked={!!navItem} onChange={toggleSidebar} disabled={!canEdit || module.archived} label="Show in sidebar" />
            <p className="text-xs text-muted">{navItem ? 'Listed in the sidebar.' : 'Hidden from sidebar — still available under All Modules.'}</p>
          </div>
          <div className="space-y-1">
            <Switch checked={module.visible} onChange={(v) => ms.update(module.id, { visible: v })} disabled={!canEdit} label="Visible to team members" />
            <p className="text-xs text-muted">Turn off to hide it from navigation for everyone without removing the sidebar entry.</p>
          </div>
        </div>
        <div className="sm:col-span-2"><Button variant="primary" disabled={!canEdit || !dirty} onClick={save}>Save changes</Button></div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Module permissions</h3>
        <p className="mb-3 text-xs text-muted">Overrides what each role may do in this module. Roles without an override use their global permissions.</p>
        <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">Role</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2 capitalize">{a}</th>)}<th /></tr></thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{r.name}{module.permissions?.[r.id] && <span className="ml-2 text-[10px] text-primary">custom</span>}</td>
                  {ACTIONS.map((a) => <td key={a} className="px-3 py-2 text-center"><Checkbox checked={effective(r.id, a)} disabled={!canEdit} onChange={(v) => setAccess(r.id, a, v)} label={<span className="sr-only">{r.name} {a}</span>} /></td>)}
                  <td className="px-3 py-2 text-right">{module.permissions?.[r.id] && canEdit && <Button size="xs" variant="ghost" onClick={() => { const p = { ...(module.permissions ?? {}) }; delete p[r.id]; ms.update(module.id, { permissions: Object.keys(p).length ? p : undefined }) }}>Reset</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><Notice tone="warning">Permissions are enforced in this interface only. They are not a security boundary — anyone with access to this browser can change them.</Notice></div>
      </section>
    </div>
  )
}
