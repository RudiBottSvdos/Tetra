import { createHash } from 'node:crypto'
import { StorageError, type StorageProvider } from './types'

export interface ArchiveVideoRef {
  id: string
  storageBackend: string
  /** Lokaler Schluessel (video.file_path). */
  filePath: string | null
  localDeletedAt: Date | null
}

export interface ArchiveOutcome {
  storageBackend: string
  storageRef: string
  localDeletedAt: Date
}

export interface ArchiveOptions {
  /** Schluessel im Ziel; Default: gleicher Schluessel wie lokal. */
  targetKey?: string
  now?: () => Date
}

async function sha256Of(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash('sha256')
  for await (const c of stream) h.update(c)
  return h.digest('hex')
}

/**
 * Archiv-Ablauf (reine Logik, keine DB): lokal lesen -> Ziel put -> verifizieren (Groesse + SHA-256, Rueckleseprobe)
 * -> erst dann lokal loeschen. Bei jedem Fehler bleibt die lokale Datei erhalten.
 * Idempotent: bereits archivierte Videos (null-Rueckgabe) werden nicht erneut angefasst.
 * Der Aufrufer (Job) persistiert das Ergebnis (storage_backend, storage_ref, local_deleted_at).
 */
export async function archiveVideo(
  video: ArchiveVideoRef,
  local: StorageProvider,
  target: StorageProvider,
  opts: ArchiveOptions = {}
): Promise<ArchiveOutcome | null> {
  if (video.localDeletedAt || video.storageBackend === target.name) return null
  if (!video.filePath) throw new StorageError('Video hat keine lokale Datei', 'NOT_FOUND')
  const localStat = await local.stat(video.filePath)
  if (!localStat) throw new StorageError('Lokale Datei fehlt', 'NOT_FOUND')

  const key = opts.targetKey ?? video.filePath
  const put = await target.put(key, await local.get(video.filePath), { contentType: 'video/mp4' })

  const remoteStat = await target.stat(put.ref)
  const localHash = await sha256Of(await local.get(video.filePath))
  const ok = !!remoteStat
    && remoteStat.size === localStat.size
    && put.size === localStat.size
    && put.sha256 === localHash
    && (await sha256Of(await target.get(put.ref))) === localHash
  if (!ok) {
    await target.delete(put.ref).catch(() => {})
    throw new StorageError('Verifikation der Archivkopie fehlgeschlagen', 'VERIFY_FAILED')
  }

  await local.delete(video.filePath)
  return { storageBackend: target.name, storageRef: put.ref, localDeletedAt: (opts.now ?? (() => new Date()))() }
}
