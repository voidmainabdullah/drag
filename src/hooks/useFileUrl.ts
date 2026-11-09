import { useEffect, useState } from 'react'
import { getFile } from '#/services/storage/fileStorage'

export function useFileUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let created: string | null = null
    setUrl(null)
    if (!id) return
    void getFile(id).then((b) => {
      if (revoked || !b) return
      created = URL.createObjectURL(b)
      setUrl(created)
    })
    return () => {
      revoked = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [id])
  return url
}

export async function openStoredFile(id: string, name: string, download = false) {
  const b = await getFile(id)
  if (!b) return false
  const url = URL.createObjectURL(b)
  if (download) {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } else window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return true
}
