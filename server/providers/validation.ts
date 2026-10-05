/** Minimale Validierung ohne zod (nicht installiert). */
import { PermanentError, RetryableError } from './errors'

export type Check<T> = (v: unknown, path: string) => T

function fail(provider: string, path: string, expected: string): never {
  throw new PermanentError(`Ungültige Antwort: ${path} erwartet ${expected}`, provider, 'invalid_shape')
}

export function str(provider: string): Check<string> {
  return (v, p) => typeof v === 'string' && v.length > 0 ? v : fail(provider, p, 'string')
}
export function num(provider: string): Check<number> {
  return (v, p) => typeof v === 'number' && Number.isFinite(v) ? v : fail(provider, p, 'number')
}
export function arrayOf<T>(provider: string, item: Check<T>): Check<T[]> {
  return (v, p) => Array.isArray(v) ? v.map((x, i) => item(x, `${p}[${i}]`)) : fail(provider, p, 'array')
}
export function obj<T>(provider: string, shape: { [K in keyof T]: Check<T[K]> }): Check<T> {
  return (v, p) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(provider, p, 'object')
    const out = {} as T
    for (const k of Object.keys(shape) as (keyof T)[]) {
      out[k] = shape[k]((v as Record<string, unknown>)[k as string], `${p}.${String(k)}`)
    }
    return out
  }
}

/** Parst LLM-JSON (z. B. Deepseek) und validiert; ungültig -> RetryableError (neuer Versuch). */
export function parseJson<T>(provider: string, raw: string, check: Check<T>): T {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    throw new RetryableError('Ungültiges JSON', provider, 'invalid_json', e)
  }
  try {
    return check(data, '$')
  } catch (e) {
    throw new RetryableError(e instanceof Error ? e.message : 'Ungültige Form', provider, 'invalid_shape', e)
  }
}
