/**
 * Server-side verification of a Supabase access token. We ask Supabase itself (GET /auth/v1/user with the publishable
 * key as `apikey`), so a forged or expired JWT is rejected by the issuer; we never trust a decoded-but-unverified token.
 * No service-role key is involved. The verified user id becomes the tenant id.
 */
export interface SupabaseCfg {
  url: string
  key: string
}

export type AuthResult = { ok: true; userId: string; email?: string } | { ok: false; reason: 'missing' | 'malformed' | 'rejected' | 'unavailable' }

const JWT = /^[A-Za-z0-9_-]{4,2000}\.[A-Za-z0-9_-]{4,3000}\.[A-Za-z0-9_-]{4,2000}$/
const TENANT_SAFE = /^[A-Za-z0-9_-]{1,64}$/

export function bearerToken(header: string | null | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  return m?.[1]
}

export async function verifyAccessToken(token: string | undefined, cfg: SupabaseCfg, f: typeof fetch = fetch): Promise<AuthResult> {
  if (!token) return { ok: false, reason: 'missing' }
  if (!JWT.test(token)) return { ok: false, reason: 'malformed' }
  let res: Response
  try {
    res = await f(`${cfg.url.replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: cfg.key, authorization: `Bearer ${token}` } })
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected' }
  if (!res.ok) return { ok: false, reason: 'unavailable' }
  try {
    const u = (await res.json()) as { id?: string; email?: string }
    if (!u.id || !TENANT_SAFE.test(u.id)) return { ok: false, reason: 'rejected' }
    return { ok: true, userId: u.id, email: u.email }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
