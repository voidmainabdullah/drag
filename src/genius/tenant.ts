/**
 * The tenant is the signed-in Supabase user id. Everything the AI layer remembers or caches is keyed by it, so a summary,
 * a cache entry or a prompt context of one tenant can never be read for another.
 */
let tenantId = 'local'

export const getTenantId = () => tenantId
export function setTenantId(id: string | null) {
  tenantId = id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : 'local'
}
