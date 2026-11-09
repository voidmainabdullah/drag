import type { FileMeta } from '#/types'
import { uid } from '#/utils/id'
import { toast } from '#/utils/toast'

/** IndexedDB blob store for uploaded files (kept out of localStorage because of its small quota). */
const DB_NAME = 'xcrm-files'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB error'))
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => {
      db.close()
      resolve(req.result)
    }
    t.onerror = () => {
      db.close()
      reject(t.error ?? new Error('IndexedDB transaction failed'))
    }
  })
}

export async function saveFile(file: File | Blob, name?: string): Promise<FileMeta | null> {
  const id = uid('file')
  try {
    await tx('readwrite', (s) => s.put(file, id))
    const f = file as File
    return { id, name: name ?? f.name ?? 'file', size: file.size, type: file.type }
  } catch {
    toast.error('Could not store file', 'Browser file storage is unavailable or full.')
    return null
  }
}

export async function getFile(id: string): Promise<Blob | null> {
  try {
    const res = await tx<Blob | undefined>('readonly', (s) => s.get(id))
    return res ?? null
  } catch {
    return null
  }
}

export async function deleteFile(id: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(id))
  } catch {
    /* ignore */
  }
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

export async function exportFiles(ids: string[]): Promise<Record<string, { dataUrl: string }>> {
  const out: Record<string, { dataUrl: string }> = {}
  for (const id of ids) {
    const b = await getFile(id)
    if (b) out[id] = { dataUrl: await blobToDataUrl(b) }
  }
  return out
}

export async function importFiles(files: Record<string, { dataUrl: string }>): Promise<void> {
  for (const [id, f] of Object.entries(files)) {
    try {
      const blob = await (await fetch(f.dataUrl)).blob()
      await tx('readwrite', (s) => s.put(blob, id))
    } catch {
      /* skip */
    }
  }
}
