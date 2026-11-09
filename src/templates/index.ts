import type { Template } from '#/types'
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES } from './library'
import { coreTemplate } from './core'

export { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES, coreTemplate }

export function findTemplate(id: string, user: Template[]): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? user.find((t) => t.id === id)
}
