import type { Activity, CrmRecord } from '#/types'
import { KEYS, readJson, writeJson } from './storageService'

const arr = <T>(key: string): T[] => {
  const v = readJson<unknown>(key, [])
  return Array.isArray(v) ? (v as T[]) : []
}

export const recordStorage = {
  loadRecords: () => arr<CrmRecord>(KEYS.records),
  saveRecords: (v: CrmRecord[]) => writeJson(KEYS.records, v),
  loadActivities: () => arr<Activity>(KEYS.activities),
  saveActivities: (v: Activity[]) => writeJson(KEYS.activities, v),
}
