import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decrypt, encrypt, maskSecret, parseKey } from '../server/utils/crypto'
import { createSecretStore, type SecretRepo } from '../server/utils/secrets'

const K1 = randomBytes(32).toString('hex')
const K2 = randomBytes(32).toString('base64')
const saved = { k: process.env.ENCRYPTION_KEY, p: process.env.ENCRYPTION_KEY_PREVIOUS }

beforeEach(() => {
  process.env.ENCRYPTION_KEY = K1
  delete process.env.ENCRYPTION_KEY_PREVIOUS
})
afterEach(() => {
  for (const [n, v] of [['ENCRYPTION_KEY', saved.k], ['ENCRYPTION_KEY_PREVIOUS', saved.p]] as const) {
    if (v === undefined) delete process.env[n]
    else process.env[n] = v
  }
})

function memRepo(): SecretRepo & { g: Map<string, string>, p: Map<string, string> } {
  const g = new Map<string, string>()
  const p = new Map<string, string>()
  return {
    g, p,
    getGlobal: async k => g.get(k),
    setGlobal: async (k, v) => void g.set(k, v),
    deleteGlobal: async k => void g.delete(k),
    listGlobal: async () => [...g].map(([key, valueEnc]) => ({ key, valueEnc })),
    getProject: async (id, k) => p.get(`${id}|${k}`),
    setProject: async (id, k, v) => void p.set(`${id}|${k}`, v),
    deleteProject: async (id, k) => void p.delete(`${id}|${k}`),
    listProject: async id => [...p].filter(([k]) => k.startsWith(`${id}|`)).map(([k, valueEnc]) => ({ key: k.split('|')[1]!, valueEnc }))
  }
}

describe('crypto', () => {
  it('roundtrip (hex und base64 Key)', () => {
    expect(decrypt(encrypt('geheim äöü'))).toBe('geheim äöü')
    process.env.ENCRYPTION_KEY = K2
    expect(decrypt(encrypt('x'))).toBe('x')
  })
  it('IV wird nie wiederverwendet', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })
  it('manipulierter Ciphertext/Tag wird abgelehnt', () => {
    const buf = Buffer.from(encrypt('payload').slice(3), 'base64')
    for (const idx of [14, buf.length - 1]) { // Tag bzw. Ciphertext
      const t = Buffer.from(buf)
      t[idx] = t[idx]! ^ 0xff
      expect(() => decrypt(`v1:${t.toString('base64')}`)).toThrow()
    }
    expect(() => decrypt('garbage')).toThrow()
  })
  it('falscher Key schlaegt fehl', () => {
    const enc = encrypt('payload')
    process.env.ENCRYPTION_KEY = K2
    expect(() => decrypt(enc)).toThrow(/Decryption failed/)
  })
  it('Key-Validierung ist lazy und ohne Key-Leak', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('x')).toThrow(/not set/)
    process.env.ENCRYPTION_KEY = 'zu-kurz'
    expect(() => encrypt('x')).toThrow(/32 bytes/)
    expect(() => parseKey('zu-kurz')).toThrow(/^(?!.*zu-kurz)/)
  })
  it('Rotation: ENCRYPTION_KEY_PREVIOUS entschluesselt Altdaten', () => {
    const old = encrypt('alt')
    process.env.ENCRYPTION_KEY = K2
    process.env.ENCRYPTION_KEY_PREVIOUS = K1
    expect(decrypt(old)).toBe('alt')
  })
  it('Maskierung', () => {
    expect(maskSecret('sk-abcdefgh1234')).toBe('****1234')
    expect(maskSecret('short')).toBe('****')
    expect(maskSecret('')).toBe('')
  })
})

describe('secret store', () => {
  it('speichert verschluesselt, nie Klartext in der DB', async () => {
    const repo = memRepo()
    const s = createSecretStore(repo)
    await s.set('heygen.apiKey', 'plain-secret-1234')
    expect(repo.g.get('heygen.apiKey')).not.toContain('plain-secret')
    expect(await s.get('heygen.apiKey')).toBe('plain-secret-1234')
  })
  it('Projekt-Override vor globalem Standard, Fallback auf global', async () => {
    const s = createSecretStore(memRepo())
    await s.set('deepseek.apiKey', 'global-key-0000')
    await s.set('deepseek.apiKey', 'proj-key-1111', { projectId: 'p1' })
    expect(await s.get('deepseek.apiKey', { projectId: 'p1' })).toBe('proj-key-1111')
    expect(await s.get('deepseek.apiKey', { projectId: 'p2' })).toBe('global-key-0000')
    expect(await s.get('deepseek.apiKey')).toBe('global-key-0000')
    await s.delete('deepseek.apiKey', { projectId: 'p1' })
    expect(await s.get('deepseek.apiKey', { projectId: 'p1' })).toBe('global-key-0000')
    await s.delete('deepseek.apiKey')
    expect(await s.get('deepseek.apiKey')).toBeUndefined()
  })
  it('maskierte Ausgabe enthaelt keinen Klartext', async () => {
    const s = createSecretStore(memRepo())
    await s.set('a.key', 'supersecretvalue9876')
    await s.set('a.key', 'projsecretvalue5555', { projectId: 'p1' })
    const list = await s.listMasked({ projectId: 'p1' })
    expect(list).toEqual([{ key: 'a.key', masked: '****5555', source: 'project' }])
    expect(JSON.stringify(list)).not.toContain('secretvalue')
    expect((await s.getMasked('a.key'))?.masked).toBe('****9876')
  })
  it('Key-Rotation re-verschluesselt', async () => {
    const s = createSecretStore(memRepo())
    await s.set('k', 'value-abcd')
    process.env.ENCRYPTION_KEY = K2
    process.env.ENCRYPTION_KEY_PREVIOUS = K1
    expect(await s.rotateGlobal()).toBe(1)
    delete process.env.ENCRYPTION_KEY_PREVIOUS
    expect(await s.get('k')).toBe('value-abcd')
  })
  it('leerer Wert abgelehnt', async () => {
    await expect(createSecretStore(memRepo()).set('k', '')).rejects.toThrow()
  })
})
