import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM. Format: "v1:" + base64(iv(12) | authTag(16) | ciphertext).
// Key-Validierung ist LAZY: Import/Build/Tests ohne Key brechen nicht, erst Nutzung wirft.

const VERSION = 'v1'
const IV_LEN = 12
const TAG_LEN = 16

/** Parst einen 32-Byte-Schluessel (64 Hex-Zeichen oder Base64). Fehlertexte enthalten nie den Schluesselwert. */
export function parseKey(raw: string | undefined, name = 'ENCRYPTION_KEY'): Buffer {
  const v = raw?.trim()
  if (!v) throw new Error(`${name} is not set`)
  let key: Buffer | undefined
  if (/^[0-9a-fA-F]{64}$/.test(v)) key = Buffer.from(v, 'hex')
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) key = Buffer.from(v, 'base64')
  if (!key || key.length !== 32) throw new Error(`${name} must be 32 bytes (64 hex chars or base64)`)
  return key
}

function currentKey(): Buffer {
  return parseKey(process.env.ENCRYPTION_KEY)
}

/** Optionaler alter Schluessel fuer Key-Rotation (nur Entschluesselung). */
function previousKey(): Buffer | undefined {
  const raw = process.env.ENCRYPTION_KEY_PREVIOUS
  return raw?.trim() ? parseKey(raw, 'ENCRYPTION_KEY_PREVIOUS') : undefined
}

export function encrypt(plaintext: string, key: Buffer = currentKey()): string {
  const iv = randomBytes(IV_LEN) // frische zufaellige IV je Aufruf
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN })
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`
}

function decryptWith(payload: string, key: Buffer): string {
  const [ver, b64] = payload.split(':')
  if (ver !== VERSION || !b64) throw new Error('Invalid ciphertext format')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Invalid ciphertext format')
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, IV_LEN), { authTagLength: TAG_LEN })
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN))
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8')
}

/** Entschluesselt; wirft bei Manipulation oder falschem Schluessel. Probiert ggf. ENCRYPTION_KEY_PREVIOUS. */
export function decrypt(payload: string, key?: Buffer): string {
  if (key) return decryptWith(payload, key)
  const cur = currentKey()
  try {
    return decryptWith(payload, cur)
  } catch (err) {
    const prev = previousKey()
    if (!prev) throw new Error('Decryption failed (tampered data or wrong key)', { cause: err })
    try {
      return decryptWith(payload, prev)
    } catch (err2) {
      throw new Error('Decryption failed (tampered data or wrong key)', { cause: err2 })
    }
  }
}

/** Startup-Check (nur vom Plugin bei gesetzter DATABASE_URL aufzurufen). */
export function assertEncryptionKey(): void {
  currentKey()
}

/** Maskiert ein Secret fuer Anzeige/Logs: nur die letzten 4 Zeichen (bei kurzen Werten gar keine). */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return ''
  return value.length <= 8 ? '****' : `****${value.slice(-4)}`
}
