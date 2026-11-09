import { useMemo, useState } from 'react'
import { useModules } from '#/hooks/useData'
import { useSelectionStore } from '#/stores/selectionStore'
import { FIELD_TYPE_MAP, FIELD_TYPES } from '#/utils/fieldTypes'
import { Page } from '#/components/layout/Page'
import { useGo } from '#/components/layout/AppLink'
import { Button } from '#/components/ui/Button'
import { Badge, EmptyState, PageHeader } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { SearchInput, Select } from '#/components/ui/controls'
import { cn } from '#/utils/id'
import { FieldManager } from '#/builders/ModuleBuilder/FieldManager'
import type { FieldType } from '#/types'

export function FieldsPage() {
  const modules = useModules({ includeArchived: true })
  const go = useGo()
  const sel = useSelectionStore()
  const [q, setQ] = useState('')
  const [type, setType] = useState<FieldType | ''>('')
  const module = modules.find((m) => m.id === sel.moduleId) ?? modules[0]
  const searching = q.trim() !== '' || type !== ''
  const results = useMemo(() => modules.flatMap((m) => m.fields.filter((f) => (!type || f.type === type) && (!q || `${f.label} ${f.name}`.toLowerCase().includes(q.toLowerCase()))).map((f) => ({ m, f }))), [modules, q, type])
  return (
    <Page title="Field Manager" skeleton="table" wide>
      <PageHeader title="Field Manager" icon="Columns3" description="Every field across every module. Search globally, or pick a module to add, reorder, edit and delete its fields." />
      {modules.length === 0 ? (
        <EmptyState icon="Columns3" title="No modules yet" description="Fields belong to modules. Create a module first." action={<Button variant="primary" onClick={() => go('/module-builder')}>Open Module Builder</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search fields in all modules…" className="w-full max-w-xs" />
            <Select aria-label="Filter by type" className="w-48" value={type} onChange={(e) => setType(e.target.value as FieldType | '')}><option value="">All types</option>{FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select>
            {searching && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setType('') }}>Clear</Button>}
          </div>
          {searching ? (
            results.length === 0 ? <EmptyState icon="SearchX" title="No matching fields" /> : (
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-[13px]">
                  <thead className="bg-subtle/70 text-xs text-muted"><tr><th className="px-3 py-2 text-left">Field</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Module</th><th /></tr></thead>
                  <tbody>{results.map(({ m, f }) => (
                    <tr key={m.id + f.id} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{f.label}{f.required && <span className="ml-1 text-danger">*</span>}</td>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-muted"><Icon name={FIELD_TYPE_MAP[f.type].icon} size={13} />{FIELD_TYPE_MAP[f.type].label}</span></td>
                      <td className="px-3 py-2"><Badge color={m.color}>{m.name}</Badge></td>
                      <td className="px-3 py-2 text-right"><Button size="xs" onClick={() => { setQ(''); setType(''); sel.set({ moduleId: m.id }) }}>Manage</Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )
          ) : (
            <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
              <nav aria-label="Modules" className="scroll-thin max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-2">
                {modules.map((m) => (
                  <button key={m.id} type="button" onClick={() => sel.set({ moduleId: m.id })} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]', module?.id === m.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-subtle')}>
                    <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: m.color }}><Icon name={m.icon} size={13} /></span>
                    <span className="min-w-0 flex-1 truncate">{m.name}</span><span className="text-[11px] text-muted">{m.fields.length}</span>
                  </button>
                ))}
              </nav>
              <div className="min-w-0 rounded-xl border border-line bg-surface p-5">{module && <FieldManager key={module.id} module={module} />}</div>
            </div>
          )}
        </>
      )}
    </Page>
  )
}
