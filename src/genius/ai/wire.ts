import { z } from 'zod'
import type { GenerateOutcome } from './generate'

/** The contract between the browser and the `geniusGenerate` server function. Shared so both sides validate the same shape. */
const SafeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

export const GenerateWire = z.object({
  workspaceId: SafeId,
  correlationId: z.string().min(4).max(60),
  operation: z.enum(['new_build', 'modify', 'repair', 'question']),
  kind: z.enum(['blueprint', 'patch', 'answer']),
  mode: z.enum(['generate', 'repair']),
  tier: z.enum(['fast', 'strong']),
  variable: z.object({
    request: z.string().min(1).max(8000),
    project: z.unknown().optional(),
    context: z.unknown().optional(),
    memory: z.unknown().optional(),
    meta: z
      .object({ projectId: z.string().max(80), revisionId: z.string().max(80), currency: z.string().max(3).optional(), locale: z.string().max(12).optional(), timezone: z.string().max(60).optional(), today: z.string().max(10) })
      .optional(),
    previous: z.unknown().optional(),
    errors: z.unknown().optional(),
  }),
})
export type GenerateWire = z.infer<typeof GenerateWire>

/** Upper bound for the variable part of one request (characters of JSON). Larger input is rejected, never silently cut. */
export const MAX_VARIABLE_CHARS = 150_000

/** `preservedRequest` echoes the user's text back on failure so the UI can restore the prompt box. */
export type GenerateResponse = GenerateOutcome & { provider: 'groq' | 'mock'; preservedRequest?: string }
export type TransportFailure = { ok: false; code: 'auth_required' | 'rate_limited' | 'too_large' | 'unavailable' | 'bad_request'; message: string; retryable: boolean; preservedRequest?: string }
export type Transport = (req: GenerateWire) => Promise<GenerateResponse | TransportFailure>
