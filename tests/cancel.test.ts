import { beforeEach, describe, expect, it } from 'vitest'
import { useModuleStore } from '#/stores/moduleStore'
import { runGenius } from '#/genius/service/run'
import type { Transport } from '#/genius/ai/wire'
import { resetWorld, WS } from './helpers'

describe('cancelling a run', () => {
  beforeEach(() => resetWorld())

  it('stops waiting, reports "cancelled", and nothing is applied even if the server answers later', async () => {
    let release: () => void = () => {}
    let calls = 0
    const slow: Transport = () => {
      calls++
      return new Promise((resolve) => {
        release = () => resolve({ ok: true, envelope: { status: 'ok', summary: 'late', assumptions: [], questions: [] } as never, calls: 1, attempts: 1, latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, models: ['mock'], escalated: false, provider: 'mock' })
      })
    }
    const ctl = new AbortController()
    const p = runGenius({ workspaceId: WS, request: 'Create a CRM for my gym in GBP with members and classes', signal: ctl.signal, answers: [{ questionId: 'currency', question: 'Currency?', answer: 'GBP', at: new Date().toISOString() }] }, { transport: slow })
    await new Promise((r) => setTimeout(r, 20))
    ctl.abort()
    const out = await p
    release()
    expect(out.kind).toBe('error')
    expect(out.kind === 'error' && out.message).toMatch(/Cancelled/)
    expect(calls).toBeLessThanOrEqual(1)
    expect(useModuleStore.getState().modules).toHaveLength(0)
  })

  it('an already-cancelled run never calls the server', async () => {
    let calls = 0
    const t: Transport = async () => {
      calls++
      throw new Error('should not be called')
    }
    const ctl = new AbortController()
    ctl.abort()
    const out = await runGenius({ workspaceId: WS, request: 'Create a CRM for my gym in GBP with members and classes', signal: ctl.signal, answers: [{ questionId: 'currency', question: 'Currency?', answer: 'GBP', at: new Date().toISOString() }] }, { transport: t })
    expect(out.kind).toBe('error')
    expect(calls).toBe(0)
  })
})
