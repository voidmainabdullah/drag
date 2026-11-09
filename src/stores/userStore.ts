import { create } from 'zustand'
import type { ID, PermissionKey, Role, User } from '#/types'
import { defaultRoles } from '#/services/storage/settingsStorage'
import { uid, nowIso } from '#/utils/id'
import { OPTION_COLORS } from '#/utils/fieldTypes'

interface UserState {
  users: User[]
  roles: Role[]
  setAll: (u: User[], r: Role[]) => void
  addUser: (u: { name: string; email: string; roleId: ID }) => User
  updateUser: (id: ID, patch: Partial<User>) => void
  removeUser: (id: ID) => void
  addRole: (name: string, copyFrom?: ID) => Role
  updateRole: (id: ID, patch: Partial<Omit<Role, 'id'>>) => void
  setRolePermission: (id: ID, key: PermissionKey, value: boolean) => void
  removeRole: (id: ID) => void
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  roles: defaultRoles(),
  setAll: (users, roles) => set({ users, roles }),
  addUser: (u) => {
    const user: User = { id: uid('usr'), ...u, color: OPTION_COLORS[get().users.length % OPTION_COLORS.length], createdAt: nowIso() }
    set((s) => ({ users: [...s.users, user] }))
    return user
  },
  updateUser: (id, patch) => set((s) => ({ users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) })),
  removeUser: (id) => set((s) => ({ users: s.users.filter((u) => u.id !== id) })),
  addRole: (name, copyFrom) => {
    const base = get().roles.find((r) => r.id === copyFrom)
    const role: Role = {
      id: uid('role'),
      name,
      permissions: base ? { ...base.permissions } : { ...get().roles.find((r) => r.id === 'role_viewer')!.permissions },
    }
    set((s) => ({ roles: [...s.roles, role] }))
    return role
  },
  updateRole: (id, patch) => set((s) => ({ roles: s.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
  setRolePermission: (id, key, value) =>
    set((s) => ({ roles: s.roles.map((r) => (r.id === id ? { ...r, permissions: { ...r.permissions, [key]: value } } : r)) })),
  removeRole: (id) => set((s) => ({ roles: s.roles.filter((r) => r.id !== id) })),
}))
