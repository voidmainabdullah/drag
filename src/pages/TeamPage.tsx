import { useState } from 'react'
import { z } from 'zod'
import type { User } from '#/types'
import { useCurrentUser, usePerms, useRoles, useUsers } from '#/hooks/useData'
import { useUserStore } from '#/stores/userStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Avatar, Badge, EmptyState, Notice, PageHeader } from '#/components/ui/misc'
import { Field, Input, SearchInput, Select } from '#/components/ui/controls'

const emailSchema = z.string().trim().email()

function UserDialog({ user, onClose }: { user: User | 'new'; onClose: () => void }) {
  const roles = useRoles()
  const users = useUsers()
  const editing = user !== 'new' ? user : null
  const [name, setName] = useState(editing?.name ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [roleId, setRoleId] = useState(editing?.roleId ?? 'role_member')
  const [error, setError] = useState('')
  const save = () => {
    if (!name.trim()) return setError('Name is required')
    const ok = emailSchema.safeParse(email)
    if (!ok.success) return setError('Enter a valid email address')
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.id !== editing?.id)) return setError('Another team member already uses this email')
    if (editing) {
      const owners = users.filter((u) => u.roleId === 'role_owner')
      if (editing.roleId === 'role_owner' && roleId !== 'role_owner' && owners.length <= 1) return setError('There must be at least one Owner')
      useUserStore.getState().updateUser(editing.id, { name: name.trim(), email: email.trim(), roleId })
      toast.success('Member updated')
    } else {
      useUserStore.getState().addUser({ name: name.trim(), email: email.trim(), roleId })
      toast.success('Member added', 'They exist only in this browser — there is no invite email.')
    }
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={editing ? 'Edit team member' : 'Add team member'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{editing ? 'Save' : 'Add member'}</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input autoFocus value={name} onChange={(e) => { setName(e.target.value); setError('') }} /></Field>
        <Field label="Email" required><Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }} onKeyDown={(e) => e.key === 'Enter' && save()} /></Field>
        <Field label="Role"><Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

export function TeamPage() {
  const users = useUsers()
  const roles = useRoles()
  const me = useCurrentUser()
  const perms = usePerms()
  const [q, setQ] = useState('')
  const [dialog, setDialog] = useState<User | 'new' | null>(null)
  const canManage = perms.can('accessSettings')
  const list = users.filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))

  const remove = async (u: User) => {
    if (u.id === me?.id) return toast.error('You can’t remove the account you’re using', 'Switch to another member first.')
    if (u.roleId === 'role_owner' && users.filter((x) => x.roleId === 'role_owner').length <= 1) return toast.error('There must be at least one Owner')
    if (await confirmDialog({ title: `Remove ${u.name}?`, message: 'Records they created keep working; fields assigned to them will show as unassigned.', confirmLabel: 'Remove', danger: true })) {
      useUserStore.getState().removeUser(u.id)
      toast.success('Member removed')
    }
  }

  return (
    <Page title="Team" skeleton="table">
      <PageHeader title="Team" icon="Users" description="People in this workspace and the role each one has."
        actions={canManage && <Button variant="gradient" icon="UserPlus" onClick={() => setDialog('new')}>Add member</Button>} />
      <div className="mb-4"><Notice>You sign in with your own account, but Xcrm is local-first: there are no invitations and no shared team data. Team members are profiles stored in this browser, under your account. Use <strong>Switch to</strong> to act as another member and see what their role allows.</Notice></div>
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search members…" className="max-w-xs" /></div>
      {list.length === 0 ? <EmptyState icon="Users" title="No members found" /> : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-4 py-2.5 text-left">Member</th><th className="px-4 py-2.5 text-left">Role</th><th className="hidden px-4 py-2.5 text-left sm:table-cell">Added</th><th /></tr></thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={u.name} color={u.color} /><div className="min-w-0"><div className="flex items-center gap-2 font-medium">{u.name}{u.id === me?.id && <Badge color="#2DB67D">Current</Badge>}</div><div className="truncate text-xs text-muted">{u.email}</div></div></div></td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <Select aria-label={`Role for ${u.name}`} className="h-8 w-40" value={u.roleId} onChange={(e) => {
                        if (u.roleId === 'role_owner' && e.target.value !== 'role_owner' && users.filter((x) => x.roleId === 'role_owner').length <= 1) return toast.error('There must be at least one Owner')
                        useUserStore.getState().updateUser(u.id, { roleId: e.target.value })
                        toast.success('Role updated')
                      }}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                    ) : <Badge>{roles.find((r) => r.id === u.roleId)?.name}</Badge>}
                  </td>
                  <td className="hidden px-4 py-3 text-muted sm:table-cell">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      {u.id !== me?.id && <Button size="xs" onClick={() => { useSettingsStore.getState().setCurrentUser(u.id); toast.info(`Now acting as ${u.name}`, 'Permissions follow their role.') }}>Switch to</Button>}
                      {canManage && <Button size="xs" onClick={() => setDialog(u)}>Edit</Button>}
                      {canManage && <Button size="xs" variant="ghost" onClick={() => void remove(u)} aria-label={`Remove ${u.name}`}>Remove</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && <UserDialog user={dialog} onClose={() => setDialog(null)} />}
    </Page>
  )
}
