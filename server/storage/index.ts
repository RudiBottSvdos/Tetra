import { LocalStorage } from './local'
import type { StorageProvider } from './types'

export * from './types'
export { LocalStorage, resolveBufferDir, assertSafeKey } from './local'
export { parseRange } from './range'
export { archiveVideo } from './archive'
export { cleanupBuffer } from './cleanup'

const remotes = new Map<string, StorageProvider>()
let _local: LocalStorage | undefined

export function useLocalStorage(): LocalStorage {
  return (_local ??= new LocalStorage())
}

/** Registry: OneDrive (WP3.5) registriert sich hier. */
export function registerStorage(p: StorageProvider): void { remotes.set(p.name, p) }
export function getStorage(name: string): StorageProvider | undefined {
  return name === 'local' ? useLocalStorage() : remotes.get(name)
}
