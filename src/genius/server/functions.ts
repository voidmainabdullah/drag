import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { GenerateWire } from '../ai/wire'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../supabaseConfig'
import { bearerToken } from './auth'
import { readServerEnv } from './env'
import { generateHandler, healthHandler, type ServerDeps } from './handlers'

/**
 * Server functions. Each one reads the Supabase access token from the Authorization header, verifies it with Supabase,
 * and uses the verified user id as the tenant. GROQ_API_KEY is read here, on the server, and never leaves it.
 */
const deps = (): ServerDeps => ({ env: readServerEnv(), supabase: { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY } })
const token = () => bearerToken(getRequestHeader('authorization'))

/** Ask the model to design / repair (one step). The client validates, previews and applies; the server never writes configuration. */
export const geniusGenerate = createServerFn({ method: 'POST' })
  .validator((d: unknown) => GenerateWire.parse(d))
  // the result contains model-authored JSON (`unknown` to the type system); the client re-types it as GenerateResponse
  .handler(async ({ data }): Promise<Record<string, any>> => (await generateHandler(deps(), token(), data)) as Record<string, any>)

/** Is the AI configured, and who am I (tenant)? Never returns the key. */
export const geniusHealth = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({}).passthrough().parse(d ?? {}))
  .handler(async () => healthHandler(deps(), token()))
