import type { CrmRecord } from '#/types'

export type RecordEventType = 'created' | 'updated' | 'deleted'

export interface RecordEvent {
  type: RecordEventType
  record: CrmRecord
  previous?: CrmRecord
  /** recursion depth for workflow-triggered writes */
  depth: number
  /** unique per emitted event: a duplicate delivery of the same event carries the same id and is ignored by workflows */
  eventId?: string
  /** ids of the workflows that caused this write, so a workflow can never re-enter itself */
  chain?: string[]
}

type Listener = (e: RecordEvent) => void
const listeners = new Set<Listener>()
let seq = 0

export function onRecordEvent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function emitRecordEvent(e: RecordEvent) {
  const ev: RecordEvent = { ...e, eventId: e.eventId ?? `evt_${Date.now().toString(36)}_${(seq++).toString(36)}` }
  listeners.forEach((fn) => {
    try {
      fn(ev)
    } catch (err) {
      console.error('record event listener failed', err)
    }
  })
}
