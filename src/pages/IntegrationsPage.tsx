import { useState } from 'react'
import { z } from 'zod'
import type { IntegrationConfig } from '#/types'
import { useSettingsStore } from '#/stores/settingsStore'
import { usePerms } from '#/hooks/useData'
import { confirmDialog, toast } from '#/utils/toast'
import { uid } from '#/utils/id'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Badge, Card, EmptyState, Notice, PageHeader } from '#/components/ui/misc'
import { Checkbox, Field, Input, Select, Switch } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'

const EVENTS = [
  { id: 'record.created', label: 'Record created' },
  { id: 'record.updated', label: 'Record updated' },
  { id: 'record.deleted', label: 'Record deleted' },
  { id: 'form.submitted', label: 'Form submitted' },
]
const urlSchema = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), 'Use an http(s) URL')

function IntegrationDialog({ initial, onClose }: { initial: IntegrationConfig | null; onClose: () => void }) {
  const [c, setC] = useState<IntegrationConfig>(initial ?? { id: uid('int'), type: 'webhook', name: '', url: '', secret: '', events: ['record.created'], enabled: true })
  const [error, setError] = useState('')
  const save = () => {
    if (!c.name.trim()) return setError('Give it a name')
    const u = urlSchema.safeParse(c.url)
    if (!u.success) return setError(u.error.issues[0]?.message === 'Use an http(s) URL' ? 'Use an http(s) URL' : 'Enter a valid URL, e.g. https://example.com/hook')
    if (c.type === 'webhook' && c.events.length === 0) return setError('Choose at least one event')
    useSettingsStore.getState().saveIntegration({ ...c, name: c.name.trim(), url: c.url.trim() })
    toast.success(initial ? 'Integration updated' : 'Integration saved')
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={initial ? 'Edit integration' : 'Add integration'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Type"><Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value as IntegrationConfig['type'] })}><option value="webhook">Outgoing webhook</option><option value="api">External API endpoint</option></Select></Field>
        <Field label="Name" required><Input autoFocus value={c.name} onChange={(e) => { setC({ ...c, name: e.target.value }); setError('') }} placeholder="e.g. Zapier — new leads" /></Field>
        <Field label="URL" required><Input value={c.url} onChange={(e) => { setC({ ...c, url: e.target.value }); setError('') }} placeholder="https://hooks.example.com/…" /></Field>
        <Field label="Secret / API key (optional)" hint="Stored in plain text in this browser. Sent as a Bearer token on test requests."><Input type="password" autoComplete="off" value={c.secret ?? ''} onChange={(e) => setC({ ...c, secret: e.target.value })} /></Field>
        {c.type === 'webhook' && (
          <div>
            <div className="mb-1.5 text-[13px] font-medium">Events</div>
            <div className="grid gap-1.5 sm:grid-cols-2">{EVENTS.map((ev) => <Checkbox key={ev.id} checked={c.events.includes(ev.id)} onChange={(v) => setC({ ...c, events: v ? [...c.events, ev.id] : c.events.filter((x) => x !== ev.id) })} label={ev.label} />)}</div>
          </div>
        )}
        <Switch checked={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label="Enabled" />
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}

export function IntegrationsPage() {
  const list = useSettingsStore((s) => s.settings.integrations)
  const perms = usePerms()
  const [dialog, setDialog] = useState<IntegrationConfig | 'new' | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const can = perms.can('accessSettings')

  const test = async (c: IntegrationConfig) => {
    setTesting(c.id)
    try {
      const res = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c.secret ? { Authorization: `Bearer ${c.secret}` } : {}) }, body: JSON.stringify({ event: 'xcrm.test', sentAt: new Date().toISOString(), source: 'xcrm-local' }) })
      res.ok ? toast.success(`Endpoint responded ${res.status}`) : toast.warning(`Endpoint responded ${res.status}`, 'The request reached it but it did not return success.')
    } catch {
      toast.error('Request failed', 'The browser could not reach this URL — often a CORS restriction, an offline endpoint or a typo. Browsers only allow this call if the server permits it.')
    } finally {
      setTesting(null)
    }
  }

  return (
    <Page title="Integrations" skeleton="cards">
      <PageHeader title="Integrations" icon="Plug" description="Keep webhook and API endpoint settings alongside your CRM."
        actions={can && <Button variant="gradient" icon="Plus" onClick={() => setDialog('new')}>Add integration</Button>} />
      <div className="mb-5"><Notice tone="warning"><strong>Local configuration only.</strong> Xcrm has no backend, so it can’t deliver webhooks in the background or sync with other services on its own. What you save here is stored in this browser, and “Send test” makes a single request from your browser (which the target server must allow via CORS). Automatic event delivery isn’t implemented.</Notice></div>
      {list.length === 0 ? (
        <EmptyState icon="Plug" title="No integrations configured" description="Add a webhook or API endpoint to keep its details with your CRM." action={can && <Button variant="primary" icon="Plus" onClick={() => setDialog('new')}>Add integration</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={c.type === 'webhook' ? 'Webhook' : 'Plug'} size={17} /></span>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-[14px] font-semibold">{c.name}</h3><Badge color={c.enabled ? '#2DB67D' : undefined}>{c.enabled ? 'Enabled' : 'Disabled'}</Badge></div><p className="truncate text-xs text-muted">{c.url}</p></div>
              </div>
              {c.type === 'webhook' && <div className="mt-2 flex flex-wrap gap-1">{c.events.map((e) => <Badge key={e}>{e}</Badge>)}</div>}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Button size="xs" icon="Send" disabled={testing === c.id} onClick={() => void test(c)}>{testing === c.id ? 'Sending…' : 'Send test'}</Button>
                {can && <Button size="xs" onClick={() => setDialog(c)}>Edit</Button>}
                {can && <Button size="xs" onClick={() => useSettingsStore.getState().saveIntegration({ ...c, enabled: !c.enabled })}>{c.enabled ? 'Disable' : 'Enable'}</Button>}
                {can && <Button size="xs" variant="ghost" onClick={async () => { if (await confirmDialog({ title: `Remove “${c.name}”?`, confirmLabel: 'Remove', danger: true })) { useSettingsStore.getState().removeIntegration(c.id); toast.success('Integration removed') } }}>Remove</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {dialog && <IntegrationDialog initial={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} />}
    </Page>
  )
}
