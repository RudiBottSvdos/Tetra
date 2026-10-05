// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManualClock, createProviderMock, jsonResponse, mockFetchSequence, useFakeClock } from './index'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('test helpers', () => {
  it('fake clock advances Date.now', () => {
    const c = useFakeClock('2026-01-01T00:00:00Z')
    c.advance(60_000)
    expect(c.now().toISOString()).toBe('2026-01-01T00:01:00.000Z')
    c.restore()
  })

  it('manual clock is injectable', () => {
    const c = createManualClock(0)
    c.advance(5)
    expect(c.now().getTime()).toBe(5)
  })

  it('provider mock records calls and throws when unconfigured', () => {
    const p = createProviderMock<{ a(): number, b(): number }>(['a', 'b'], { a: () => 1 })
    expect(p.a()).toBe(1)
    expect(p.a).toHaveBeenCalledTimes(1)
    expect(() => p.b()).toThrow(/nicht konfiguriert/)
  })

  it('fetch sequence replays responses in order', async () => {
    mockFetchSequence([jsonResponse({ ok: 1 }), jsonResponse({}, 429)])
    expect((await fetch('x')).status).toBe(200)
    expect((await fetch('x')).status).toBe(429)
  })
})
