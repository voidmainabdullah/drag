/**
 * Server environment. Secrets (GROQ_API_KEY) are Worker bindings; with `nodejs_compat` they surface on process.env.
 * Only server code imports this file; the key is never returned to, or bundled for, the browser.
 */
export type ServerEnv = Record<string, string | undefined>

export function readServerEnv(): ServerEnv {
  const p = (globalThis as { process?: { env?: ServerEnv } }).process
  return p?.env ? { ...p.env } : {}
}
