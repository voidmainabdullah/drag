import { useState } from 'react'
import { useFormStore } from '#/stores/collections'
import { useModuleStore } from '#/stores/moduleStore'
import { useRecordStore } from '#/stores/recordStore'
import { useHydrated, usePageTitle } from '#/hooks/useData'
import { FormRenderer } from '#/components/fields/FormRenderer'
import { Skeleton } from '#/components/ui/misc'
import { Icon } from '#/components/ui/Icon'
import { AppLink } from '#/components/layout/AppLink'

function Shell({ bg, children }: { bg?: string; children: React.ReactNode }) {
  return <div className="min-h-screen px-4 py-10" style={{ background: bg ?? 'var(--bg)' }}><div className="mx-auto w-full max-w-xl">{children}</div></div>
}

export function PublicFormPage({ formId }: { formId: string }) {
  const hydrated = useHydrated()
  const form = useFormStore((s) => s.items.find((f) => f.id === formId))
  const module = useModuleStore((s) => s.modules.find((m) => m.id === form?.moduleId))
  const [done, setDone] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [error, setError] = useState<string | null>(null)
  usePageTitle(form?.public.enabled ? `${form.public.title || form.name} · Xcrm` : 'Form · Xcrm')

  if (!hydrated) return <Shell><Skeleton className="mb-4 h-8 w-2/3" /><Skeleton className="h-64 w-full rounded-2xl" /></Shell>

  if (!form || !module || module.archived || !form.public.enabled) {
    return (
      <Shell>
        <div className="rounded-2xl border border-line bg-surface p-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon name="FileX" size={22} /></div>
          <h1 className="text-lg font-semibold">{form && !form.public.enabled ? 'This form is not accepting responses' : 'Form not found'}</h1>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">Xcrm stores everything in your own browser, so this link only works on the device and browser where the form was created.</p>
          <AppLink to="/" className="mt-4 inline-block text-[13px] font-medium text-primary hover:underline">Open Xcrm</AppLink>
        </div>
      </Shell>
    )
  }

  const p = form.public
  const accentStyle = { ['--primary' as string]: p.accent } as React.CSSProperties

  if (done) {
    return (
      <Shell bg={p.background}>
        <div style={{ ...accentStyle, borderRadius: p.radius }} className="border border-line bg-surface p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full text-white" style={{ background: p.accent }}><Icon name="Check" size={24} /></div>
          <h1 className="text-xl font-semibold">{p.thankYouTitle || 'Thank you!'}</h1>
          <p className="mt-1 text-[14px] text-muted">{p.thankYouMessage}</p>
          <button type="button" className="mt-5 text-[13px] font-medium hover:underline" style={{ color: p.accent }} onClick={() => { setDone(false); setNonce((n) => n + 1) }}>Submit another response</button>
        </div>
        {p.showBranding && <p className="mt-4 text-center text-xs text-muted">Powered by Xcrm</p>}
      </Shell>
    )
  }

  return (
    <Shell bg={p.background}>
      <div style={{ ...accentStyle, borderRadius: p.radius }} className="border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold">{p.title || form.name}</h1>
        {p.description && <p className="mt-1 mb-5 text-[14px] text-muted">{p.description}</p>}
        {error && <div role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px]">{error}</div>}
        <div className="mt-5">
          <FormRenderer
            key={nonce}
            module={module}
            sections={form.sections}
            roleAccess={false}
            accent={p.accent}
            radius={p.radius}
            submitLabel={p.submitLabel || 'Submit'}
            onSubmit={(data) => {
              const res = useRecordStore.getState().create(module.id, data, { source: form.id })
              if ('errors' in res && res.errors) { setError(Object.values(res.errors)[0] ?? 'Could not save your response'); return }
              setError(null)
              if (p.redirectUrl && /^https?:\/\//i.test(p.redirectUrl)) { window.location.href = p.redirectUrl; return }
              setDone(true)
            }}
          />
        </div>
      </div>
      {p.showBranding && <p className="mt-4 text-center text-xs text-muted">Powered by Xcrm</p>}
    </Shell>
  )
}
