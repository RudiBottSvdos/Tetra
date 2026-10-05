// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { ConcurrentTransitionError, VideoNotFoundError, transitionVideo, type TransitionDb } from '../server/domain/video-transitions'
import { InvalidTransitionError, type VideoStatus } from '../server/domain/video-state'

interface Row { status: string, resumeStatus: string | null, scriptApprovalRequired: boolean }

/** Minimaler Fake-Client: simuliert select/update/insert-Ketten; `race` laesst das bedingte Update 0 Zeilen treffen. */
function fakeDb(row: Row | undefined, opts: { race?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = []
  const events: Array<Record<string, unknown>> = []
  const tx = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (opts.race) return []
            updates.push(patch)
            return [{ id: 'v1' }]
          }
        })
      })
    }),
    insert: () => ({ values: async (v: Record<string, unknown>) => { events.push(v) } })
  }
  const db: TransitionDb = { transaction: vi.fn(async fn => fn(tx)) }
  return { db, updates, events }
}

const base = (status: VideoStatus, over: Partial<Row> = {}): Row => ({ status, resumeStatus: null, scriptApprovalRequired: true, ...over })

describe('transitionVideo (gemockte DB)', () => {
  it('schreibt Update und video_event', async () => {
    const f = fakeDb(base('idea'))
    const r = await transitionVideo(f.db, { videoId: 'v1', expectedFrom: 'idea', to: 'scripting', message: 'start' })
    expect(r.to).toBe('scripting')
    expect(f.updates[0]).toMatchObject({ status: 'scripting', resumeStatus: null })
    expect(f.events[0]).toMatchObject({ videoId: 'v1', fromStatus: 'idea', toStatus: 'scripting', message: 'start' })
  })

  it('Gate-Verhalten kommt aus dem Projekt', async () => {
    const on = fakeDb(base('script_ready', { scriptApprovalRequired: true }))
    await expect(transitionVideo(on.db, { videoId: 'v1', expectedFrom: 'script_ready', to: 'rendering' })).rejects.toBeInstanceOf(InvalidTransitionError)
    expect(on.updates).toHaveLength(0)
    expect(on.events).toHaveLength(0)
    const off = fakeDb(base('script_ready', { scriptApprovalRequired: false }))
    await transitionVideo(off.db, { videoId: 'v1', expectedFrom: 'script_ready', to: 'rendering' })
    expect(off.updates[0]).toMatchObject({ status: 'rendering' })
  })

  it('Skriptfreigabe setzt script_approved_at', async () => {
    const f = fakeDb(base('awaiting_script_approval'))
    const now = new Date('2026-10-05T10:00:00Z')
    await transitionVideo(f.db, { videoId: 'v1', expectedFrom: 'awaiting_script_approval', to: 'rendering', now })
    expect(f.updates[0]).toMatchObject({ scriptApprovedAt: now })
  })

  it('failed merkt resume_status und last_error; Retry leert beides und resetet attempts', async () => {
    const down = fakeDb(base('rendering'))
    await transitionVideo(down.db, { videoId: 'v1', expectedFrom: 'rendering', to: 'failed', error: 'HeyGen 500' })
    expect(down.updates[0]).toMatchObject({ status: 'failed', resumeStatus: 'rendering', lastError: 'HeyGen 500' })
    expect(down.events[0]).toMatchObject({ message: 'HeyGen 500' })

    const up = fakeDb(base('failed', { resumeStatus: 'rendering' }))
    await transitionVideo(up.db, { videoId: 'v1', expectedFrom: 'failed', to: 'rendering', confirmedCost: true })
    expect(up.updates[0]).toMatchObject({ status: 'rendering', resumeStatus: null, attempts: 0, lastError: null })
  })

  it('paused_budget -> resume_status', async () => {
    const f = fakeDb(base('paused_budget', { resumeStatus: 'scripting' }))
    await transitionVideo(f.db, { videoId: 'v1', expectedFrom: 'paused_budget', to: 'scripting' })
    expect(f.updates[0]).toMatchObject({ status: 'scripting', resumeStatus: null })
  })

  it('lehnt ab, wenn der erwartete Von-Status nicht passt', async () => {
    const f = fakeDb(base('scripting'))
    await expect(transitionVideo(f.db, { videoId: 'v1', expectedFrom: 'idea', to: 'scripting' })).rejects.toBeInstanceOf(ConcurrentTransitionError)
    expect(f.events).toHaveLength(0)
  })

  it('erkennt Race zwischen Lesen und Update (0 Zeilen), kein Event', async () => {
    const f = fakeDb(base('idea'), { race: true })
    await expect(transitionVideo(f.db, { videoId: 'v1', expectedFrom: 'idea', to: 'scripting' })).rejects.toBeInstanceOf(ConcurrentTransitionError)
    expect(f.events).toHaveLength(0)
  })

  it('unbekanntes Video', async () => {
    const f = fakeDb(undefined)
    await expect(transitionVideo(f.db, { videoId: 'x', expectedFrom: 'idea', to: 'scripting' })).rejects.toBeInstanceOf(VideoNotFoundError)
  })
})
