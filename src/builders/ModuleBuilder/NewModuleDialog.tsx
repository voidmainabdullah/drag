import { useEffect, useState } from 'react'
import type { Module } from '#/types'
import { useAllModules, useWorkspace, useWsId } from '#/hooks/useData'
import { useSettingsStore } from '#/stores/settingsStore'
import { createModule } from '#/services/moduleService'
import { destinationMessage, isDestinationValid, resolveDestination, type Destination } from '#/services/destination'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { Field, Input, Select, Textarea } from '#/components/ui/controls'
import { ColorPicker, IconPicker } from '#/components/ui/Overlays'
import { DestinationPicker } from '#/components/layout/DestinationPicker'
import { toast } from '#/utils/toast'

const CURRENT: Destination = { mode: 'current', workspaceName: '' }

export function NewModuleDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (m: Module) => void }) {
  const ws = useWsId()
  const workspace = useWorkspace()
  const modules = useAllModules()
  const nav = useSettingsStore((s) => s.settings.nav[ws]) ?? []
  const containers = nav.filter((n) => n.type === 'category' || n.type === 'folder')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('Box')
  const [color, setColor] = useState('#7B68EE')
  const [category, setCategory] = useState('')
  const [parentId, setParentId] = useState('')
  const [navParentId, setNavParentId] = useState('')
  const [dest, setDest] = useState<Destination>(CURRENT)

  useEffect(() => {
    if (!open) return
    setName(''); setDescription(''); setIcon('Box'); setColor('#7B68EE'); setCategory(''); setParentId(''); setDest(CURRENT)
    setNavParentId(nav.find((n) => n.type === 'category' && n.label === 'Business Management')?.id ?? containers[0]?.id ?? '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const inCurrent = dest.mode === 'current'
  const canCreate = !!name.trim() && isDestinationValid(dest)

  const create = () => {
    if (!canCreate) return
    const target = resolveDestination(dest, ws)
    const m = createModule({
      workspaceId: target.workspaceId,
      name,
      description: description || undefined,
      icon,
      color,
      category: category.trim() || undefined,
      // submodules and sidebar folders belong to the workspace you are in right now
      parentId: dest.mode === 'new' ? undefined : parentId || undefined,
      navParentId: inCurrent ? navParentId || undefined : undefined,
      showInNav: target.showInNav,
    })
    toast.success('Module created', `${destinationMessage(dest, target)} Add fields to “${m.name}” next.`)
    onCreated?.(m)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="New module" description="A module is a table of records — contacts, deals, tickets, anything you track." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create} disabled={!canCreate}>Create module</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="e.g. Invoices" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea className="min-h-[60px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Icon"><IconPicker value={icon} onChange={setIcon} color={color} /></Field>
        <Field label="Colour"><ColorPicker value={color} onChange={setColor} /></Field>
        <Field label="Category label"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" /></Field>
        {dest.mode !== 'new' && (
          <Field label="Parent module (submodule)">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">None</option>{modules.filter((m) => !m.system).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
          </Field>
        )}
        <div className="sm:col-span-2"><DestinationPicker value={dest} onChange={setDest} workspaceName={workspace?.name} /></div>
        {inCurrent && containers.length > 0 && (
          <Field label="Show in sidebar under" className="sm:col-span-2">
            <Select value={navParentId} onChange={(e) => setNavParentId(e.target.value)}>{containers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
          </Field>
        )}
      </div>
    </Modal>
  )
}
