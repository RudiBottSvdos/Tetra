import { vi } from 'vitest'

export interface FakeClock {
  now(): Date
  set(d: Date | string | number): void
  advance(ms: number): void
  restore(): void
}

/** Fake-Clock auf Basis von vi.useFakeTimers; steuert Date.now() und Timer. */
export function useFakeClock(start: Date | string | number = '2026-01-01T00:00:00Z'): FakeClock {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(start))
  return {
    now: () => new Date(Date.now()),
    set: (d) => { vi.setSystemTime(new Date(d)) },
    advance: (ms) => { vi.advanceTimersByTime(ms) },
    restore: () => { vi.useRealTimers() }
  }
}

/** Injizierbare Uhr ohne globale Timer (fuer Code mit `now: () => Date`). */
export function createManualClock(start: Date | string | number = '2026-01-01T00:00:00Z') {
  let t = new Date(start).getTime()
  return {
    now: () => new Date(t),
    set: (d: Date | string | number) => { t = new Date(d).getTime() },
    advance: (ms: number) => { t += ms }
  }
}
