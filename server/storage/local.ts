import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { StorageError, type ByteRange, type PutOptions, type PutResult, type StorageAccess, type StorageProvider, type StorageStat } from './types'

export const DEFAULT_MEDIA_BUFFER_DIR = './data/media'
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const TMP_SUFFIX = '.tmp'

export function resolveBufferDir(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env.MEDIA_BUFFER_DIR?.trim() || DEFAULT_MEDIA_BUFFER_DIR)
}

/** Validiert einen Schluessel ("a/b/c.mp4"): nur sichere Segmente, kein "..", keine absoluten Pfade. */
export function assertSafeKey(key: string): string[] {
  if (typeof key !== 'string' || !key || key.length > 512 || key.includes('\0') || key.includes('\\') || key.startsWith('/')) {
    throw new StorageError('Ungueltiger Speicherschluessel', 'INVALID_KEY')
  }
  const segs = key.split('/')
  for (const s of segs) {
    if (!SEGMENT_RE.test(s) || s.endsWith(TMP_SUFFIX) || s.includes('..')) {
      throw new StorageError('Ungueltiger Speicherschluessel', 'INVALID_KEY')
    }
  }
  return segs
}

export interface LocalFileInfo extends StorageStat { key: string, temporary: boolean }

export class LocalStorage implements StorageProvider {
  readonly name = 'local'
  readonly root: string

  constructor(root: string = resolveBufferDir()) {
    this.root = path.resolve(root)
  }

  /** Absoluter Pfad, garantiert innerhalb von root. */
  resolve(key: string): string {
    const full = path.resolve(this.root, ...assertSafeKey(key))
    if (!full.startsWith(this.root + path.sep)) throw new StorageError('Pfad ausserhalb des Puffers', 'INVALID_KEY')
    return full
  }

  async put(key: string, data: Readable | AsyncIterable<Uint8Array>, _opts?: PutOptions): Promise<PutResult> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    const tmp = `${target}.${randomUUID()}${TMP_SUFFIX}`
    const hash = createHash('sha256')
    let size = 0
    const source = data instanceof Readable ? data : Readable.from(data)
    try {
      await pipeline(
        source,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const c of chunks) {
            hash.update(c)
            size += c.byteLength
            yield c
          }
        },
        createWriteStream(tmp, { flags: 'wx' })
      )
      await rename(tmp, target)
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {})
      throw new StorageError(`Schreiben fehlgeschlagen: ${(e as Error).message}`, 'IO')
    }
    return { ref: key, size, sha256: hash.digest('hex') }
  }

  async get(key: string, range?: ByteRange): Promise<Readable> {
    const p = this.resolve(key)
    const st = await this.stat(key)
    if (!st) throw new StorageError('Datei nicht gefunden', 'NOT_FOUND')
    if (range && (range.start < 0 || range.end < range.start || range.end >= st.size)) {
      throw new StorageError('Ungueltiger Bereich', 'IO')
    }
    return createReadStream(p, range ? { start: range.start, end: range.end } : undefined)
  }

  async stat(key: string): Promise<StorageStat | null> {
    const p = this.resolve(key)
    try {
      const s = await fsStat(p)
      return s.isFile() ? { size: s.size, modifiedAt: s.mtime } : null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new StorageError((e as Error).message, 'IO')
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null
  }

  async delete(key: string): Promise<boolean> {
    const p = this.resolve(key)
    if (!(await this.exists(key))) return false
    await rm(p, { force: true })
    return true
  }

  async getAccess(key: string): Promise<StorageAccess> {
    return { kind: 'local-file', path: this.resolve(key) }
  }

  /** Alle Dateien (Schluessel "/"-getrennt); .tmp-Reste sind als temporary markiert. */
  async list(): Promise<LocalFileInfo[]> {
    const out: LocalFileInfo[] = []
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        if (e.isDirectory()) await walk(path.join(dir, e.name), rel)
        else if (e.isFile()) {
          const s = await fsStat(path.join(dir, e.name))
          out.push({ key: rel, size: s.size, modifiedAt: s.mtime, temporary: e.name.endsWith(TMP_SUFFIX) })
        }
      }
    }
    await walk(this.root, '')
    return out
  }

  /** Entfernt einen verwaisten Temp-Rest (nur .tmp-Dateien innerhalb root). */
  async deleteTemporary(key: string): Promise<void> {
    const full = path.resolve(this.root, ...key.split('/'))
    if (!full.startsWith(this.root + path.sep) || !full.endsWith(TMP_SUFFIX)) {
      throw new StorageError('Keine Temp-Datei', 'INVALID_KEY')
    }
    await rm(full, { force: true })
  }
}
