import { useState } from 'react'
import type { Form, Module } from '#/types'
import { useFormStore } from '#/stores/collections'
import { useRecordStore } from '#/stores/recordStore'
import { FormRenderer } from '#/components/fields/FormRenderer'
import { Switch, Input, Textarea, Field } from '#/components/ui/controls'
import { Notice, Tabs } from '#/components/ui/misc'
import { toast } from '#/utils/toast'
import { FormCanvas } from './FormCanvas'
import { PublicFormPanel, SubmissionsPanel } from './PublicFormPanel'
import { useRecords } from '#/hooks/useData'

type Tab = 'design' | 'preview' | 'public' | 'submissions'

function Preview({ form, module }: { form: Form; module: Module }) {
  const [real, setReal] = useState(false)
  const [nonce, setNonce] = useState(0)
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Switch checked={real} onChange={setReal} label="Submitting creates a real record" />
        {!real && <span className="text-xs text-muted">Test mode — nothing is saved.</span>}
      </div>
      <div className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="text-lg font-semibold">{form.name}</h2>
        {form.description && <p className="mb-4 text-[13px] text-muted">{form.description}</p>}
        <div className="mt-4">
          <FormRenderer
            key={nonce}
            module={module}
            sections={form.sections}
            submitLabel={form.submitLabel}
            onSubmit={(data) => {
              if (!real) { toast.info('Preview only', 'Validation passed. Turn on “creates a real record” to save.'); return }
              const res = useRecordStore.getState().create(module.id, data, { source: `preview:${form.id}` })
              if ('errors' in res && res.errors) toast.error('Could not save', Object.values(res.errors)[0])
              else { toast.success('Record created'); setNonce((n) => n + 1) }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export function FormBuilder({ form, module }: { form: Form; module: Module }) {
  const [tab, setTab] = useState<Tab>('design')
  const subs = useRecords(module.id).filter((r) => r.source === form.id).length
  const upd = (p: Partial<Form>) => useFormStore.getState().update(form.id, p)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3">
        <Field label="Form name"><Input value={form.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
        <Field label="Submit button label"><Input value={form.submitLabel} onChange={(e) => upd({ submitLabel: e.target.value })} /></Field>
        <Field label="Description"><Textarea className="min-h-[36px] py-1.5" rows={1} value={form.description ?? ''} onChange={(e) => upd({ description: e.target.value || undefined })} /></Field>
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'design', label: 'Design', icon: 'Wand2' }, { id: 'preview', label: 'Preview', icon: 'Eye' }, { id: 'public', label: 'Public form', icon: 'Globe' }, { id: 'submissions', label: 'Submissions', icon: 'Inbox', count: subs }]} />
      {tab === 'design' && (
        <>
          <Notice>Changes save automatically. Drag fields from the palette into sections, drag to reorder, or use the + button.</Notice>
          <FormCanvas form={form} module={module} />
        </>
      )}
      {tab === 'preview' && <Preview form={form} module={module} />}
      {tab === 'public' && <PublicFormPanel form={form} />}
      {tab === 'submissions' && <SubmissionsPanel form={form} module={module} />}
    </div>
  )
}
