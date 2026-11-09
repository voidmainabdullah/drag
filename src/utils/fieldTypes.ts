import { z } from 'zod'
import type { Field, FieldType, FilterOp, FileMeta, SelectOption } from '#/types'
import { slug, uid } from './id'

export interface FieldTypeDef {
  type: FieldType
  label: string
  icon: string
  group: 'Text' | 'Numbers' | 'Date & time' | 'Choice' | 'Media' | 'Advanced'
  hint: string
}

export const FIELD_TYPES: FieldTypeDef[] = [
  { type: 'shortText', label: 'Short text', icon: 'Type', group: 'Text', hint: 'Single line of text' },
  { type: 'longText', label: 'Long text', icon: 'AlignLeft', group: 'Text', hint: 'Multi-line notes' },
  { type: 'email', label: 'Email', icon: 'Mail', group: 'Text', hint: 'Validated email address' },
  { type: 'phone', label: 'Phone', icon: 'Phone', group: 'Text', hint: 'Phone number' },
  { type: 'website', label: 'Website', icon: 'Globe', group: 'Text', hint: 'URL' },
  { type: 'address', label: 'Address', icon: 'MapPin', group: 'Text', hint: 'Street, city, state, zip, country' },
  { type: 'password', label: 'Password', icon: 'KeyRound', group: 'Text', hint: 'Masked text (stored locally in plain text)' },
  { type: 'number', label: 'Number', icon: 'Hash', group: 'Numbers', hint: 'Integer or decimal' },
  { type: 'currency', label: 'Currency', icon: 'DollarSign', group: 'Numbers', hint: 'Money amount' },
  { type: 'percentage', label: 'Percentage', icon: 'Percent', group: 'Numbers', hint: '0 - 100 %' },
  { type: 'rating', label: 'Rating', icon: 'Star', group: 'Numbers', hint: 'Star rating' },
  { type: 'date', label: 'Date', icon: 'Calendar', group: 'Date & time', hint: 'Calendar date' },
  { type: 'datetime', label: 'Date & time', icon: 'CalendarClock', group: 'Date & time', hint: 'Date with time' },
  { type: 'time', label: 'Time', icon: 'Clock', group: 'Date & time', hint: 'Time of day' },
  { type: 'dropdown', label: 'Dropdown', icon: 'ChevronDownSquare', group: 'Choice', hint: 'Pick one option' },
  { type: 'multiSelect', label: 'Multi-select', icon: 'ListChecks', group: 'Choice', hint: 'Pick several options' },
  { type: 'radio', label: 'Radio', icon: 'CircleDot', group: 'Choice', hint: 'Pick one (radio buttons)' },
  { type: 'checkboxes', label: 'Checkboxes', icon: 'CheckSquare', group: 'Choice', hint: 'Pick several (checkboxes)' },
  { type: 'yesNo', label: 'Yes / No', icon: 'ToggleLeft', group: 'Choice', hint: 'Boolean toggle' },
  { type: 'tags', label: 'Tags', icon: 'Tags', group: 'Choice', hint: 'Free-form tags' },
  { type: 'color', label: 'Colour', icon: 'Palette', group: 'Choice', hint: 'Colour picker' },
  { type: 'file', label: 'File upload', icon: 'Paperclip', group: 'Media', hint: 'Any file' },
  { type: 'image', label: 'Image upload', icon: 'Image', group: 'Media', hint: 'Image files' },
  { type: 'document', label: 'Document upload', icon: 'FileText', group: 'Media', hint: 'PDF / Word / Excel' },
  { type: 'signature', label: 'Signature', icon: 'PenLine', group: 'Media', hint: 'Draw a signature' },
  { type: 'user', label: 'User', icon: 'User', group: 'Advanced', hint: 'Pick a team member' },
  { type: 'relationship', label: 'Relationship', icon: 'Link2', group: 'Advanced', hint: 'Link to records in another module' },
  { type: 'formula', label: 'Formula', icon: 'Sigma', group: 'Advanced', hint: 'Calculated from other fields' },
  { type: 'autoId', label: 'Auto ID', icon: 'Fingerprint', group: 'Advanced', hint: 'Auto-generated identifier' },
]

export const FIELD_TYPE_MAP: Record<FieldType, FieldTypeDef> = Object.fromEntries(
  FIELD_TYPES.map((t) => [t.type, t]),
) as Record<FieldType, FieldTypeDef>

export const OPTION_COLORS = ['#7B68EE', '#FD71AF', '#2DB67D', '#F5A524', '#3B9DF8', '#EF4444', '#14B8A6', '#A855F7', '#64748B', '#F97316']

export const OPERATORS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: 'equals', label: 'equals', needsValue: true },
  { op: 'not_equals', label: 'does not equal', needsValue: true },
  { op: 'contains', label: 'contains', needsValue: true },
  { op: 'not_contains', label: 'does not contain', needsValue: true },
  { op: 'greater', label: 'is greater than', needsValue: true },
  { op: 'less', label: 'is less than', needsValue: true },
  { op: 'empty', label: 'is empty', needsValue: false },
  { op: 'not_empty', label: 'is not empty', needsValue: false },
]

export const isSingleRel = (f: Field) => !f.relation || f.relation.cardinality === 'one-to-one' || f.relation.cardinality === 'many-to-one'
export const isChoiceType = (t: FieldType) => ['dropdown', 'radio', 'multiSelect', 'checkboxes'].includes(t)
export const isSingleChoice = (t: FieldType) => t === 'dropdown' || t === 'radio'
export const isMultiValue = (t: FieldType) => ['multiSelect', 'checkboxes', 'tags', 'file', 'image', 'document'].includes(t)
export const isNumericType = (t: FieldType) => ['number', 'currency', 'percentage', 'rating', 'formula'].includes(t)
export const isDateType = (t: FieldType) => t === 'date' || t === 'datetime'
export const isFileType = (t: FieldType) => t === 'file' || t === 'image' || t === 'document'

export function makeOptions(labels: string[]): SelectOption[] {
  return labels.map((label, i) => ({ id: slug(label) + (labels.indexOf(label) === i ? '' : `_${i}`), label, color: OPTION_COLORS[i % OPTION_COLORS.length] }))
}

export function createField(type: FieldType, order: number, label?: string): Field {
  const def = FIELD_TYPE_MAP[type]
  const lbl = label ?? def.label
  const f: Field = {
    id: uid('fld'),
    name: slug(lbl),
    label: lbl,
    type,
    width: 'full',
    order,
  }
  if (isChoiceType(type)) f.options = makeOptions(['Option 1', 'Option 2', 'Option 3'])
  if (type === 'currency') f.currency = 'USD'
  if (type === 'autoId') {
    f.idPrefix = 'ID'
    f.readOnly = true
  }
  if (type === 'formula') {
    f.formula = ''
    f.readOnly = true
  }
  if (type === 'rating') f.max = 5
  if (type === 'percentage') {
    f.min = 0
    f.max = 100
  }
  return f
}

export function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every((x) => x === '' || x == null)
  return false
}

export function defaultValueFor(field: Field): unknown {
  if (field.defaultValue !== undefined && field.defaultValue !== '') {
    if (field.defaultValue === '{{today}}') return new Date().toISOString().slice(0, 10)
    return field.defaultValue
  }
  switch (field.type) {
    case 'yesNo':
      return false
    case 'multiSelect':
    case 'checkboxes':
    case 'tags':
    case 'file':
    case 'image':
    case 'document':
      return []
    case 'address':
      return { street: '', city: '', state: '', zip: '', country: '' }
    case 'relationship':
      return isSingleRel(field) ? '' : []
    default:
      return ''
  }
}

const reqMsg = 'This field is required'

/** Builds a zod schema for a single field (honours required, min/max, options, etc.). */
export function buildFieldSchema(field: Field): z.ZodType {
  let base: z.ZodType
  const label = field.label
  switch (field.type) {
    case 'shortText':
    case 'longText':
    case 'password': {
      let s = z.string({ error: reqMsg })
      if (field.minLength) s = s.min(field.minLength, `${label} must be at least ${field.minLength} characters`)
      if (field.maxLength) s = s.max(field.maxLength, `${label} must be at most ${field.maxLength} characters`)
      base = s
      break
    }
    case 'email':
      base = z.string({ error: reqMsg }).email('Enter a valid email address')
      break
    case 'phone':
      base = z
        .string({ error: reqMsg })
        .regex(/^[+()\-.\s0-9xX#]{5,25}$/, 'Enter a valid phone number')
      break
    case 'website':
      base = z.string({ error: reqMsg }).refine((v) => /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(v.trim()), 'Enter a valid URL')
      break
    case 'number':
    case 'currency':
    case 'percentage':
    case 'rating': {
      let s = z.number({ error: field.required ? reqMsg : 'Enter a number' })
      const min = field.min ?? (field.type === 'percentage' || field.type === 'rating' ? 0 : undefined)
      const max = field.max ?? (field.type === 'percentage' ? 100 : field.type === 'rating' ? 5 : undefined)
      if (min !== undefined) s = s.min(min, `${label} must be at least ${min}`)
      if (max !== undefined) s = s.max(max, `${label} must be at most ${max}`)
      base = s
      break
    }
    case 'date':
    case 'datetime':
      base = z.string({ error: reqMsg }).refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date')
      break
    case 'time':
      base = z.string({ error: reqMsg }).regex(/^\d{2}:\d{2}$/, 'Enter a valid time')
      break
    case 'dropdown':
    case 'radio': {
      const ids = (field.options ?? []).map((o) => o.id)
      base = z.string({ error: reqMsg }).refine((v) => ids.includes(v), 'Choose one of the available options')
      break
    }
    case 'multiSelect':
    case 'checkboxes': {
      const ids = (field.options ?? []).map((o) => o.id)
      base = z.array(z.string()).refine((a) => a.every((v) => ids.includes(v)), 'Contains an unknown option')
      break
    }
    case 'tags':
      base = z.array(z.string())
      break
    case 'yesNo':
      base = z.boolean({ error: reqMsg })
      break
    case 'color':
      base = z.string({ error: reqMsg }).regex(/^#[0-9a-fA-F]{6}$/, 'Enter a valid colour')
      break
    case 'relationship':
      base = isSingleRel(field) ? z.string({ error: reqMsg }) : z.array(z.string())
      break
    case 'file':
    case 'image':
    case 'document':
      base = z.array(z.any())
      break
    default:
      base = z.any()
  }
  const norm = (v: unknown) => (isEmpty(v) ? undefined : v)
  if (field.type === 'yesNo') return field.required ? z.preprocess((v) => (v === '' ? undefined : v), base.refine((v) => v === true, reqMsg)) : z.preprocess((v) => (v === '' ? undefined : v), base.optional())
  if (field.required) return z.preprocess(norm, base)
  return z.preprocess(norm, base.optional())
}

export function validateValue(field: Field, value: unknown): string | null {
  const r = buildFieldSchema(field).safeParse(value)
  if (r.success) return null
  return r.error.issues[0]?.message ?? 'Invalid value'
}

export function coerceInput(field: Field, raw: unknown): unknown {
  if (['number', 'currency', 'percentage', 'rating'].includes(field.type)) {
    if (raw === '' || raw === null || raw === undefined) return ''
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  return raw
}

export function fileLabel(files: unknown): string {
  const arr = (Array.isArray(files) ? files : []) as FileMeta[]
  if (!arr.length) return ''
  return arr.map((f) => f.name).join(', ')
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'CHF', 'AED', 'BRL', 'MXN']

export function formatCurrency(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}
