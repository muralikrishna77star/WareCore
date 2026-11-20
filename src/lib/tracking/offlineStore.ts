// Browser only. What the Offline Scan screen keeps on the phone: the last
// snapshot of each warehouse, the scans not yet sent, and the scans the
// server refused. Cleared at sign-out.
import type { OfflineAction, OfflineSnapshot } from './offlineShared'

const DB_NAME = 'warecore-tracking-offline'
const DB_VERSION = 1
/** The service worker keeps the Offline Scan screen's own files in this cache. */
export const OFFLINE_SCAN_CACHE = 'warecore-offline-scan'

export interface QueuedAction extends OfflineAction {
  /** Order of scanning on this phone. */
  seq: number
  /** What the screen showed when it was saved, for the lists on the phone. */
  summary: string
}

export interface AttentionItem {
  id: string
  summary: string
  reason: string
  scanned_at: string
  refused_at: string
}

type StoreName = 'meta' | 'snapshots' | 'queue' | 'attention'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot keep scans on the phone'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots')
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('attention')) db.createObjectStore('attention', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('This browser cannot keep scans on the phone'))
  })
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode)
      const request = work(tx.objectStore(store))
      tx.oncomplete = () => resolve(request ? request.result : undefined)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('Saving on the phone failed'))
    })
  } finally {
    db.close()
  }
}

export const getMeta = async <T>(key: string) => (await run<T>('meta', 'readonly', (s) => s.get(key) as IDBRequest<T>)) ?? null
export const setMeta = (key: string, value: unknown) => run('meta', 'readwrite', (s) => { s.put(value, key) })
export const deleteMeta = (key: string) => run('meta', 'readwrite', (s) => { s.delete(key) })

/** A random id for this phone, kept until sign-out. */
export async function deviceId(): Promise<string> {
  const existing = await getMeta<string>('device_id')
  if (existing) return existing
  const id = `ph-${crypto.randomUUID()}`
  await setMeta('device_id', id)
  return id
}

export const saveSnapshot = (snapshot: OfflineSnapshot) =>
  run('snapshots', 'readwrite', (s) => { s.put(snapshot, snapshot.warehouse?.id ?? 'none') })
export const loadSnapshot = async (warehouseId: string) =>
  (await run<OfflineSnapshot>('snapshots', 'readonly', (s) => s.get(warehouseId) as IDBRequest<OfflineSnapshot>)) ?? null

export async function queueAdd(action: OfflineAction, summary: string): Promise<void> {
  const last = (await getMeta<number>('seq')) ?? 0
  const seq = Math.max(last, Date.now()) + 1
  await setMeta('seq', seq)
  await run('queue', 'readwrite', (s) => { s.put({ ...action, seq, summary } satisfies QueuedAction) })
}

export async function queueList(): Promise<QueuedAction[]> {
  const rows = (await run<QueuedAction[]>('queue', 'readonly', (s) => s.getAll() as IDBRequest<QueuedAction[]>)) ?? []
  return rows.sort((a, b) => a.seq - b.seq)
}

export const queueRemove = (ids: string[]) => run('queue', 'readwrite', (s) => { for (const id of ids) s.delete(id) })

export const attentionAdd = (items: AttentionItem[]) => run('attention', 'readwrite', (s) => { for (const item of items) s.put(item) })
export async function attentionList(): Promise<AttentionItem[]> {
  const rows = (await run<AttentionItem[]>('attention', 'readonly', (s) => s.getAll() as IDBRequest<AttentionItem[]>)) ?? []
  return rows.sort((a, b) => b.refused_at.localeCompare(a.refused_at))
}
export const attentionRemove = (id: string) => run('attention', 'readwrite', (s) => { s.delete(id) })

/** Scans on this phone not yet sent, by anyone. Never throws: 0 when nothing can be read. */
export async function unsentCount(): Promise<number> {
  try {
    return (await run<number>('queue', 'readonly', (s) => s.count())) ?? 0
  } catch {
    return 0
  }
}

/** Deletes everything tracking saved on this phone, including the cached screen. Never throws. */
export async function clearOfflineData(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      if (typeof indexedDB === 'undefined') { resolve(); return }
      const request = indexedDB.deleteDatabase(DB_NAME)
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  } catch { /* nothing saved */ }
  try {
    if (typeof caches !== 'undefined') await caches.delete(OFFLINE_SCAN_CACHE)
  } catch { /* nothing cached */ }
}
