import type { Module } from '#/types'
import { SCHEMA_VERSION, type Patch } from '../blueprint/schema'
import { slugName } from '../compiler/ids'
import { revisionOf, type ConfigModel } from '../config/model'
import { RESERVED_FIELD_IDS } from '../registry'
import type { Actor } from '../permissions/policy'
import { visibleConfig } from '../ai/context-manager'

/**
 * Requests small and exact enough to be turned into a patch by plain code: rename a module or field, add a plain field,
 * switch a workflow off. No model call, no guessing: anything ambiguous returns null and goes to the model path.
 * The patch still goes through the same validation, diff, accept and versioning as a model-made one.
 */
export interface SimplePatch {
  patch: Patch
  summary: string
  assumptions: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/["'`]/g, '').replace(/\s+/g, ' ').trim()
const stem = (w: string) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const same = (a: string, b: string) => norm(a).split(' ').map(stem).join(' ') === norm(b).split(' ').map(stem).join(' ')
const title = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()).slice(0, 80)

function findModule(mods: Module[], name: string): Module | undefined {
  const hits = mods.filter((m) => same(m.name, name) || (m.singularName && same(m.singularName, name)))
  return hits.length === 1 ? hits[0] : undefined
}

const TYPE_WORDS: [RegExp, string][] = [
  [/\b(long text|notes?|comments?|description|details)\b/, 'longText'],
  [/\b(e-?mail)\b/, 'email'],
  [/\b(phone|mobile|telephone|tel)\b/, 'phone'],
  [/\b(website|url|link)\b/, 'website'],
  [/\b(date|birthday|deadline|due)\b/, 'date'],
  [/\b(yes ?\/? ?no|checkbox|tick ?box|boolean)\b/, 'yesNo'],
  [/\b(number|count|quantity|age|total)\b/, 'number'],
  [/\b(text|name|title)\b/, 'shortText'],
]

const mk = (cfg: ConfigModel, summary: string, ops: Patch['ops'], assumptions: string[] = []): SimplePatch => ({
  patch: { schemaVersion: SCHEMA_VERSION, expected_revision: revisionOf(cfg), summary, ops },
  summary,
  assumptions,
})

export function simplePatch(cfg: ConfigModel, actor: Actor, request: string): SimplePatch | null {
  const vis = visibleConfig(cfg, actor)
  const mods = vis.modules.filter((m) => !m.system)
  const t = request.trim().replace(/[.!]+$/, '')

  // turn off / switch off / disable the <workflow>
  const off = /^(?:please )?(?:turn off|switch off|disable|deactivate|stop)\s+(?:the\s+)?(.+?)(?:\s+(?:workflow|automation|rule))?$/i.exec(t)
  if (off) {
    const hits = vis.workflows.filter((w) => same(w.name, off[1]) || norm(w.name).includes(norm(off[1])))
    if (hits.length === 1) return mk(cfg, `Switch off "${hits[0].name}"`, [{ op: 'disable_workflow', id: hits[0].id }])
    return null
  }

  // rename [the] [module] A to B
  const renMod = /^(?:please )?rename\s+(?:the\s+)?(?:module\s+)?(.+?)(?:\s+module)?\s+to\s+(.+)$/i.exec(t)
  if (renMod && !/\b(field|column)\b/i.test(renMod[1]) && !/\b(?:in|on|of)\s/i.test(renMod[1])) {
    const m = findModule(mods, renMod[1])
    const to = title(renMod[2])
    if (m && to && !same(m.name, to) && !mods.some((x) => same(x.name, to))) {
      const plural = to
      const singular = /ies$/i.test(to) ? `${to.slice(0, -3)}y` : /(?<!s)s$/i.test(to) ? to.slice(0, -1) : to
      return mk(cfg, `Rename ${m.name} to ${plural}`, [{ op: 'update_module', id: m.id, changes: { singular, plural } }], [`The singular form is "${singular}".`])
    }
    return null
  }

  // rename [the] <field> field (in|on|of) <module> to B
  const renField = /^(?:please )?rename\s+(?:the\s+)?(.+?)\s+(?:field|column)\s+(?:in|on|of)\s+(?:the\s+)?(.+?)(?:\s+module)?\s+to\s+(.+)$/i.exec(t)
  if (renField) {
    const m = findModule(mods, renField[2])
    const f = m?.fields.filter((x) => same(x.label, renField[1]) || x.id === slugName(renField[1]))
    const to = title(renField[3])
    if (m && f?.length === 1 && to && !f[0].readOnly) return mk(cfg, `Rename ${m.name} › ${f[0].label} to ${to}`, [{ op: 'update_field', moduleId: m.id, id: f[0].id, changes: { label: to } }], ['Only the label changes; the field keeps its id, so formulas, forms and workflows keep working.'])
    return null
  }

  // add [a] [<type>] field [called|named] <name> to <module>   |   add [a] <name> field to <module>
  const add = /^(?:please )?add\s+(?:an?\s+)?(?:(.+?)\s+field\s+(?:called|named)\s+(.+?)|(?:field\s+(?:called|named)\s+)?(.+?)(?:\s+field)?)\s+(?:to|on|in)\s+(?:the\s+)?(.+?)(?:\s+module)?$/i.exec(t)
  if (add) {
    const typeHint = add[1] ?? ''
    const name = title(add[2] ?? add[3] ?? '')
    const m = findModule(mods, add[4])
    if (!m || !name || name.length < 2 || /\b(formula|calculated|currency|money|amount|relationship|link to|dropdown|status|stage)\b/i.test(`${typeHint} ${name}`)) return null
    const id = slugName(name)
    if (RESERVED_FIELD_IDS.has(id) || m.fields.some((f) => f.id === id || same(f.label, name))) return null
    const hit = TYPE_WORDS.find(([re]) => re.test(norm(`${typeHint} ${name}`)))
    const type = hit?.[1] ?? 'shortText'
    return mk(cfg, `Add "${name}" (${type}) to ${m.name}`, [{ op: 'add_field', moduleId: m.id, field: { id, label: name, type: type as never } }], hit ? [] : ['No type was given, so it is plain text.'])
  }
  return null
}
