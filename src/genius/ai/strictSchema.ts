import { z } from 'zod'

type Json = Record<string, unknown>

/** keywords strict structured-output engines commonly reject; the same rules are enforced locally by zod after parsing */
const UNSUPPORTED = new Set(['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'format', 'multipleOf', '$schema', 'default', 'examples', 'propertyNames', 'uniqueItems'])

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Convert a zod-generated JSON Schema into the shape strict `json_schema` mode requires:
 *  - every object lists ALL its properties as required and sets additionalProperties:false
 *  - properties that were optional become nullable (the model sends null, `stripNulls` removes it before zod parses)
 *  - oneOf becomes anyOf; validation keywords strict mode rejects are dropped (zod enforces them locally)
 * Pure and deterministic: the same input always produces byte-identical output (it is part of the cached prefix).
 */
export function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema)
  if (!isObj(node)) return node
  const out: Json = {}
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED.has(k)) continue
    if (k === 'oneOf') {
      out.anyOf = toStrictSchema(v)
      continue
    }
    if (k === 'properties' && isObj(v)) {
      const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : [])
      const props: Json = {}
      for (const [pk, pv] of Object.entries(v)) {
        const converted = toStrictSchema(pv)
        props[pk] = required.has(pk) ? converted : { anyOf: [converted, { type: 'null' }] }
      }
      out.properties = props
      out.required = Object.keys(props)
      out.additionalProperties = false
      continue
    }
    if (k === 'required' || k === 'additionalProperties') continue
    out[k] = toStrictSchema(v)
  }
  if (out.type === 'object' && !('properties' in out)) {
    out.properties = {}
    out.required = []
    out.additionalProperties = false
  }
  return out
}

/** Remove `null` object members that only exist because strict mode forced optional fields to be nullable. */
export function stripNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripNulls) as T
  if (isObj(v)) {
    const out: Json = {}
    for (const [k, x] of Object.entries(v)) if (x !== null) out[k] = stripNulls(x)
    return out as T
  }
  return v
}

export function strictJsonSchemaFor(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', reused: 'inline', cycles: 'throw' }) as Json
  return toStrictSchema(raw) as Json
}
