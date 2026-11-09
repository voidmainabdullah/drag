import { useEffect, useState } from 'react'
import { useUiStore } from '#/stores/uiStore'
import { useRecordStore } from '#/stores/recordStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useForms, useModule, usePerms, useWsId } from '#/hooks/useData'
import { Modal } from '#/components/ui/Modal'
import { Select } from '#/components/ui/controls'
import { Notice } from '#/components/ui/misc'
import { FormRenderer } from '#/components/fields/FormRenderer'
import { recordTitle } from '#/utils/records'
import { toast } from '#/utils/toast'

export function NewRecordModal() {
  const moduleId = useUiStore((s) => s.newRecordModuleId)
  const initial = useUiStore((s) => s.newRecordInitial)
  const start = useUiStore((s) => s.startNewRecord)
  const module = useModule(moduleId ?? undefined)
  const forms = useForms(moduleId ?? undefined)
  const perms = usePerms()
  const ws = useWsId()
  const [formId, setFormId] = useState('')

  useEffect(() => setFormId(''), [moduleId])
  if (!moduleId || !module) return null
  const form = forms.find((f) => f.id === formId) ?? forms[0]
  const allowed = perms.canModule(module, 'create')

  return (
    <Modal open onClose={() => start(null)} title={`New ${module.name.replace(/s$/, '')}`} description={module.description} size="lg">
      {!allowed ? (
        <Notice tone="warning">Your current role cannot create records in {module.name}.</Notice>
      ) : (
        <div className="space-y-4">
          {forms.length > 1 && (
            <Select aria-label="Form" value={form?.id} onChange={(e) => setFormId(e.target.value)}>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          )}
          <FormRenderer
            key={form?.id ?? 'default'}
            module={module}
            sections={form?.sections}
            initial={initial}
            submitLabel={form?.submitLabel ?? 'Create'}
            onCancel={() => start(null)}
            onSubmit={(data) => {
              const res = useRecordStore.getState().create(module.id, data)
              if (res.record) {
                useSettingsStore.getState().addRecent(ws, { moduleId: module.id, recordId: res.record.id, label: recordTitle(module, res.record) })
                toast.success(`${module.name.replace(/s$/, '')} created`)
                start(null)
              } else toast.error('Could not save', Object.values(res.errors)[0])
            }}
          />
        </div>
      )}
    </Modal>
  )
}
