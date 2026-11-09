import type { CrmRecord, Module } from '#/types'
import type { FormulaSpec } from './ast'
import { evaluateFormulaField, type FieldInfo, type FormulaHost, type RecData, type Value } from './eval'
import { Decimal } from './decimal'

/** Minimal shape of the app's evaluation context (see utils/records.ts `Ctx`). */
interface CtxLike {
  modules: Map<string, Module>
  records: Map<string, CrmRecord>
}

const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])
const live = (r: CrmRecord | undefined): r is CrmRecord => !!r && !r.deletedAt && !r.archived

class AppHost implements FormulaHost {
  private byModule = new Map<string, CrmRecord[]>()
  private reverseIdx = new Map<string, Map<string, CrmRecord[]>>()
  private memo = new Map<string, Value>()
  today: string
  constructor(
    private ctx: CtxLike,
    private legacy: (m: Module, r: CrmRecord, fieldId: string) => unknown,
  ) {
    this.today = new Date().toISOString().slice(0, 10)
  }
  get values() {
    return this.memo
  }
  field(moduleId: string, fieldId: string): FieldInfo | undefined {
    return this.ctx.modules.get(moduleId)?.fields.find((f) => f.id === fieldId)
  }
  hasModule(moduleId: string) {
    return this.ctx.modules.has(moduleId)
  }
  private moduleRecords(moduleId: string): CrmRecord[] {
    let list = this.byModule.get(moduleId)
    if (!list) {
      list = []
      for (const r of this.ctx.records.values()) if (r.moduleId === moduleId && live(r)) list.push(r)
      this.byModule.set(moduleId, list)
    }
    return list
  }
  reverse(moduleId: string, viaFieldId: string, targetRecordId: string): RecData[] {
    const key = `${moduleId}|${viaFieldId}`
    let idx = this.reverseIdx.get(key)
    if (!idx) {
      idx = new Map()
      for (const r of this.moduleRecords(moduleId)) {
        for (const id of new Set(toIds(r.data[viaFieldId]))) {
          const bucket = idx.get(id)
          if (bucket) bucket.push(r)
          else idx.set(id, [r])
        }
      }
      this.reverseIdx.set(key, idx)
    }
    return idx.get(targetRecordId) ?? []
  }
  linked(_moduleId: string, fieldId: string, record: RecData): RecData[] {
    return toIds(record.data[fieldId])
      .map((id) => this.ctx.records.get(id))
      .filter(live)
  }
  legacyFormula(moduleId: string, fieldId: string, record: RecData): unknown {
    const m = this.ctx.modules.get(moduleId)
    const r = this.ctx.records.get(record.id) ?? (record as CrmRecord)
    return m ? this.legacy(m, r, fieldId) : null
  }
}

const hosts = new WeakMap<object, AppHost>()

/** One host (indexes + memo) per evaluation context, so a table of N rows does not rescan all records N times. */
function hostFor(ctx: CtxLike, legacy: (m: Module, r: CrmRecord, fieldId: string) => unknown): AppHost {
  let h = hosts.get(ctx)
  if (!h) {
    h = new AppHost(ctx, legacy)
    hosts.set(ctx, h)
  }
  return h
}

export type SpecValue = number | string | boolean | null | { error: string }

/** Evaluate a decimal formula field of a stored record (used by utils/records.valueOf). */
export function evaluateSpecField(
  ctx: CtxLike,
  m: Module,
  r: CrmRecord,
  spec: FormulaSpec,
  legacy: (m: Module, r: CrmRecord, fieldId: string) => unknown,
): SpecValue {
  const host = hostFor(ctx, legacy)
  const res = evaluateFormulaField(host, m.id, r, spec, host.values)
  if (!res.ok) return { error: res.error?.message ?? 'Calculation failed' }
  const v = res.value
  if (v instanceof Decimal) return v.toNumber()
  return v
}
