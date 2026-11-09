import { create } from 'zustand'
import { appendAudit } from './audit'
import { emptyGenius, type AuditEntry, type GeniusPersisted, type GeniusVersion, type ProjectMemory, type Proposal, type QuestionAnswer } from './types'
import type { Question } from '../blueprint/schema'

interface GeniusState extends GeniusPersisted {
  setAll: (g: GeniusPersisted) => void
  audit1: (e: Omit<AuditEntry, 'id' | 'prevHash' | 'hash' | 'at'>) => void
  addVersion: (v: GeniusVersion) => void
  patchVersion: (id: string, p: Partial<GeniusVersion>) => void
  putProposal: (p: Proposal) => void
  patchProposal: (id: string, p: Partial<Proposal>) => void
  memoryOf: (ws: string) => ProjectMemory
  patchMemory: (ws: string, fn: (m: ProjectMemory) => ProjectMemory) => void
  rememberRequest: (ws: string, text: string, intent: string) => void
  recordAnswers: (ws: string, answers: QuestionAnswer[]) => void
  setPending: (ws: string, q: Question[]) => void
}

export const emptyMemory = (ws: string): ProjectMemory => ({ workspaceId: ws, requirements: [], answers: [], pendingQuestions: [], assumptions: [], requests: [] })

/**
 * Builder state: version history, proposals, audit log and project memory.
 * Persisted through the same debounced autosave as every other store (and therefore namespaced per signed-in user).
 */
export const useGeniusStore = create<GeniusState>((set, get) => ({
  ...emptyGenius(),
  setAll: (g) => set({ v: 1, versions: g.versions, proposals: g.proposals, audit: g.audit, memory: g.memory }),
  audit1: (e) => set((s) => ({ audit: appendAudit(s.audit, e) })),
  addVersion: (v) => set((s) => ({ versions: [...s.versions, v] })),
  patchVersion: (id, p) => set((s) => ({ versions: s.versions.map((v) => (v.id === id ? { ...v, ...p } : v)) })),
  putProposal: (p) => set((s) => ({ proposals: s.proposals.some((x) => x.id === p.id) ? s.proposals.map((x) => (x.id === p.id ? p : x)) : [...s.proposals, p] })),
  patchProposal: (id, p) => set((s) => ({ proposals: s.proposals.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
  memoryOf: (ws) => get().memory[ws] ?? emptyMemory(ws),
  patchMemory: (ws, fn) => set((s) => ({ memory: { ...s.memory, [ws]: fn(s.memory[ws] ?? emptyMemory(ws)) } })),
  rememberRequest: (ws, text, intent) =>
    get().patchMemory(ws, (m) => ({ ...m, requests: [...m.requests, { at: new Date().toISOString(), text: text.slice(0, 600), intent }].slice(-30) })),
  recordAnswers: (ws, answers) =>
    get().patchMemory(ws, (m) => {
      const ids = new Set(answers.map((a) => a.questionId))
      return { ...m, answers: [...m.answers.filter((a) => !ids.has(a.questionId)), ...answers], pendingQuestions: m.pendingQuestions.filter((q) => !ids.has(q.id)) }
    }),
  setPending: (ws, q) => get().patchMemory(ws, (m) => ({ ...m, pendingQuestions: q })),
}))
