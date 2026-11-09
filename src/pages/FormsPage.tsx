import { useEffect } from 'react'
import { useForms, useModules, usePerms } from '#/hooks/useData'
import { useSelectionStore } from '#/stores/selectionStore'
import { createForm, deleteForm, duplicateForm } from '#/services/formService'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { EmptyState, PageHeader } from '#/components/ui/misc'
import { Select } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import { FormBuilder } from '#/builders/FormBuilder/FormBuilder'

export function FormsPage() {
  const modules = useModules()
  const perms = usePerms()
  const go = useGo()
  const sel = useSelectionStore()
  const module = modules.find((m) => m.id === sel.moduleId) ?? modules[0]
  const forms = useForms(module?.id)
  const form = forms.find((f) => f.id === sel.formId) ?? forms[0]
  const canManage = perms.can('manageForms')

  useEffect(() => {
    if (module && module.id !== sel.moduleId) sel.set({ moduleId: module.id })
    if (form && form.id !== sel.formId) sel.set({ formId: form.id })
  }, [module?.id, form?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page title="Form Builder" wide skeleton="form">
      <PageHeader title="Form Builder" icon="FormInput" description="Design the forms used to create records — and optionally share them as a (local-preview) public form."
        actions={module && canManage && <Button variant="gradient" icon="Plus" onClick={() => { const f = createForm(module); sel.set({ formId: f.id }); toast.success('Form created') }}>New form</Button>} />
      {!module ? (
        <EmptyState icon="FormInput" title="No modules yet" description="Forms belong to modules. Create a module first." action={<Button variant="primary" onClick={() => go('/module-builder')}>Open Module Builder</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-muted">Module
              <Select className="w-52" value={module.id} onChange={(e) => sel.set({ moduleId: e.target.value, formId: null })}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {forms.map((f) => (
                <button key={f.id} type="button" onClick={() => sel.set({ formId: f.id })} className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px]', f.id === form?.id ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line hover:bg-subtle')}>
                  <Icon name="FormInput" size={13} />{f.name}{f.public.enabled && <Icon name="Globe" size={11} />}
                </button>
              ))}
            </div>
            {form && canManage && (
              <div className="ml-auto flex gap-2">
                <Button size="sm" icon="Copy" onClick={() => { const c = duplicateForm(form.id); if (c) { sel.set({ formId: c.id }); toast.success('Form duplicated') } }}>Duplicate</Button>
                <Button size="sm" variant="danger" icon="Trash2" disabled={forms.length <= 1} title={forms.length <= 1 ? 'A module needs at least one form' : undefined} onClick={async () => { if (await confirmDialog({ title: `Delete form “${form.name}”?`, message: 'Existing records are kept.', confirmLabel: 'Delete form', danger: true })) { deleteForm(form.id); sel.set({ formId: null }) } }}>Delete</Button>
              </div>
            )}
          </div>
          {!form ? (
            <EmptyState icon="FormInput" title="This module has no forms" action={canManage && <Button variant="primary" onClick={() => createForm(module)}>Create form</Button>} />
          ) : canManage ? (
            <FormBuilder key={form.id} form={form} module={module} />
          ) : (
            <EmptyState icon="Lock" title="You can’t edit forms" description="Your role doesn’t include managing forms." />
          )}
        </>
      )}
    </Page>
  )
}
