import { useEffect, useId, useState } from 'react'
import type { Workspace } from '#/types'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Field, Input, Textarea } from '#/components/ui/controls'
import { ColorPicker, IconPicker } from '#/components/ui/Overlays'
import { createWorkspace, renameWorkspace } from '#/services/workspaceService'
import { toast } from '#/utils/toast'
import { cn } from '#/utils/id'

type Kind = 'standard' | 'no-modules' | 'empty'

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard workspace', hint: 'Default sidebar plus the starter CRM modules (Contacts, Companies, Leads, Deals…).' },
  { id: 'no-modules', label: 'Standard sidebar, no starter modules', hint: 'Keeps the usual sidebar pages but starts without any modules.' },
  { id: 'empty', label: 'Empty workspace (no default modules)', hint: 'Completely blank: no starter modules and no default sidebar items. Ideal for a separate CRM — nothing gets mixed in.' },
]

export function WorkspaceDialog({ open, onClose, workspace }: { open: boolean; onClose: () => void; workspace?: Workspace }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('Briefcase')
  const [color, setColor] = useState('#7B68EE')
  const [kind, setKind] = useState<Kind>('standard')
  const group = useId()

  useEffect(() => {
    if (!open) return
    setName(workspace?.name ?? '')
    setDescription(workspace?.description ?? '')
    setIcon(workspace?.icon ?? 'Briefcase')
    setColor(workspace?.color ?? '#7B68EE')
    setKind('standard')
  }, [open, workspace])

  const submit = () => {
    if (!name.trim()) return
    if (workspace) {
      renameWorkspace(workspace.id, { name: name.trim(), description, icon, color })
      toast.success('Workspace updated')
    } else {
      createWorkspace({ name, description, icon, color, withDefaults: kind === 'standard', empty: kind === 'empty' })
      toast.success('Workspace created', `Switched to "${name.trim()}".${kind === 'empty' ? ' It starts completely empty.' : ''}`)
    }
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={workspace ? 'Edit workspace' : 'New workspace'} description={workspace ? undefined : 'Each workspace has its own modules, records, forms, dashboards and navigation.'} size="sm" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!name.trim()}>{workspace ? 'Save' : 'Create workspace'}</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="e.g. Acme Sales" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px]" /></Field>
        <div className="flex flex-wrap items-center gap-4">
          <Field label="Icon"><IconPicker value={icon} onChange={setIcon} color={color} /></Field>
          <Field label="Colour"><ColorPicker value={color} onChange={setColor} /></Field>
        </div>
        {!workspace && (
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-[13px] font-medium">Starting point</legend>
            {KINDS.map((k) => (
              <label key={k.id} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition', kind === k.id ? 'border-primary bg-primary/5' : 'border-line hover:bg-subtle')}>
                <input type="radio" name={group} className="mt-1 size-4 accent-[var(--primary)]" checked={kind === k.id} onChange={() => setKind(k.id)} />
                <span className="min-w-0"><span className="block text-[13px] font-medium">{k.label}</span><span className="mt-0.5 block text-xs text-muted">{k.hint}</span></span>
              </label>
            ))}
          </fieldset>
        )}
      </div>
    </Modal>
  )
}
