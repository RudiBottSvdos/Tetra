/** Storage-Interface (WP1.9). Keine Framework-/Netzwerk-Abhaengigkeit. */
import type { Readable } from 'node:stream'

export interface StorageStat { size: number, modifiedAt: Date }
export interface ByteRange { start: number, end: number }

export interface PutOptions { contentType?: string }
export interface PutResult {
  /** Backend-spezifische Referenz (lokal: relativer Schluessel), wird in video.storage_ref gespeichert. */
  ref: string
  size: number
  /** SHA-256 (hex) der gespeicherten Bytes, fuer Verifikation. */
  sha256: string
}

export type StorageAccess =
  | { kind: 'local-file', path: string }
  | { kind: 'url', url: string, expiresAt: Date }

export interface StorageProvider {
  readonly name: string
  /** Schreibt per Stream (atomar: Teilschreibungen werden nie sichtbar). */
  put(key: string, data: Readable | AsyncIterable<Uint8Array>, opts?: PutOptions): Promise<PutResult>
  /** Liest Bytes als Stream, optional Range (inklusive Grenzen). */
  get(key: string, range?: ByteRange): Promise<Readable>
  stat(key: string): Promise<StorageStat | null>
  exists(key: string): Promise<boolean>
  /** Idempotent: nicht vorhandene Datei ist kein Fehler. Liefert true, wenn etwas geloescht wurde. */
  delete(key: string): Promise<boolean>
  /**
   * Zugriff fuer Vorschau/Download: lokal ein Dateipfad (Proxy per Stream),
   * remote z. B. eine kurzlebige URL. Nie dauerhaft speichern.
   */
  getAccess(key: string, opts?: { expiresInS?: number }): Promise<StorageAccess>
}

export class StorageError extends Error {
  constructor(message: string, readonly code: 'INVALID_KEY' | 'NOT_FOUND' | 'IO' | 'VERIFY_FAILED') {
    super(message)
    this.name = 'StorageError'
  }
}
