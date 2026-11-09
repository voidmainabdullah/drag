import { useEffect, useState } from 'react'
import type { Template } from '#/types'
import { useWorkspace, useWsId } from '#/hooks/useData'
import { installTemplate } from '#/services/installer'
import { destinationMessage, isDestinationValid, resolveDestination, type Destination } from '#/services/destination'
import { Modal } from '#/components/ui/Modal'
import { Button } from '#/components/ui/Button'
import { toast } from '#/utils/toast'
import { DestinationPicker } from './DestinationPicker'
import { useGo } from './AppLink'

/** The Install button of every template opens this: choose a destination, then install through the generic installer. */
export function InstallTemplateDialog({ template, onClose, onInstalled }: { template: Template | null; onClose: () => void; onInstalled?: () => void }) {
  const ws = useWsId()
  const workspace = useWorkspace()
  const go = useGo()
  const [dest, setDest] = useState<Destination>({ mode: 'new', workspaceName: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (template) {
      setDest({ mode: 'new', workspaceName: template.name })
      setBusy(false)
    }
  }, [template?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!template) return null
  const t = template
  const flows = t.dataflows?.length ?? 0

  const install = () => {
    if (!isDestinationValid(dest) || busy) return
    setBusy(true)
    try {
      const target = resolveDestination(dest, ws)
      const res = installTemplate(t, { workspaceId: target.workspaceId, showInNav: target.showInNav })
      toast.success('Template installed', `${res.moduleCount} module${res.moduleCount === 1 ? '' : 's'}${res.flowCount ? `, ${res.flowCount} data flow${res.flowCount === 1 ? '' : 's'}` : ''}. ${destinationMessage(dest, target)}`)
      onInstalled?.()
      onClose()
      if (res.moduleIds[0]) go(`/m/${res.moduleIds[0]}`)
    } catch (e) {
      setBusy(false)
      toast.error('Could not install the template', e instanceof Error ? e.message : undefined)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Install “${t.name}”`}
      description={`Adds ${t.modules.length} module(s), ${t.forms.length} form(s), ${t.views.length} view(s), ${t.workflows.length} workflow(s)${flows ? ` and ${flows} data flow(s)` : ''}. Everything stays editable.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Download" onClick={install} disabled={!isDestinationValid(dest) || busy}>Install template</Button></>}
    >
      <DestinationPicker value={dest} onChange={setDest} workspaceName={workspace?.name} namePlaceholder={t.name} />
    </Modal>
  )
}
