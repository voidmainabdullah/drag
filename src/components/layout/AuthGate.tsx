import { useEffect, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useHydrated } from '#/hooks/useData'
import { useAuthStore } from '#/genius/auth/authStore'
import { useUserStore } from '#/stores/userStore'
import { useWorkspaceStore } from '#/stores/workspaceStore'
import { ShellSkeleton } from './AppShell'

/**
 * Resolves the Supabase session BEFORE the app boots, so the storage namespace and tenant are set before `initApp`
 * reads anything. `mode`:
 *   app    - requires a session, otherwise redirects to /login
 *   public - public form pages: never redirected; uses the session's namespace when there is one
 *   auth   - /login and /signup: bounced to the app when already signed in
 */
export function AuthGate({ mode, children }: { mode: 'app' | 'public' | 'auth'; children: ReactNode }) {
  const hydrated = useHydrated()
  const status = useAuthStore((s) => s.status)
  const init = useAuthStore((s) => s.init)
  const navigate = useNavigate()

  useEffect(() => {
    if (hydrated) void init()
  }, [hydrated, init])

  useEffect(() => {
    if (status === 'signedOut' && mode === 'app') void navigate({ to: '/login', replace: true })
    if (status === 'signedIn' && mode === 'auth') void navigate({ to: '/', replace: true })
  }, [status, mode, navigate])

  if (!hydrated || status === 'loading') return <ShellSkeleton />
  if (status === 'signedOut' && mode === 'app') return <ShellSkeleton />
  if (status === 'signedIn' && mode === 'auth') return <ShellSkeleton />
  return (
    <>
      {status === 'signedIn' && mode !== 'auth' && <SyncLocalUser />}
      {children}
    </>
  )
}

/** The default local member takes the account's email (it was a placeholder before accounts existed). */
function SyncLocalUser() {
  const email = useAuthStore((s) => s.email)
  const ready = useWorkspaceStore((s) => s.ready)
  useEffect(() => {
    if (!ready || !email) return
    const { users, updateUser } = useUserStore.getState()
    const first = users[0]
    if (first && users.length === 1 && first.email !== email) updateUser(first.id, { email })
  }, [ready, email])
  return null
}
