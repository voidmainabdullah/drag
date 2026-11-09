import { useRef, useState } from 'react'
import { Download, Paperclip, Trash2, Upload } from 'lucide-react'
import type { FileMeta, FieldType } from '#/types'
import { saveFile, deleteFile } from '#/services/storage/fileStorage'
import { useFileUrl, openStoredFile } from '#/hooks/useFileUrl'
import { formatBytes } from '#/utils/fieldTypes'
import { toast } from '#/utils/toast'
import { Button } from '#/components/ui/Button'
import { Spinner } from '#/components/ui/misc'

const MAX = 25 * 1024 * 1024

export function Thumb({ file, size = 40, fill }: { file: FileMeta; size?: number; fill?: boolean }) {
  const url = useFileUrl(file.type.startsWith('image/') ? file.id : undefined)
  const style = fill ? undefined : { width: size, height: size }
  if (!url) return <span className={fill ? 'flex size-full items-center justify-center bg-subtle text-muted' : 'flex shrink-0 items-center justify-center rounded-md bg-subtle text-muted'} style={style}><Paperclip size={fill ? 28 : size / 2.4} /></span>
  return <img src={url} alt={file.name} className={fill ? 'size-full object-cover' : 'shrink-0 rounded-md object-cover'} style={style} />
}

export function FileInput({ type, value, onChange, disabled }: { type: FieldType; value: FileMeta[]; onChange: (v: FileMeta[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const files = Array.isArray(value) ? value : []
  const accept = type === 'image' ? 'image/*' : type === 'document' ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt' : undefined

  const add = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    const added: FileMeta[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX) {
        toast.error('File too large', `${f.name} is over ${formatBytes(MAX)}.`)
        continue
      }
      const meta = await saveFile(f)
      if (meta) added.push(meta)
    }
    setBusy(false)
    if (added.length) onChange([...files, ...added])
    if (ref.current) ref.current.value = ''
  }

  return (
    <div className="space-y-2">
      {!disabled && (
        <div className="flex items-center gap-2">
          <input ref={ref} type="file" multiple accept={accept} className="hidden" aria-label="Choose files" onChange={(e) => void add(e.target.files)} />
          <Button size="sm" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? <Spinner size={14} /> : <Upload size={14} />} Upload {type === 'image' ? 'image' : type === 'document' ? 'document' : 'file'}
          </Button>
          <span className="text-xs text-muted">Stored in this browser (IndexedDB)</span>
        </div>
      )}
      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2.5 rounded-lg border border-line p-1.5 pr-2">
              <Thumb file={f} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{f.name}</div>
                <div className="text-[11px] text-muted">{formatBytes(f.size)}</div>
              </div>
              <button type="button" aria-label={`Download ${f.name}`} className="rounded p-1 text-muted hover:bg-subtle hover:text-fg" onClick={() => void openStoredFile(f.id, f.name, true)}>
                <Download size={14} />
              </button>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger"
                  onClick={() => {
                    void deleteFile(f.id)
                    onChange(files.filter((x) => x.id !== f.id))
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
