import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useAllModules, useCtx, usePerms, useRecords } from '#/hooks/useData'
import { useSettingsStore } from '#/stores/settingsStore'
import { applyBackup, createBackup, planBackup, validateBackup, type Backup, type DuplicateMode, type MergeMode, type ValidationResult } from '#/services/storage/backupService'
import { storageUsage } from '#/services/storage/storageService'
import { recordsToTable, tableToXlsxBlob, toCsv } from '#/utils/csv'
import { downloadBlob, downloadText, safeFileName } from '#/utils/download'
import { formatBytes } from '#/utils/fieldTypes'
import { confirmDialog, toast } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Card, Notice, PageHeader, Spinner } from '#/components/ui/misc'
import { Field, Select, Switch } from '#/components/ui/controls'
import { ImportWizard } from '#/components/records/ImportWizard'
import { Icon } from '#/components/ui/Icon'

function Section({ icon, title, description, children }: { icon: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon name={icon} size={17} /></span>
        <div><h2 className="text-[15px] font-semibold">{title}</h2><p className="text-[13px] text-muted">{description}</p></div>
      </div>
      {children}
    </Card>
  )
}

function RestorePanel() {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [mode, setMode] = useState<MergeMode>('merge')
  const [dupes, setDupes] = useState<DuplicateMode>('skip')
  const [busy, setBusy] = useState(false)
  const plan = useMemo(() => (result?.ok && result.backup ? planBackup(result.backup, mode, dupes) : []), [result, mode, dupes])

  const pick = async (f: File | undefined) => {
    if (!f) return
    setFileName(f.name)
    setResult(null)
    try {
      const text = await f.text()
      setResult(validateBackup(JSON.parse(text)))
    } catch {
      setResult({ ok: false, errors: ['That file is not valid JSON.'], warnings: [] })
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const restore = async () => {
    if (!result?.backup) return
    const ok = await confirmDialog(mode === 'replace'
      ? { title: 'Replace ALL current data?', message: 'Every workspace, module, record and setting on this browser will be replaced by the backup. Download a backup of your current data first if you might need it.', confirmLabel: 'Replace everything', danger: true, requireText: 'REPLACE' }
      : { title: 'Merge backup into current data?', message: 'Nothing is removed. Items that already exist are handled as you chose.', confirmLabel: 'Merge' })
    if (!ok) return
    setBusy(true)
    const res = await applyBackup(result.backup as Backup, mode, dupes)
    setBusy(false)
    if (res.ok) { toast.success('Restore complete', res.message); setResult(null); setFileName('') } else toast.error('Restore failed', res.message)
  }

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Choose backup file" onChange={(e) => void pick(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-3"><Button icon="FileUp" onClick={() => fileRef.current?.click()}>Choose backup file…</Button>{fileName && <span className="text-[13px] text-muted">{fileName}</span>}</div>
      {result && !result.ok && (
        <div className="space-y-1 rounded-lg border border-danger/30 bg-danger/10 p-3 text-[13px]" role="alert"><div className="font-semibold">This backup can’t be restored</div><ul className="list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      {result?.ok && result.summary && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line p-3 text-[13px]">
            <div className="font-semibold">Backup from {format(new Date(result.summary.exportedAt), 'MMM d, yyyy HH:mm')} <span className="font-normal text-muted">· schema v{result.summary.schemaVersion}</span></div>
            <div className="mt-1 text-muted">Workspaces: {result.summary.workspaces.join(', ') || '—'} · {result.summary.fileCount} attached file(s) · {result.summary.includesSettings ? 'includes settings' : 'no settings'}</div>
          </div>
          {result.warnings.length > 0 && <Notice tone="warning"><ul className="list-disc pl-4">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Restore mode"><Select value={mode} onChange={(e) => setMode(e.target.value as MergeMode)}><option value="merge">Merge — add to what I have</option><option value="replace">Replace — overwrite everything</option></Select></Field>
            {mode === 'merge' && <Field label="When an item already exists"><Select value={dupes} onChange={(e) => setDupes(e.target.value as DuplicateMode)}><option value="skip">Skip it (keep mine)</option><option value="overwrite">Overwrite with the backup’s version</option><option value="duplicate">Keep both (import as a copy)</option></Select></Field>}
          </div>
          <div className="scroll-thin overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">What</th><th className="px-3 py-2 text-right">In backup</th><th className="px-3 py-2 text-right">Currently</th><th className="px-3 py-2 text-right">Added</th>{mode === 'merge' && <><th className="px-3 py-2 text-right">Overwritten</th><th className="px-3 py-2 text-right">Skipped</th><th className="px-3 py-2 text-right">Copied</th></>}</tr></thead>
              <tbody>{plan.map((r) => <tr key={r.label} className="border-t border-line"><td className="px-3 py-2 font-medium">{r.label}</td><td className="px-3 py-2 text-right tabular-nums">{r.incoming}</td><td className="px-3 py-2 text-right tabular-nums">{r.existing}</td><td className="px-3 py-2 text-right tabular-nums">{r.added}</td>{mode === 'merge' && <><td className="px-3 py-2 text-right tabular-nums">{r.overwritten}</td><td className="px-3 py-2 text-right tabular-nums">{r.skipped}</td><td className="px-3 py-2 text-right tabular-nums">{r.duplicated}</td></>}</tr>)}</tbody>
            </table>
          </div>
          {mode === 'replace' && <Notice tone="danger">Replace removes everything that isn’t in the backup, including records created since it was made.</Notice>}
          <div className="flex gap-2"><Button variant={mode === 'replace' ? 'danger' : 'primary'} icon="RotateCcw" disabled={busy} onClick={() => void restore()}>{busy ? 'Restoring…' : mode === 'replace' ? 'Replace with backup' : 'Merge backup'}</Button><Button variant="ghost" onClick={() => { setResult(null); setFileName('') }}>Cancel</Button>{busy && <Spinner />}</div>
        </div>
      )}
    </div>
  )
}

export function ImportExportPage() {
  const modules = useAllModules().filter((m) => !m.archived && !m.system)
  const perms = usePerms()
  const ctx = useCtx()
  const allRecords = useRecords()
  const lastBackupAt = useSettingsStore((s) => s.settings.lastBackupAt)
  const [importId, setImportId] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [exportId, setExportId] = useState('all')
  const [withFiles, setWithFiles] = useState(true)
  const [busy, setBusy] = useState(false)
  const importModule = modules.find((m) => m.id === importId) ?? modules[0]
  const usage = storageUsage()
  const canExport = perms.can('exportData')

  const exportData = async (kind: 'csv' | 'xlsx') => {
    if (!canExport) return toast.error('Your role cannot export data')
    const targets = exportId === 'all' ? modules : modules.filter((m) => m.id === exportId)
    const sheets = targets.map((m) => ({ name: m.name.slice(0, 28), rows: recordsToTable(m, allRecords.filter((r) => r.moduleId === m.id), ctx) }))
    if (!sheets.some((s) => s.rows.length > 1)) return toast.info('Nothing to export', 'There are no records in the selection.')
    if (kind === 'xlsx') downloadBlob(await tableToXlsxBlob(sheets), `${exportId === 'all' ? 'xcrm-all-modules' : safeFileName(targets[0].name)}.xlsx`)
    else if (sheets.length === 1) downloadText(toCsv(sheets[0].rows), `${safeFileName(targets[0].name)}.csv`, 'text/csv')
    else return toast.info('CSV holds one module', 'Pick a single module for CSV, or choose Excel to get one sheet per module.')
    toast.success('Export ready')
  }
  const backup = async () => {
    if (!canExport) return toast.error('Your role cannot export data')
    setBusy(true)
    try {
      const b = await createBackup(withFiles)
      downloadText(JSON.stringify(b, null, 2), `xcrm-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`, 'application/json')
      toast.success('Backup downloaded', 'Keep it somewhere safe — it contains all your data and any integration secrets.')
    } catch {
      toast.error('Backup failed', 'Something went wrong while collecting your data.')
    } finally { setBusy(false) }
  }

  return (
    <Page title="Import / Export" skeleton="cards">
      <PageHeader title="Import / Export" icon="ArrowLeftRight" description="Move data in from spreadsheets, out to files, and back up or restore the whole CRM." />
      <div className="space-y-5">
        <Section icon="FileUp" title="Import records" description="Upload a CSV or Excel file, map its columns to fields, check validation, and download a report of any rows that failed.">
          {modules.length === 0 ? <p className="text-[13px] text-muted">Create a module first.</p> : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Into module" className="w-60"><Select value={importModule?.id} onChange={(e) => setImportId(e.target.value)}>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
              <Button variant="primary" icon="Upload" disabled={!perms.canModule(importModule, 'create')} onClick={() => setImportOpen(true)}>Start import…</Button>
            </div>
          )}
        </Section>
        <Section icon="FileDown" title="Export records" description="Download records as CSV or Excel. Excel can bundle every module as separate sheets.">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Module" className="w-60"><Select value={exportId} onChange={(e) => setExportId(e.target.value)}><option value="all">All modules (Excel)</option>{modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Button icon="Download" disabled={!canExport} onClick={() => void exportData('csv')}>CSV</Button>
            <Button icon="Download" disabled={!canExport} onClick={() => void exportData('xlsx')}>Excel</Button>
          </div>
          {!canExport && <p className="mt-2 text-xs text-warning">Your role doesn’t include exporting data.</p>}
        </Section>
        <Section icon="HardDrive" title="Backup" description="Download everything — workspaces, modules, records, forms, views, dashboards, workflows, roles and settings — as one JSON file.">
          <div className="space-y-3">
            <Switch checked={withFiles} onChange={setWithFiles} label="Include attached files (can make the backup much larger)" />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon="Download" disabled={busy || !canExport} onClick={() => void backup()}>{busy ? 'Preparing…' : 'Download backup'}</Button>
              <span className="text-xs text-muted">Data in browser storage: {formatBytes(usage.bytes)} · {lastBackupAt ? `last backup ${format(new Date(lastBackupAt), 'MMM d, yyyy HH:mm')}` : 'no backup yet'}</span>
            </div>
          </div>
        </Section>
        <Section icon="RotateCcw" title="Restore from backup" description="Choose a backup file. You’ll see exactly what it contains and what will change before anything is written.">
          <RestorePanel />
        </Section>
      </div>
      {importModule && <ImportWizard module={importModule} open={importOpen} onClose={() => setImportOpen(false)} />}
    </Page>
  )
}
