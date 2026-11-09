import { useState } from 'react'
import type { FieldAccess, Module, ModuleAccess, PermissionKey, Role } from '#/types'
import { useAllModules, usePerms, useRoles, useUsers } from '#/hooks/useData'
import { useModuleStore } from '#/stores/moduleStore'
import { useUserStore } from '#/stores/userStore'
import { PERMISSION_KEYS, PERMISSION_LABELS } from '#/services/storage/settingsStorage'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Checkbox, Select } from '#/components/ui/controls'
import { NameDialog } from '#/components/ui/Overlays'
import { Badge, Notice, PageHeader, Tabs } from '#/components/ui/misc'
import { FIELD_TYPE_MAP } from '#/utils/fieldTypes'
import { Icon } from '#/components/ui/Icon'

type Tab = 'global' | 'modules' | 'fields'
const ACTIONS: (keyof ModuleAccess)[] = ['view', 'create', 'edit', 'delete']
const ACTION_KEY: Record<keyof ModuleAccess, PermissionKey> = { view: 'viewModules', create: 'createRecords', edit: 'editRecords', delete: 'deleteRecords' }

const effective = (m: Module, r: Role, a: keyof ModuleAccess) => m.permissions?.[r.id]?.[a] ?? r.permissions[ACTION_KEY[a]]

export function RolesPage() {
  const roles = useRoles()
  const users = useUsers()
  const modules = useAllModules().filter((m) => !m.archived)
  const perms = usePerms()
  const [tab, setTab] = useState<Tab>('global')
  const [roleId, setRoleId] = useState('')
  const [modId, setModId] = useState('')
  const [dialog, setDialog] = useState<'new' | 'rename' | null>(null)
  const canEdit = perms.can('accessSettings')
  const us = useUserStore.getState()
  const role = roles.find((r) => r.id === roleId) ?? roles[0]
  const mod = modules.find((m) => m.id === modId) ?? modules[0]

  const removeRole = async (r: Role) => {
    const inUse = users.filter((u) => u.roleId === r.id)
    const ok = await confirmDialog({ title: `Delete role “${r.name}”?`, message: inUse.length ? `${inUse.length} member(s) will move to the Member role.` : undefined, confirmLabel: 'Delete role', danger: true })
    if (!ok) return
    inUse.forEach((u) => us.updateUser(u.id, { roleId: 'role_member' }))
    modules.forEach((m) => { if (m.permissions?.[r.id]) { const p = { ...m.permissions }; delete p[r.id]; useModuleStore.getState().update(m.id, { permissions: p }) } })
    us.removeRole(r.id)
    setRoleId('')
    toast.success('Role deleted')
  }
  const setAccess = (m: Module, r: Role, a: keyof ModuleAccess, v: boolean) => {
    const cur: ModuleAccess = { view: effective(m, r, 'view'), create: effective(m, r, 'create'), edit: effective(m, r, 'edit'), delete: effective(m, r, 'delete') }
    useModuleStore.getState().update(m.id, { permissions: { ...(m.permissions ?? {}), [r.id]: { ...cur, [a]: v } } })
  }

  return (
    <Page title="Roles & Permissions" skeleton="table" wide>
      <PageHeader title="Roles & Permissions" icon="ShieldCheck" description="Decide what each role can see and do — globally, per module, and per field."
        actions={canEdit && <Button variant="gradient" icon="Plus" onClick={() => setDialog('new')}>New role</Button>} />
      <div className="mb-4"><Notice tone="warning"><strong>These permissions are enforced in the interface only.</strong> Your sign-in protects your account, not the roles inside it: the CRM data lives in this browser, so anyone using your signed-in session can switch members or edit roles. Treat roles as a way to keep the UI tidy, not as security.</Notice></div>
      {!canEdit && <div className="mb-4"><Notice>Your role can view permissions but not change them.</Notice></div>}
      <Tabs<Tab> className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'global', label: 'Global permissions', icon: 'ShieldCheck' }, { id: 'modules', label: 'Module access', icon: 'Boxes' }, { id: 'fields', label: 'Field access', icon: 'Columns3' }]} />

      {tab === 'global' && (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle/70 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 text-left">Permission</th>
                {roles.map((r) => (
                  <th key={r.id} className="px-3 py-2.5 text-center">
                    <div className="font-semibold text-fg">{r.name}</div>
                    <div className="text-[10px] font-normal">{users.filter((u) => u.roleId === r.id).length} member(s)</div>
                    {canEdit && !r.builtin && <div className="mt-1 flex justify-center gap-1"><button type="button" className="text-[10px] text-primary hover:underline" onClick={() => { setRoleId(r.id); setDialog('rename') }}>Rename</button><button type="button" className="text-[10px] text-danger hover:underline" onClick={() => void removeRole(r)}>Delete</button></div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_KEYS.map((k) => (
                <tr key={k} className="border-t border-line">
                  <td className="px-4 py-2.5 font-medium">{PERMISSION_LABELS[k]}</td>
                  {roles.map((r) => {
                    const locked = r.id === 'role_owner'
                    return <td key={r.id} className="px-3 py-2.5 text-center"><Checkbox checked={r.permissions[k]} disabled={!canEdit || locked} onChange={(v) => { us.setRolePermission(r.id, k, v); toast.success('Permission updated') }} label={<span className="sr-only">{r.name}: {PERMISSION_LABELS[k]}</span>} /></td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">The Owner role always has every permission so the workspace can’t lock itself out.</p>
        </div>
      )}

      {tab === 'modules' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-[13px] text-muted">Role<Select className="w-48" value={role?.id} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></label><span className="text-xs text-muted">Changing a box saves an override for that module only. “Reset” returns it to the role’s global permission.</span></div>
          {role && (
            <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-4 py-2.5 text-left">Module</th>{ACTIONS.map((a) => <th key={a} className="px-3 py-2.5 capitalize">{a}</th>)}<th /></tr></thead>
                <tbody>{modules.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-4 py-2.5"><span className="flex items-center gap-2 font-medium"><span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: m.color }}><Icon name={m.icon} size={13} /></span>{m.name}{m.permissions?.[role.id] && <Badge color="#7B68EE">override</Badge>}</span></td>
                    {ACTIONS.map((a) => <td key={a} className="px-3 py-2.5 text-center"><Checkbox checked={effective(m, role, a)} disabled={!canEdit || role.id === 'role_owner'} onChange={(v) => setAccess(m, role, a, v)} label={<span className="sr-only">{m.name} {a}</span>} /></td>)}
                    <td className="px-3 py-2.5 text-right">{m.permissions?.[role.id] && canEdit && <Button size="xs" variant="ghost" onClick={() => { const p = { ...m.permissions }; delete p[role.id]; useModuleStore.getState().update(m.id, { permissions: Object.keys(p).length ? p : undefined }) }}>Reset</Button>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'fields' && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-[13px] text-muted">Module<Select className="w-56" value={mod?.id} onChange={(e) => setModId(e.target.value)}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></label>
          {mod && (
            <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-4 py-2.5 text-left">Field</th>{roles.map((r) => <th key={r.id} className="px-3 py-2.5 text-center">{r.name}</th>)}</tr></thead>
                <tbody>{mod.fields.map((f) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="px-4 py-2.5"><div className="font-medium">{f.label}</div><div className="text-[11px] text-muted">{FIELD_TYPE_MAP[f.type].label}</div></td>
                    {roles.map((r) => (
                      <td key={r.id} className="px-3 py-2.5 text-center">
                        <Select aria-label={`${r.name} access to ${f.label}`} className="h-8 w-28 text-xs" disabled={!canEdit || r.id === 'role_owner'} value={f.permissions?.[r.id] ?? 'edit'} onChange={(e) => {
                          const v = e.target.value as FieldAccess
                          const p = { ...(f.permissions ?? {}) }
                          if (v === 'edit') delete p[r.id]; else p[r.id] = v
                          useModuleStore.getState().updateField(mod.id, f.id, { permissions: Object.keys(p).length ? p : undefined })
                        }}><option value="edit">Can edit</option><option value="view">Read only</option><option value="hidden">Hidden</option></Select>
                      </td>
                    ))}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <NameDialog open={dialog === 'new'} title="New role" label="Role name" description="Starts as a copy of the Viewer role — then tick what it should allow." confirmLabel="Create role" onClose={() => setDialog(null)} onSubmit={(n) => { us.addRole(n, 'role_viewer'); toast.success('Role created') }} />
      <NameDialog open={dialog === 'rename'} title="Rename role" label="Role name" initial={role?.name} onClose={() => setDialog(null)} onSubmit={(n) => role && us.updateRole(role.id, { name: n })} />
    </Page>
  )
}
