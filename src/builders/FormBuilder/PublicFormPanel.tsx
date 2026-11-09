import { useMemo } from 'react'
import { format } from 'date-fns'
import type { Form, Module } from '#/types'
import { useFormStore } from '#/stores/collections'
import { useCtx, useRecords } from '#/hooks/useData'
import { recordTitle, valueOf, displayValue } from '#/utils/records'
import { recordsToTable, toCsv } from '#/utils/csv'
import { copyText, downloadText, safeFileName } from '#/utils/download'
import { toast } from '#/utils/toast'
import { Button } from '#/components/ui/Button'
import { Field, Input, Switch, Textarea } from '#/components/ui/controls'
import { ColorPicker } from '#/components/ui/Overlays'
import { EmptyState, Notice } from '#/components/ui/misc'
import { useUiStore } from '#/stores/uiStore'

export function publicUrl(formId: string): string {
  if (typeof window === 'undefined') return `/f/${formId}`
  return `${window.location.origin}/f/${formId}`
}

export function PublicFormPanel({ form }: { form: Form }) {
  const p = form.public
  const set = (patch: Partial<Form['public']>) => useFormStore.getState().update(form.id, { public: { ...p, ...patch } })
  const url = publicUrl(form.id)
  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Switch checked={p.enabled} onChange={(v) => set({ enabled: v })} label="Public form enabled" />
        <Field label="Public title"><Input value={p.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Intro text"><Textarea className="min-h-[70px]" value={p.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <Field label="Submit button label"><Input value={p.submitLabel} onChange={(e) => set({ submitLabel: e.target.value })} /></Field>
        <Field label="Thank-you title"><Input value={p.thankYouTitle} onChange={(e) => set({ thankYouTitle: e.target.value })} /></Field>
        <Field label="Thank-you message"><Textarea className="min-h-[70px]" value={p.thankYouMessage} onChange={(e) => set({ thankYouMessage: e.target.value })} /></Field>
        <Field label="Redirect after submit (optional)" hint="Leave empty to show the thank-you message"><Input value={p.redirectUrl ?? ''} onChange={(e) => set({ redirectUrl: e.target.value || undefined })} placeholder="https://…" /></Field>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-5">
          <Field label="Accent colour"><ColorPicker value={p.accent} onChange={(c) => set({ accent: c })} /></Field>
          <Field label="Page background"><ColorPicker value={p.background} onChange={(c) => set({ background: c })} /></Field>
        </div>
        <Field label={`Corner radius: ${p.radius}px`}><input aria-label="Corner radius" type="range" min={0} max={28} value={p.radius} onChange={(e) => set({ radius: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" /></Field>
        <Switch checked={p.showBranding} onChange={(v) => set({ showBranding: v })} label="Show “Powered by Xcrm” footer" />
        <div className="rounded-xl border border-line p-3">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-medium">Form link <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">LOCAL PREVIEW ONLY</span></div>
          <div className="flex gap-2">
            <Input readOnly value={url} aria-label="Form URL" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => void copyText(url).then((ok) => (ok ? toast.success('Link copied') : toast.error('Could not copy', 'Select the link and copy it manually.')))}>Copy</Button>
            <Button disabled={!p.enabled} onClick={() => window.open(url, '_blank', 'noopener')}>Open</Button>
          </div>
          {!p.enabled && <p className="mt-2 text-xs text-muted">Enable the public form to open the link.</p>}
        </div>
        <Notice tone="warning">Xcrm has no server. This link only works in this browser, on this device, because forms and records live in local storage. Sharing it with someone else will show “form not found”. Publishing to the public internet would need a backend, which isn’t part of this app.</Notice>
      </div>
    </div>
  )
}

export function SubmissionsPanel({ form, module }: { form: Form; module: Module }) {
  const records = useRecords(module.id)
  const ctx = useCtx()
  const showRecord = useUiStore((s) => s.showRecord)
  const subs = useMemo(() => records.filter((r) => r.source === form.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [records, form.id])
  const cols = useMemo(() => form.sections.flatMap((s) => s.items.map((i) => module.fields.find((f) => f.id === i.fieldId))).filter((f): f is NonNullable<typeof f> => !!f).slice(0, 4), [form, module])
  if (!subs.length) return <EmptyState icon="Inbox" title="No submissions yet" description="Records created through this form’s public link appear here." />
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-muted">{subs.length} submission{subs.length === 1 ? '' : 's'} (soft-deleted records are excluded)</p>
        <Button size="sm" icon="Download" onClick={() => { downloadText(toCsv(recordsToTable(module, subs, ctx)), `${safeFileName(form.name)}-submissions.csv`, 'text/csv'); toast.success('Submissions exported') }}>Export CSV</Button>
      </div>
      <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">Submitted</th>{cols.map((c) => <th key={c.id} className="px-3 py-2 text-left">{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {subs.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 whitespace-nowrap">{format(new Date(r.createdAt), 'MMM d, yyyy HH:mm')}</td>
                {cols.map((c) => <td key={c.id} className="max-w-[200px] truncate px-3 py-2">{displayValue(c, valueOf(module, r, c, ctx), ctx) || '—'}</td>)}
                <td className="px-3 py-2 text-right"><Button size="xs" onClick={() => showRecord(module.id, r.id)} title={recordTitle(module, r, ctx)}>Open</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
