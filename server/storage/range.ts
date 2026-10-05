import type { ByteRange } from './types'

export type RangeResult = { kind: 'none' } | { kind: 'ok', range: ByteRange } | { kind: 'unsatisfiable' }

/** Parst einen einzelnen "bytes=a-b"-Range-Header (Mehrfach-Ranges/ungueltig -> ganze Datei). */
export function parseRange(header: string | undefined | null, size: number): RangeResult {
  if (!header) return { kind: 'none' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'none' }
  const a = m[1] ?? ''
  const b = m[2] ?? ''
  if (a === '' && b === '') return { kind: 'none' }
  let start: number
  let end: number
  if (a === '') {
    const n = Number(b)
    if (n === 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (size === 0 || start >= size || end < start) return { kind: 'unsatisfiable' }
  return { kind: 'ok', range: { start, end } }
}
