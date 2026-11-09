import type { GenerateResponse, GenerateWire, Transport, TransportFailure } from '../ai/wire'
import { getAccessToken } from '../auth/authStore'
import { geniusGenerate, geniusHealth } from '../server/functions'

/** The real transport: a server function call carrying the Supabase access token as a Bearer header. */
export const httpTransport: Transport = async (req: GenerateWire): Promise<GenerateResponse | TransportFailure> => {
  const token = await getAccessToken()
  if (!token) return { ok: false, code: 'auth_required', message: 'Please sign in to use Genius AI. Your CRM is unchanged.', retryable: false, preservedRequest: req.variable.request }
  try {
    return (await geniusGenerate({ data: req, headers: { authorization: `Bearer ${token}` } })) as unknown as GenerateResponse | TransportFailure
  } catch {
    return { ok: false, code: 'unavailable', message: 'Could not reach the server. Your CRM is unchanged.', retryable: true, preservedRequest: req.variable.request }
  }
}

export async function fetchHealth() {
  const token = await getAccessToken()
  return geniusHealth({ data: {}, headers: token ? { authorization: `Bearer ${token}` } : undefined })
}
