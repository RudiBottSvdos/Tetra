import { mkdtemp, rm, writeFile, utimes, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalStorage } from '../server/storage/local'
import { parseRange } from '../server/storage/range'
import { archiveVideo } from '../server/storage/archive'
import { cleanupBuffer } from '../server/storage/cleanup'
import { buildMediaResponse } from '../server/storage/serve'
import { StorageError, type StorageProvider } from '../server/storage/types'

let dir: string
let local: LocalStorage
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tetra-media-'))
  local = new LocalStorage(dir)
})
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const bytes = (s: string) => Readable.from([Buffer.from(s)])
async function read(s: Readable): Promise<string> {
  const parts: Buffer[] = []
  for await (const c of s) parts.push(Buffer.from(c))
  return Buffer.concat(parts).toString()
}

describe('LocalStorage', () => {
  it('put/get/stat/exists/delete', async () => {
    const r = await local.put('p1/a.mp4', bytes('0123456789'))
    expect(r.size).toBe(10)
    expect(r.sha256).toHaveLength(64)
    expect((await local.stat('p1/a.mp4'))?.size).toBe(10)
    expect(await read(await local.get('p1/a.mp4'))).toBe('0123456789')
    expect(await read(await local.get('p1/a.mp4', { start: 2, end: 4 }))).toBe('234')
    expect(await local.delete('p1/a.mp4')).toBe(true)
    expect(await local.delete('p1/a.mp4')).toBe(false)
    expect(await local.exists('p1/a.mp4')).toBe(false)
  })

  it('weist Pfad-Traversal und unsichere Schluessel ab', async () => {
    for (const k of ['../x.mp4', 'a/../../x.mp4', '/etc/passwd', 'a\\b.mp4', '', 'a//b.mp4', '..', 'a/.hidden', 'x.tmp', 'a\0b']) {
      await expect(local.put(k, bytes('x'))).rejects.toMatchObject({ code: 'INVALID_KEY' })
      await expect(local.stat(k)).rejects.toBeInstanceOf(StorageError)
    }
  })

  it('schreibt atomar: bei Abbruch bleibt weder Ziel noch tmp', async () => {
    async function* broken() { yield Buffer.from('abc'); throw new Error('boom') }
    await expect(local.put('v/b.mp4', broken())).rejects.toMatchObject({ code: 'IO' })
    expect(await local.exists('v/b.mp4')).toBe(false)
    expect(await readdir(path.join(dir, 'v'))).toEqual([])
  })

  it('get auf fehlende Datei -> NOT_FOUND', async () => {
    await expect(local.get('nope.mp4')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('parseRange', () => {
  it('Varianten', () => {
    expect(parseRange(undefined, 10)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-3', 10)).toEqual({ kind: 'ok', range: { start: 0, end: 3 } })
    expect(parseRange('bytes=5-', 10)).toEqual({ kind: 'ok', range: { start: 5, end: 9 } })
    expect(parseRange('bytes=-3', 10)).toEqual({ kind: 'ok', range: { start: 7, end: 9 } })
    expect(parseRange('bytes=5-100', 10)).toEqual({ kind: 'ok', range: { start: 5, end: 9 } })
    expect(parseRange('bytes=10-12', 10)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-1,3-4', 10)).toEqual({ kind: 'none' })
  })
})

describe('buildMediaResponse', () => {
  it('200, 206, 416, 404 mit video/mp4', async () => {
    await local.put('a.mp4', bytes('0123456789'))
    const full = await buildMediaResponse(local, 'a.mp4', {})
    expect(full.status).toBe(200)
    expect(full.headers['Content-Type']).toBe('video/mp4')
    expect(full.headers['Content-Length']).toBe('10')
    full.body?.destroy()
    const part = await buildMediaResponse(local, 'a.mp4', { rangeHeader: 'bytes=2-5' })
    expect(part.status).toBe(206)
    expect(part.headers['Content-Range']).toBe('bytes 2-5/10')
    expect(await read(part.body!)).toBe('2345')
    expect((await buildMediaResponse(local, 'a.mp4', { rangeHeader: 'bytes=20-' })).status).toBe(416)
    expect((await buildMediaResponse(local, 'x.mp4', {})).status).toBe(404)
    const dl = await buildMediaResponse(local, 'a.mp4', { download: true, filename: 'a b"c.mp4' })
    expect(dl.headers['Content-Disposition']).toBe('attachment; filename="a_b_c.mp4"')
    dl.body?.destroy()
  })
})

/** Fake-Remote (in-memory) mit Fehlerinjektion. */
class FakeRemote implements StorageProvider {
  name = 'onedrive'
  files = new Map<string, Buffer>()
  failPut = false
  corrupt = false
  async put(key: string, data: Readable | AsyncIterable<Uint8Array>) {
    if (this.failPut) throw new StorageError('remote down', 'IO')
    const parts: Buffer[] = []
    for await (const c of data) parts.push(Buffer.from(c))
    let buf = Buffer.concat(parts)
    if (this.corrupt) buf = Buffer.concat([buf.subarray(0, buf.length - 1), Buffer.from('X')])
    this.files.set(key, buf)
    const { createHash } = await import('node:crypto')
    return { ref: key, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
  }
  async get(key: string) { return Readable.from([this.files.get(key)!]) }
  async stat(key: string) { const f = this.files.get(key); return f ? { size: f.length, modifiedAt: new Date() } : null }
  async exists(key: string) { return this.files.has(key) }
  async delete(key: string) { return this.files.delete(key) }
  async getAccess(key: string) { return { kind: 'url' as const, url: `https://x/${key}`, expiresAt: new Date() } }
}

describe('archiveVideo', () => {
  const video = { id: 'v1', storageBackend: 'local', filePath: 'p/v1.mp4', localDeletedAt: null }

  it('Erfolg: Ziel gefuellt, lokal geloescht', async () => {
    await local.put('p/v1.mp4', bytes('hello video'))
    const remote = new FakeRemote()
    const out = await archiveVideo(video, local, remote, { targetKey: 'Proj/2026-10/v1.mp4', now: () => new Date(0) })
    expect(out).toEqual({ storageBackend: 'onedrive', storageRef: 'Proj/2026-10/v1.mp4', localDeletedAt: new Date(0) })
    expect(remote.files.get('Proj/2026-10/v1.mp4')?.toString()).toBe('hello video')
    expect(await local.exists('p/v1.mp4')).toBe(false)
  })

  it('Fehler beim Upload: lokal bleibt', async () => {
    await local.put('p/v1.mp4', bytes('hello'))
    const remote = new FakeRemote()
    remote.failPut = true
    await expect(archiveVideo(video, local, remote)).rejects.toBeInstanceOf(StorageError)
    expect(await local.exists('p/v1.mp4')).toBe(true)
  })

  it('Verifikation schlaegt fehl: lokal bleibt, Ziel-Kopie entfernt', async () => {
    await local.put('p/v1.mp4', bytes('hello'))
    const remote = new FakeRemote()
    remote.corrupt = true
    await expect(archiveVideo(video, local, remote)).rejects.toMatchObject({ code: 'VERIFY_FAILED' })
    expect(await local.exists('p/v1.mp4')).toBe(true)
    expect(remote.files.size).toBe(0)
  })

  it('idempotent: bereits archiviert -> null', async () => {
    expect(await archiveVideo({ ...video, localDeletedAt: new Date() }, local, new FakeRemote())).toBeNull()
  })
})

describe('cleanupBuffer', () => {
  const OLD = new Date('2026-01-01T00:00:00Z')
  const NOW = new Date('2026-10-01T00:00:00Z')
  async function mk(key: string, content: string, mtime: Date) {
    await local.put(key, bytes(content))
    await utimes(local.resolve(key), mtime, mtime)
  }

  it('loescht nur archivierte/verworfene/verwaiste nach Frist, nie Unarchiviertes', async () => {
    await mk('a/archived.mp4', 'aaaa', OLD)
    await mk('a/pending.mp4', 'bbbb', OLD)
    await mk('a/rejected.mp4', 'cccc', OLD)
    await mk('a/orphan.mp4', 'dddd', OLD)
    await mk('a/fresh-archived.mp4', 'eeee', NOW)
    const rep = await cleanupBuffer(local, [
      { filePath: 'a/archived.mp4', archived: true, discarded: false },
      { filePath: 'a/pending.mp4', archived: false, discarded: false },
      { filePath: 'a/rejected.mp4', archived: false, discarded: true },
      { filePath: 'a/fresh-archived.mp4', archived: true, discarded: false }
    ], { retentionDays: 7, now: NOW })
    expect(rep.deleted.sort()).toEqual(['a/archived.mp4', 'a/orphan.mp4', 'a/rejected.mp4'])
    expect(await local.exists('a/pending.mp4')).toBe(true)
    expect(await local.exists('a/fresh-archived.mp4')).toBe(true)
    expect(rep.keptUnarchivedBytes).toBe(4)
  })

  it('Obergrenze entfernt aelteste Kandidaten, Unarchiviertes bleibt, Warnung', async () => {
    await mk('b/old.mp4', '1111', new Date('2026-09-28T00:00:00Z'))
    await mk('b/newer.mp4', '2222', new Date('2026-09-30T00:00:00Z'))
    await mk('b/pending.mp4', '3333', OLD)
    const info = [
      { filePath: 'b/old.mp4', archived: true, discarded: false },
      { filePath: 'b/newer.mp4', archived: true, discarded: false },
      { filePath: 'b/pending.mp4', archived: false, discarded: false }
    ]
    const rep = await cleanupBuffer(local, info, { retentionDays: 30, maxBytes: 2, now: NOW })
    expect(rep.deleted).toEqual(['b/old.mp4', 'b/newer.mp4'])
    expect(rep.overLimit).toBe(true)
    expect(rep.warnings).toHaveLength(1)
    expect(await local.exists('b/pending.mp4')).toBe(true)
  })

  it('dryRun loescht nichts; alte .tmp-Reste werden entfernt', async () => {
    await mk('c/x.mp4', 'xx', OLD)
    const tmp = path.join(dir, 'c', 'x.mp4.abc.tmp')
    await writeFile(tmp, 'partial')
    await utimes(tmp, OLD, OLD)
    const dry = await cleanupBuffer(local, [], { retentionDays: 1, now: NOW, dryRun: true })
    expect(dry.deleted).toHaveLength(2)
    expect(await local.exists('c/x.mp4')).toBe(true)
    expect(await readFile(tmp, 'utf8')).toBe('partial')
    await cleanupBuffer(local, [], { retentionDays: 1, now: NOW })
    expect(await readdir(path.join(dir, 'c'))).toEqual([])
  })
})
