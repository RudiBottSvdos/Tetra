import { describe, it, expect, vi } from 'vitest'
import { checkHealth } from '../server/utils/health'
import { decideApiAccess } from '../server/utils/access'

describe('Health-Endpoint', () => {
  it('ist oeffentlich erreichbar (ohne Session)', () => {
    expect(decideApiAccess('/api/health', false)).toBe('allow')
  })

  it('Liveness ruft die DB nicht auf', async () => {
    const pingDb = vi.fn()
    const r = await checkHealth({ deep: false, pingDb })
    expect(r).toEqual({ statusCode: 200, body: { status: 'ok' } })
    expect(pingDb).not.toHaveBeenCalled()
  })

  it('deep: DB erreichbar -> 200', async () => {
    const r = await checkHealth({ deep: true, pingDb: async () => 1 })
    expect(r).toEqual({ statusCode: 200, body: { status: 'ok', db: 'up' } })
  })

  it('deep: DB-Fehler -> 503 ohne Fehlerdetails', async () => {
    const r = await checkHealth({ deep: true, pingDb: async () => { throw new Error('password authentication failed for postgres://u:secret@host') } })
    expect(r.statusCode).toBe(503)
    expect(r.body).toEqual({ status: 'degraded', db: 'down' })
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('deep: haengende DB -> 503 per Timeout', async () => {
    vi.useFakeTimers()
    const p = checkHealth({ deep: true, pingDb: () => new Promise(() => {}) })
    await vi.advanceTimersByTimeAsync(3100)
    expect((await p).statusCode).toBe(503)
    vi.useRealTimers()
  })
})
