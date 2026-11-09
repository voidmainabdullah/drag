import type { Template } from '#/types'
import { KEYS, readJson, writeJson } from './storageService'

/** Only user-created / duplicated templates are persisted. Built-in templates live in code. */
export const templateStorage = {
  load: (): Template[] => {
    const v = readJson<unknown>(KEYS.templates, [])
    return Array.isArray(v) ? (v as Template[]) : []
  },
  save: (v: Template[]) => writeJson(KEYS.templates, v),
}
