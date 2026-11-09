import type { Field, Form, FormSection, ID, Module, PublicFormSettings, View, ViewConfig, ViewType } from '#/types'
import { nowIso, uid } from '#/utils/id'
import { makeOptions } from '#/utils/fieldTypes'

export function defaultPublicSettings(title: string): PublicFormSettings {
  return {
    enabled: false,
    title,
    description: '',
    submitLabel: 'Submit',
    thankYouTitle: 'Thank you!',
    thankYouMessage: 'Your response has been recorded.',
    accent: '#7B68EE',
    background: '#F7F7FB',
    radius: 12,
    showBranding: true,
  }
}

export const isAutoField = (f: Field) => f.type === 'formula' || f.type === 'autoId'

export function makeSections(fields: Field[], title = 'Details'): FormSection[] {
  const editable = fields.filter((f) => !isAutoField(f))
  const cols: 1 | 2 = editable.length > 5 ? 2 : 1
  return [{ id: uid('sec'), title, columns: cols, items: editable.map((f) => ({ fieldId: f.id })) }]
}

export function newForm(ws: ID, m: Module, name?: string): Form {
  const t = nowIso()
  return {
    id: uid('form'),
    workspaceId: ws,
    moduleId: m.id,
    name: name ?? `${m.name} form`,
    sections: makeSections(m.fields),
    submitLabel: 'Submit',
    public: defaultPublicSettings(name ?? `${m.name} form`),
    createdAt: t,
    updatedAt: t,
  }
}

export function emptyViewConfig(): ViewConfig {
  return { filters: [], sorts: [], hiddenFieldIds: [], fieldOrder: [], columnWidths: {} }
}

export function newView(ws: ID, m: Module, name: string, type: ViewType, config?: Partial<ViewConfig>, order = 0): View {
  const t = nowIso()
  const cfg: ViewConfig = { ...emptyViewConfig(), ...config }
  if (type === 'kanban' && !cfg.groupBy) cfg.groupBy = m.fields.find((f) => f.type === 'dropdown' || f.type === 'radio')?.id
  if ((type === 'calendar' || type === 'timeline') && !cfg.dateFieldId) cfg.dateFieldId = m.fields.find((f) => f.type === 'date' || f.type === 'datetime')?.id
  if (type === 'timeline' && !cfg.endDateFieldId) {
    const dates = m.fields.filter((f) => f.type === 'date' || f.type === 'datetime')
    cfg.endDateFieldId = dates[1]?.id
  }
  if (type === 'gallery' && !cfg.imageFieldId) cfg.imageFieldId = m.fields.find((f) => f.type === 'image')?.id
  return { id: uid('view'), workspaceId: ws, moduleId: m.id, name, type, config: cfg, order, createdAt: t, updatedAt: t }
}

export const TASK_STATUS = makeOptions(['To Do', 'In Progress', 'Done'])
export const TASK_PRIORITY = makeOptions(['Low', 'Medium', 'High', 'Urgent'])

export function tasksFields(): Field[] {
  return [
    { id: 'title', name: 'title', label: 'Task', type: 'shortText', required: true, width: 'full', order: 0 },
    { id: 'status', name: 'status', label: 'Status', type: 'dropdown', options: TASK_STATUS, defaultValue: 'to_do', width: 'half', order: 1 },
    { id: 'priority', name: 'priority', label: 'Priority', type: 'dropdown', options: TASK_PRIORITY, defaultValue: 'medium', width: 'half', order: 2 },
    { id: 'due', name: 'due', label: 'Due date', type: 'date', width: 'half', order: 3 },
    { id: 'assignee', name: 'assignee', label: 'Assignee', type: 'user', width: 'half', order: 4 },
    { id: 'notes', name: 'notes', label: 'Notes', type: 'longText', width: 'full', order: 5 },
    { id: 'related', name: 'related', label: 'Related to', type: 'shortText', width: 'full', order: 6 },
  ]
}
