import { vi, type Mock } from 'vitest'

export type Mocked<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? Mock<(...a: A) => R> : T[K] }

/**
 * Baut einen Mock fuer ein Provider-Interface (LLM, Video, Publisher, Metrics, Storage).
 * `impl` liefert Standardverhalten; nicht angegebene Methoden werfen beim Aufruf.
 * Alle Methoden sind vi.fn und damit pruefbar (toHaveBeenCalledWith etc.).
 */
export function createProviderMock<T extends object>(methods: readonly (keyof T & string)[], impl: Partial<T> = {}): Mocked<T> {
  const out: Record<string, unknown> = {}
  for (const m of methods) {
    const fn = (impl as Record<string, unknown>)[m]
    out[m] = typeof fn === 'function'
      ? vi.fn(fn as (...a: unknown[]) => unknown)
      : vi.fn(() => { throw new Error(`Mock-Methode ${m} nicht konfiguriert`) })
  }
  return out as Mocked<T>
}

/** Mock fuer fetch: Antworten in Reihenfolge (Erfolg, 4xx, 429, 5xx, kaputtes JSON, Timeout als Error). */
export function mockFetchSequence(responses: Array<Response | Error | (() => Response | Promise<Response>)>) {
  const queue = [...responses]
  const fn = vi.fn(async (..._args: unknown[]) => {
    const next = queue.shift()
    if (!next) throw new Error('mockFetchSequence: keine Antwort mehr')
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

export const brokenJsonResponse = (status = 200) =>
  new Response('{not json', { status, headers: { 'content-type': 'application/json' } })

export const timeoutError = () => Object.assign(new Error('timeout'), { name: 'TimeoutError' })
