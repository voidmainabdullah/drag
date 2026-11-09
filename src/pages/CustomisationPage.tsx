import { useRef } from 'react'
import { useSettingsStore } from '#/stores/settingsStore'
import { usePerms } from '#/hooks/useData'
import { toast, confirmDialog } from '#/utils/toast'
import { Page } from '#/components/layout/Page'
import { Button } from '#/components/ui/Button'
import { Card, Notice, PageHeader, Segmented } from '#/components/ui/misc'
import { Field, Input } from '#/components/ui/controls'
import { ColorPicker } from '#/components/ui/Overlays'
import { Icon } from '#/components/ui/Icon'

const PRESETS = [
  { name: 'Violet', primary: '#7B68EE', accent: '#FD71AF' },
  { name: 'Ocean', primary: '#2563EB', accent: '#06B6D4' },
  { name: 'Forest', primary: '#16A34A', accent: '#84CC16' },
  { name: 'Sunset', primary: '#EA580C', accent: '#F43F5E' },
  { name: 'Graphite', primary: '#475569', accent: '#0EA5E9' },
]

/** Downscale an uploaded image to a small data URL so it fits comfortably in localStorage. */
async function toSmallDataUrl(file: File, max = 160): Promise<string> {
  const bitmapUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = bitmapUrl })
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * scale))
    c.height = Math.max(1, Math.round(img.height * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9)
  } finally {
    URL.revokeObjectURL(bitmapUrl)
  }
}

export function CustomisationPage() {
  const brand = useSettingsStore((s) => s.settings.brand)
  const setBrand = useSettingsStore((s) => s.setBrand)
  const perms = usePerms()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const can = perms.can('accessSettings')

  const upload = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/') || f.type === 'image/svg+xml') return toast.error('Choose a PNG, JPG, WebP or GIF image')
    if (f.size > 4 * 1024 * 1024) return toast.error('Image is too large', 'Use a file under 4 MB.')
    try { setBrand({ logo: await toSmallDataUrl(f) }); toast.success('Logo updated') } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed') }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Page title="Customisation" skeleton="form">
      <PageHeader title="Customisation" icon="Palette" description="Make Xcrm yours. Changes apply instantly and are saved in this browser."
        actions={can && <Button icon="RotateCcw" onClick={async () => { if (await confirmDialog({ title: 'Reset branding to defaults?', confirmLabel: 'Reset' })) { useSettingsStore.getState().resetBrand(); toast.success('Branding reset') } }}>Reset to defaults</Button>} />
      {!can && <div className="mb-4"><Notice>Your role can’t change branding. Dark mode below only affects what you see.</Notice></div>}
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">Brand</h3>
            <Field label="Brand name"><Input value={brand.brandName} disabled={!can} maxLength={32} onChange={(e) => setBrand({ brandName: e.target.value })} onBlur={() => { if (!brand.brandName.trim()) setBrand({ brandName: 'Xcrm' }) }} /></Field>
            <Field label="Logo" hint="Resized to fit; stored locally. Shown in the sidebar.">
              <div className="flex items-center gap-3">
                {brand.logo ? <img src={brand.logo} alt="Current logo" className="size-12 rounded-xl border border-line object-contain" /> : <span className="gradient-brand flex size-12 items-center justify-center rounded-xl text-lg font-bold text-white">{brand.brandName.slice(0, 1).toUpperCase()}</span>}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="Upload logo" onChange={(e) => void upload(e.target.files?.[0])} />
                <Button disabled={!can} icon="Upload" onClick={() => fileRef.current?.click()}>Upload logo</Button>
                {brand.logo && <Button variant="ghost" disabled={!can} onClick={() => { setBrand({ logo: undefined }); toast.success('Logo removed') }}>Remove</Button>}
              </div>
            </Field>
          </Card>
          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">Theme colours</h3>
            <div className="flex flex-wrap gap-2">{PRESETS.map((p) => (
              <button key={p.name} type="button" disabled={!can} onClick={() => setBrand({ primary: p.primary, accent: p.accent })} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px] hover:bg-subtle disabled:opacity-50">
                <span className="flex"><span className="size-4 rounded-l-full" style={{ background: p.primary }} /><span className="size-4 rounded-r-full" style={{ background: p.accent }} /></span>{p.name}
              </button>
            ))}</div>
            <div className="flex flex-wrap gap-6">
              <Field label="Primary colour"><ColorPicker value={brand.primary} onChange={(c) => can && setBrand({ primary: c })} /></Field>
              <Field label="Accent colour"><ColorPicker value={brand.accent} onChange={(c) => can && setBrand({ accent: c })} /></Field>
            </div>
          </Card>
          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <Field label="Mode"><Segmented<'light' | 'dark'> value={brand.theme} onChange={(v) => setBrand({ theme: v })} options={[{ id: 'light', label: 'Light', icon: 'Sun' }, { id: 'dark', label: 'Dark', icon: 'Moon' }]} /></Field>
            <Field label="Density" hint="Compact fits more rows on screen"><Segmented<'comfortable' | 'compact'> value={brand.density} onChange={(v) => setBrand({ density: v })} options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]} /></Field>
            <Field label={`Default form corner radius: ${brand.formRadius}px`}><input aria-label="Form corner radius" type="range" min={0} max={28} disabled={!can} value={brand.formRadius} onChange={(e) => setBrand({ formRadius: Number(e.target.value) })} className="w-full accent-[var(--color-primary)]" /></Field>
          </Card>
        </div>
        <Card className="h-fit space-y-3 p-5 lg:sticky lg:top-2">
          <h3 className="text-sm font-semibold">Preview</h3>
          <div className="flex items-center gap-2.5">{brand.logo ? <img src={brand.logo} alt="" className="size-8 rounded-lg object-contain" /> : <span className="gradient-brand flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white">{brand.brandName.slice(0, 1).toUpperCase()}</span>}<span className="text-[17px] font-bold">{brand.brandName}</span></div>
          <div className="gradient-brand rounded-xl p-4 text-sm text-white">Gradient banner</div>
          <div className="flex flex-wrap gap-2"><Button variant="primary">Primary</Button><Button variant="gradient">Gradient</Button><Button variant="soft">Soft</Button></div>
          <div className="flex items-center gap-2 text-sm"><Icon name="Check" size={14} className="text-primary" /> Links and focus rings use the primary colour</div>
        </Card>
      </div>
    </Page>
  )
}
