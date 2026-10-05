// @vitest-environment node
import { afterAll, beforeAll, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { describeDb, setupTestDb, createProject, createVideo, type TestDb } from './helpers'
import * as s from '../server/db/schema'
import { transitionVideo, ConcurrentTransitionError } from '../server/domain/video-transitions'

describeDb('transitionVideo (Postgres)', () => {
  let t: TestDb
  beforeAll(async () => { t = await setupTestDb() })
  afterAll(async () => { await t?.teardown() })

  it('Update + Event atomar, Resume-Zyklus', async () => {
    const p = await createProject(t.db, { scriptApprovalRequired: false })
    const v = await createVideo(t.db, p.id, { status: 'script_ready' })
    await transitionVideo(t.db, { videoId: v.id, expectedFrom: 'script_ready', to: 'rendering' })
    await transitionVideo(t.db, { videoId: v.id, expectedFrom: 'rendering', to: 'paused_budget' })
    const [paused] = await t.db.select().from(s.video).where(eq(s.video.id, v.id))
    expect(paused).toMatchObject({ status: 'paused_budget', resumeStatus: 'rendering' })
    await transitionVideo(t.db, { videoId: v.id, expectedFrom: 'paused_budget', to: 'rendering' })
    const [resumed] = await t.db.select().from(s.video).where(eq(s.video.id, v.id))
    expect(resumed).toMatchObject({ status: 'rendering', resumeStatus: null })
    const events = await t.db.select().from(s.videoEvent).where(eq(s.videoEvent.videoId, v.id))
    expect(events).toHaveLength(3)
  })

  it('zweiter paralleler Uebergang scheitert', async () => {
    const p = await createProject(t.db)
    const v = await createVideo(t.db, p.id)
    const results = await Promise.allSettled([
      transitionVideo(t.db, { videoId: v.id, expectedFrom: 'idea', to: 'scripting' }),
      transitionVideo(t.db, { videoId: v.id, expectedFrom: 'idea', to: 'scripting' })
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(ConcurrentTransitionError)
  })
})
