import { useMemo, useState } from 'react'
import { z } from 'zod'
import type { Template } from '#/types'
import { BUILTIN_TEMPLATES, TEMPLATE_CATEGORIES } from '#/templates'
import { useTemplateStore } from '#/stores/collections'
import { useHydrated, usePerms, useWsId } from '#/hooks/useData'
import { workspaceToTemplate } from '#/services/installer'
import { FIELD_TYPE_MAP } from '#/utils/fieldTypes'
import { downloadText, safeFileName } from '#/utils/download'
import { nowIso, uid, cn } from '#/utils/id'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { InstallTemplateDialog } from '#/components/layout/InstallTemplateDialog'
import { Button } from '#/components/ui/Button'
import { Modal } from '#/components/ui/Modal'
import { Badge, Card, EmptyState, PageHeader } from '#/components/ui/misc'
import { Field, Input, SearchInput, Select, Textarea } from '#/components/ui/controls'
import { Icon } from '#/components/ui/Icon'
import { IconPicker } from '#/components/ui/Overlays'
import { useModuleStore } from '#/stores/moduleStore'

const templateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  modules: z.array(z.object({ key: z.string(), name: z.string(), icon: z.string().optional(), fields: z.array(z.object({ id: z.string(), label: z.string(), type: z.string() }).passthrough()).min(1) }).passthrough()).min(1),
  forms: z.array(z.any()).default([]),
  views: z.array(z.any()).default([]),
  workflows: z.array(z.any()).default([]),
  dataflows: z.array(z.any()).default([]),
  dashboard: z.any().optional(),
}).passthrough()

function PreviewModal({ t, onClose, onInstall }: { t: Template; onClose: () => void; onInstall: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={t.name} description={t.description} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon="Download" onClick={onInstall}>Install template</Button></>}>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2 text-xs"><Badge>{t.category}</Badge><Badge>{t.modules.length} modules</Badge><Badge>{t.forms.length} forms</Badge><Badge>{t.views.length} views</Badge><Badge>{t.workflows.length} workflows</Badge>{(t.dataflows?.length ?? 0) > 0 && <Badge>{t.dataflows!.length} data flows</Badge>}{t.dashboard && <Badge>1 dashboard</Badge>}</div>
        <section>
          <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Modules and fields</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {t.modules.map((m) => (
              <div key={m.key} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: m.color ?? '#7B68EE' }}><Icon name={m.icon} size={13} /></span>{m.name}</div>
                <ul className="space-y-0.5 text-xs text-muted">{m.fields.map((f) => <li key={f.id} className="flex justify-between gap-2"><span className="truncate">{f.label}</span><span className="shrink-0">{FIELD_TYPE_MAP[f.type]?.label ?? f.type}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </section>
        {t.workflows.length > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Automations</h4>
            <ul className="space-y-1 text-[13px]">{t.workflows.map((w, i) => <li key={i} className="flex items-center gap-2"><Icon name="Workflow" size={13} className="text-primary" />{w.name}</li>)}</ul>
          </section>
        )}
        {(t.dataflows?.length ?? 0) > 0 && (
          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Data flows between modules</h4>
            <ul className="space-y-1 text-[13px]">{t.dataflows!.map((d, i) => <li key={i} className="flex items-center gap-2"><Icon name="Network" size={13} className="text-primary" />{d.name}</li>)}</ul>
          </section>
        )}
        {t.dashboard && <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Dashboard</h4><p className="text-[13px]">{t.dashboard.name} — {t.dashboard.widgets.length} widgets</p></section>}
      </div>
    </Modal>
  )
}

function SaveTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWsId()
  const allModules = useModuleStore((s) => s.modules)
  const modules = useMemo(() => allModules.filter((m) => m.workspaceId === ws && !m.system && !m.archived), [allModules, ws])
  const [name, setName] = useState('My CRM')
  const [category, setCategory] = useState('Other')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('LayoutTemplate')
  const save = () => {
    if (!name.trim()) return
    const t = workspaceToTemplate(ws, { name: name.trim(), category, description, icon })
    useTemplateStore.getState().add(t)
    toast.success('Template saved', `“${t.name}” now appears under My templates.`)
    onClose()
  }
  return (
    <Modal open={open} onClose={onClose} title="Save my CRM as a template" description={`Captures ${modules.length} module(s) with their fields, forms, views, workflows and dashboard. Records are not included.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim() || modules.length === 0} onClick={save}>Save template</Button></>}>
      <div className="space-y-4">
        <Field label="Template name" required><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{TEMPLATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Description"><Textarea className="min-h-[70px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Icon"><IconPicker value={icon} onChange={setIcon} /></Field>
        {modules.length === 0 && <p className="text-xs text-warning">This workspace has no custom modules to save yet.</p>}
      </div>
    </Modal>
  )
}

function ImportTemplateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const go = () => {
    try {
      const p = templateSchema.parse(JSON.parse(text)) as unknown as Template
      useTemplateStore.getState().add({ ...p, id: uid('tpl'), category: p.category ?? 'Other', description: p.description ?? '', icon: p.icon ?? 'LayoutTemplate', builtin: false, createdAt: nowIso() })
      toast.success('Template imported')
      setText('')
      onClose()
    } catch (e) {
      setErr(e instanceof z.ZodError ? `Invalid template: ${e.issues[0]?.path.join('.') || 'root'} — ${e.issues[0]?.message}` : 'That is not valid JSON')
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Import template JSON" description="Paste a template you exported from Xcrm." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!text.trim()} onClick={go}>Import</Button></>}>
      <Textarea aria-label="Template JSON" className="min-h-[220px] font-mono text-xs" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setErr('') }} />
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </Modal>
  )
}

export function TemplatesPage() {
  const perms = usePerms()
  const hydrated = useHydrated()
  const user = useTemplateStore((s) => s.templates)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('All')
  const [preview, setPreview] = useState<Template | null>(null)
  const [installing, setInstalling] = useState<Template | null>(null)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const canInstall = perms.can('manageFields')

  const all = useMemo(() => [...user.map((t) => ({ ...t, mine: true })), ...BUILTIN_TEMPLATES.map((t) => ({ ...t, mine: false }))], [user])
  const list = all.filter((t) => (cat === 'All' || (cat === 'mine' ? t.mine : t.category === cat)) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase())))
  const cats = ['All', ...(user.length ? ['mine'] : []), ...TEMPLATE_CATEGORIES]

  // Install opens a small dialog: current workspace, a new empty workspace (default) or hidden from the sidebar
  const install = (t: Template) => {
    if (!canInstall) return toast.error('Your role cannot install templates')
    setPreview(null)
    setInstalling(t)
  }
  const duplicate = (t: Template) => {
    const copy: Template = { ...structuredClone(t), id: uid('tpl'), name: `${t.name} (copy)`, builtin: false, createdAt: nowIso() }
    useTemplateStore.getState().add(copy)
    toast.success('Template duplicated', 'Find the copy under My templates.')
  }

  return (
    <Page title="Templates" skeleton="cards">
      <PageHeader title="Templates" icon="LayoutTemplate" description="Start from a ready-made CRM structure. Installed templates are ordinary modules, forms and workflows — edit anything."
        actions={<><Button icon="Upload" onClick={() => setImporting(true)}>Import JSON</Button><Button variant="gradient" icon="Save" onClick={() => setSaving(true)}>Save my CRM as template</Button></>} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search templates…" className="w-full max-w-xs" />
        <div className="flex flex-wrap gap-1.5">
          {cats.map((c) => <button key={c} type="button" onClick={() => setCat(c)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', cat === c ? 'border-primary bg-primary text-white' : 'border-line hover:bg-subtle')}>{c === 'mine' ? 'My templates' : c}</button>)}
        </div>
      </div>
      {!hydrated ? null : list.length === 0 ? (
        <EmptyState icon="SearchX" title="No templates match" action={<Button onClick={() => { setQ(''); setCat('All') }}>Reset filters</Button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <Card key={t.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: t.color ?? '#7B68EE' }}><Icon name={t.icon} size={19} /></span>
                <div className="min-w-0"><h3 className="truncate text-[15px] font-semibold">{t.name}</h3><div className="mt-0.5 flex gap-1.5"><Badge>{t.category}</Badge>{t.mine && <Badge color="#FD71AF">Mine</Badge>}</div></div>
              </div>
              <p className="mt-3 line-clamp-3 min-h-[3.6em] flex-1 text-[13px] text-muted">{t.description}</p>
              <div className="mt-3 text-xs text-muted">{t.modules.length} modules · {t.forms.length} forms · {t.workflows.length} workflows</div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="xs" variant="primary" icon="Download" onClick={() => install(t)} disabled={!canInstall}>Install</Button>
                <Button size="xs" icon="Eye" onClick={() => setPreview(t)}>Preview</Button>
                <Button size="xs" icon="Copy" onClick={() => duplicate(t)}>Duplicate</Button>
                {t.mine && <Button size="xs" variant="ghost" icon="FileJson" title="Export JSON" onClick={() => { downloadText(JSON.stringify(t, null, 2), `${safeFileName(t.name)}.template.json`, 'application/json'); toast.success('Template exported') }}>Export</Button>}
                {t.mine && <Button size="xs" variant="ghost" title="Delete template" onClick={async () => { if (await confirmDialog({ title: `Delete template “${t.name}”?`, message: 'Modules already installed from it are not affected.', confirmLabel: 'Delete', danger: true })) useTemplateStore.getState().remove(t.id) }}><Icon name="Trash2" size={13} /></Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {preview && <PreviewModal t={preview} onClose={() => setPreview(null)} onInstall={() => install(preview)} />}
      <InstallTemplateDialog template={installing} onClose={() => setInstalling(null)} />

      <SaveTemplateDialog open={saving} onClose={() => setSaving(false)} />
      <ImportTemplateDialog open={importing} onClose={() => setImporting(false)} />
    </Page>
  )
}
