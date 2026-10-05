import type { LocalStorage } from './local'

export interface BufferVideoInfo {
  /** Lokaler Schluessel (video.file_path). */
  filePath: string | null
  /** true, wenn verifizierte Archivkopie existiert (storage_backend != local und storage_ref gesetzt). */
  archived: boolean
  /** Video ist verworfen (status rejected). */
  discarded: boolean
}

export interface CleanupOptions {
  retentionDays: number
  /** Obergrenze des Puffers in Bytes; aelteste archivierte/verworfene/verwaiste zuerst, nie Unarchiviertes. */
  maxBytes?: number
  /** .tmp-Reste aelter als diese Zeit werden entfernt (Default 24 h). */
  tmpMaxAgeMs?: number
  now?: Date
  dryRun?: boolean
}

export interface CleanupReport {
  deleted: string[]
  deletedBytes: number
  keptUnarchivedBytes: number
  totalBytesAfter: number
  overLimit: boolean
  warnings: string[]
}

const DAY = 86_400_000

/**
 * Retention des lokalen Puffers. Loescht NUR Dateien, die archiviert, verworfen oder verwaist (keinem Video
 * zugeordnet) UND aelter als die Frist sind; bei Ueberschreitung der Obergrenze auch juengere Kandidaten.
 * Unarchivierte Dateien zugeordneter, nicht verworfener Videos bleiben immer erhalten.
 */
export async function cleanupBuffer(local: LocalStorage, videos: BufferVideoInfo[], opts: CleanupOptions): Promise<CleanupReport> {
  const now = (opts.now ?? new Date()).getTime()
  const byKey = new Map(videos.filter(v => v.filePath).map(v => [v.filePath as string, v]))
  const isCandidate = (key: string) => {
    const v = byKey.get(key)
    return !v || v.archived || v.discarded
  }
  const report: CleanupReport = { deleted: [], deletedBytes: 0, keptUnarchivedBytes: 0, totalBytesAfter: 0, overLimit: false, warnings: [] }

  let remaining: Array<{ key: string, size: number, modifiedAt: Date }> = []
  const remove = async (f: { key: string, size: number }) => {
    if (!opts.dryRun) await local.delete(f.key)
    report.deleted.push(f.key)
    report.deletedBytes += f.size
  }

  for (const f of await local.list()) {
    const age = now - f.modifiedAt.getTime()
    if (f.temporary) {
      if (age > (opts.tmpMaxAgeMs ?? DAY)) {
        if (!opts.dryRun) await local.deleteTemporary(f.key)
        report.deleted.push(f.key)
        report.deletedBytes += f.size
      } else remaining.push(f)
      continue
    }
    if (isCandidate(f.key) && age >= opts.retentionDays * DAY) await remove(f)
    else remaining.push(f)
  }

  const total = () => remaining.reduce((s, f) => s + f.size, 0)
  if (opts.maxBytes !== undefined && total() > opts.maxBytes) {
    const evictable = remaining.filter(f => isCandidate(f.key)).sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime())
    for (const f of evictable) {
      if (total() <= opts.maxBytes) break
      await remove(f)
      remaining = remaining.filter(r => r.key !== f.key)
    }
    if (total() > opts.maxBytes) {
      report.overLimit = true
      report.warnings.push('Lokaler Puffer ueber Obergrenze; verbleibende Dateien sind nicht archiviert')
    }
  }
  report.keptUnarchivedBytes = remaining.filter(f => !isCandidate(f.key)).reduce((s, f) => s + f.size, 0)
  report.totalBytesAfter = total()
  return report
}
