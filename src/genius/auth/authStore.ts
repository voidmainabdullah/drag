import { create } from 'zustand'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adoptLegacyData, setStorageNamespace } from '#/services/storage/storageService'
import { setTenantId } from '../tenant'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../supabaseConfig'

/**
 * Supabase email + password auth (publishable key only; no service-role key anywhere).
 * The Supabase user id is the tenant id: it namespaces browser storage (`crm:u:<id>:*`), scopes summaries and caches,
 * and is re-derived by the server from the verified access token (never taken from the browser's word).
 */
export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthStatus
  userId?: string
  email?: string
  /** resolve the persisted session once, on the client */
  init: () => Promise<void>
}

let client: SupabaseClient | null = null
export function getSupabase(): SupabaseClient {
  if (typeof window === 'undefined') throw new Error('Supabase auth is client-only')
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  return client
}

/** Point every storage read/write and the tenant scope at this user. Must run before `initApp`. */
export function applyTenant(userId: string) {
  setStorageNamespace(userId)
  try {
    window.localStorage.setItem('crm:ns', userId)
  } catch {
    /* storage unavailable: the app already warns about that */
  }
  adoptLegacyData(userId)
  setTenantId(userId)
}

let started: Promise<void> | null = null

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  init: () =>
    (started ??= (async () => {
      try {
        const { data } = await getSupabase().auth.getSession()
        const u = data.session?.user
        if (u) {
          applyTenant(u.id)
          set({ status: 'signedIn', userId: u.id, email: u.email ?? undefined })
        } else set({ status: 'signedOut' })
      } catch {
        set({ status: 'signedOut' })
      }
    })()),
}))

/** Access token for server calls (refreshed automatically by supabase-js when it is about to expire). */
export async function getAccessToken(): Promise<string | undefined> {
  try {
    const { data } = await getSupabase().auth.getSession()
    return data.session?.access_token
  } catch {
    return undefined
  }
}

export type AuthOutcome = { ok: true; needsConfirmation?: boolean } | { ok: false; message: string }

const friendly = (m: string): string => {
  if (/invalid login/i.test(m)) return 'That email and password do not match.'
  if (/already registered|already been registered/i.test(m)) return 'An account with that email already exists. Try signing in.'
  if (/password/i.test(m) && /(short|least|weak)/i.test(m)) return 'Choose a longer password (at least 8 characters).'
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.'
  if (/email/i.test(m) && /(invalid|valid)/i.test(m)) return 'Enter a valid email address.'
  if (/fetch|network/i.test(m)) return 'Could not reach the sign-in service. Check your connection.'
  return m || 'Something went wrong. Please try again.'
}

export async function signInWithPassword(email: string, password: string): Promise<AuthOutcome> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password })
  return error ? { ok: false, message: friendly(error.message) } : { ok: true }
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthOutcome> {
  const { data, error } = await getSupabase().auth.signUp({ email: email.trim(), password })
  if (error) return { ok: false, message: friendly(error.message) }
  // with e-mail confirmation switched on there is no session yet
  return { ok: true, needsConfirmation: !data.session }
}

export async function signOut(): Promise<void> {
  try {
    await getSupabase().auth.signOut()
  } finally {
    try {
      window.localStorage.removeItem('crm:ns')
    } catch {
      /* ignore */
    }
    // stores are initialised once per page load: a full reload guarantees no data of this account survives in memory
    window.location.assign('/login')
  }
}
