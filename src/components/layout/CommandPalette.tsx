import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useUiStore } from '#/stores/uiStore'
import { useSettingsStore } from '#/stores/settingsStore'
import { useAllModules, useCtx, usePerms, useRecords, useWsId } from '#/hooks/useData'
import { recordTitle, displayValue, valueOf } from '#/utils/records'
import { DEFAULT_SECTIONS } from '#/services/navService'
import { Icon } from '#/components/ui/Icon'
import { cn } from '#/utils/id'
import { useGo } from './AppLink'

interface Result {
  id: string
  group: string
  label: string
  sub?: string
  icon: string
  run: () => void
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandOpen)
  const setOpen = useUiStore((s) => s.setCommandOpen)
  const showRecord = useUiStore((s) => s.showRecord)
  const setBrand = useSettingsStore((s) => s.setBrand)
  const theme = useSettingsStore((s) => s.settings.brand.theme)
  const modules = useAllModules()
  const records = useRecords()
  const ctx = useCtx()
  const perms = usePerms()
  const ws = useWsId()
  const addRecent = useSettingsStore((s) => s.addRecent)
  const go = useGo()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        useUiStore.getState().setCommandOpen(!useUiStore.getState().commandOpen)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const results = useMemo<Result[]>(() => {
    const s = q.trim().toLowerCase()
    const out: Result[] = []
    const actions: Result[] = [
      { id: 'a-theme', group: 'Actions', label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? 'Sun' : 'Moon', run: () => setBrand({ theme: theme === 'dark' ? 'light' : 'dark' }) },
      { id: 'a-module', group: 'Actions', label: 'Create a new module', icon: 'Box', run: () => go('/module-builder') },
      { id: 'a-template', group: 'Actions', label: 'Browse template library', icon: 'LayoutTemplate', run: () => go('/templates') },
      { id: 'a-backup', group: 'Actions', label: 'Backup & restore', icon: 'Download', run: () => go('/import-export') },
    ]
    const pages: Result[] = DEFAULT_SECTIONS.flatMap((sec) => sec.items.map((p) => ({ id: `p-${p.key}`, group: 'Pages', label: p.label, sub: sec.label, icon: p.icon, run: () => go(p.path) })))
    const mods: Result[] = modules.filter((m) => perms.canModule(m, 'view')).map((m) => ({ id: `m-${m.id}`, group: 'Modules', label: m.name, sub: m.description, icon: m.icon, run: () => go(`/m/${m.id}`) }))
    if (!s) return [...mods.slice(0, 6), ...pages.slice(0, 6), ...actions]
    const match = (r: Result) => r.label.toLowerCase().includes(s) || (r.sub ?? '').toLowerCase().includes(s)
    out.push(...mods.filter(match), ...pages.filter(match), ...actions.filter(match))
    let n = 0
    for (const r of records) {
      if (n >= 25) break
      const m = ctx.modules.get(r.moduleId)
      if (!m || m.archived || !perms.canModule(m, 'view')) continue
      const title = recordTitle(m, r, ctx)
      const hit = title.toLowerCase().includes(s) || m.fields.some((f) => f.type !== 'password' && displayValue(f, valueOf(m, r, f, ctx), ctx).toLowerCase().includes(s))
      if (!hit) continue
      n++
      out.push({ id: `r-${r.id}`, group: 'Records', label: title, sub: m.name, icon: m.icon, run: () => { addRecent(ws, { moduleId: m.id, recordId: r.id, label: title }); showRecord(m.id, r.id) } })
    }
    return out
  }, [q, modules, records, ctx, perms, theme, ws, go, setBrand, setOpen, addRecent, showRecord])

  if (!open || typeof document === 'undefined') return null
  const exec = (r?: Result) => {
    if (!r) return
    setOpen(false)
    r.run()
  }

  let last = ''
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="pop-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') exec(results[idx])
              else if (e.key === 'Escape') setOpen(false)
            }}
            placeholder="Search modules, records, pages and actions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none"
            aria-label="Search"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">ESC</kbd>
        </div>
        <div className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted">No results for “{q}”.</div>}
          {results.map((r, i) => {
            const header = r.group !== last
            last = r.group
            return (
              <div key={r.id}>
                {header && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{r.group}</div>}
                <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => exec(r)} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm', i === idx ? 'bg-primary/10' : 'hover:bg-subtle')}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-subtle text-muted"><Icon name={r.icon} size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.label}</span>
                    {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                  </span>
                  {i === idx && <CornerDownLeft size={13} className="text-muted" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}
