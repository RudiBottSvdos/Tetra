import type { Readable } from 'node:stream'
import { parseRange } from './range'
import { StorageError, type StorageProvider } from './types'

export interface MediaResponse {
  status: 200 | 206 | 404 | 416
  headers: Record<string, string>
  body?: Readable
}

/** Baut Antwort (Status, Header, Stream) fuer Vorschau/Download inkl. Range-Support. Framework-unabhaengig. */
export async function buildMediaResponse(
  storage: StorageProvider,
  key: string,
  opts: { rangeHeader?: string, download?: boolean, filename?: string }
): Promise<MediaResponse> {
  const st = await storage.stat(key)
  if (!st) return { status: 404, headers: {} }
  const base: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  }
  if (opts.download) {
    const name = (opts.filename ?? 'video.mp4').replace(/[^A-Za-z0-9._-]/g, '_')
    base['Content-Disposition'] = `attachment; filename="${name}"`
  }
  const r = parseRange(opts.rangeHeader, st.size)
  if (r.kind === 'unsatisfiable') return { status: 416, headers: { ...base, 'Content-Range': `bytes */${st.size}` } }
  try {
    if (r.kind === 'ok') {
      const { start, end } = r.range
      return {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
        body: await storage.get(key, r.range)
      }
    }
    return { status: 200, headers: { ...base, 'Content-Length': String(st.size) }, body: await storage.get(key) }
  } catch (e) {
    if (e instanceof StorageError && e.code === 'NOT_FOUND') return { status: 404, headers: {} }
    throw e
  }
}
