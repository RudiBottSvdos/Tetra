// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const instances: any[] = []
  class FakeBoss {
    opts: unknown
    handlers: Record<string, any> = {}
    createQueue = vi.fn(async () => {})
    schedule = vi.fn(async () => {})
    work = vi.fn(async (name: string, _o: unknown, h: any) => { this.handlers[name] = h; return 'w' })
    send = vi.fn(async () => 'job-1')
    sendAfter = vi.fn(async () => 'job-2')
    start = vi.fn(async () => this)
    stop = vi.fn(async () => {})
    on = vi.fn()
    constructor(opts: unknown) { this.opts = opts; instances.push(this) }
  }
  return { instances, FakeBoss }
})
vi.mock('pg-boss', () => ({ PgBoss: mock.FakeBoss }))

const serverDir = join(__dirname, '..', 'server')

describe('queue config', () => {
  it('uses the dedicated pgboss schema, not public', async () => {
    const { bossOptions } = await import('../server/queue/boss')
    const { PGBOSS_SCHEMA } = await import('../server/queue/names')
    expect(PGBOSS_SCHEMA).toBe('pgboss')
    expect(bossOptions('postgres://x')).toMatchObject({ schema: 'pgboss', connectionString: 'postgres://x' })
    expect(readFileSync(join(__dirname, '..', 'drizzle.config.ts'), 'utf8')).toContain("schemaFilter: ['public']")
  })

  it('gives every queue retry, backoff and dead-letter defaults', async () => {
    const { ALL_QUEUES, queueConfig, DEAD_LETTER_QUEUE, QUEUES } = await import('../server/queue/names')
    for (const q of ALL_QUEUES) {
      const c = queueConfig(q)
      expect(c.deadLetter).toBe(DEAD_LETTER_QUEUE)
      expect(typeof c.retryLimit).toBe('number')
      expect(c.expireInSeconds).toBeGreaterThan(0)
    }
    expect(queueConfig(QUEUES.topicsGenerate)).toMatchObject({ retryLimit: 3, retryBackoff: true })
    expect(queueConfig(QUEUES.schedulerTick).retryLimit).toBe(0)
    expect(new Set(ALL_QUEUES).size).toBe(ALL_QUEUES.length)
  })

  it('registers cron schedules only for existing queues with unique keys', async () => {
    const { CRON_SCHEDULES, ALL_QUEUES } = await import('../server/queue/names')
    expect(CRON_SCHEDULES.length).toBeGreaterThanOrEqual(3)
    expect(new Set(CRON_SCHEDULES.map(s => s.key)).size).toBe(CRON_SCHEDULES.length)
    for (const s of CRON_SCHEDULES) expect(ALL_QUEUES).toContain(s.queue)
  })
})

describe('plugin order', () => {
  it('loads 10-boss after 00-migrate and is guarded by DATABASE_URL + close hook', () => {
    const files = readdirSync(join(serverDir, 'plugins')).sort()
    expect(files.indexOf('00-migrate.ts')).toBeGreaterThanOrEqual(0)
    expect(files.indexOf('10-boss.ts')).toBeGreaterThan(files.indexOf('00-migrate.ts'))
    const src = readFileSync(join(serverDir, 'plugins', '10-boss.ts'), 'utf8')
    expect(src).toContain("hooks.hook('close'")
    expect(readFileSync(join(serverDir, 'queue', 'start.ts'), 'utf8')).toContain('DATABASE_URL')
  })
})

describe('boss lifecycle (mocked pg-boss)', () => {
  const saved = process.env.DATABASE_URL
  beforeEach(async () => {
    vi.resetModules()
    mock.instances.length = 0
    const { resetRegistry } = await import('../server/queue/registry')
    resetRegistry()
  })
  afterEach(async () => {
    const { stopBoss } = await import('../server/queue/boss')
    await stopBoss()
    if (saved === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = saved
  })

  it('does not start without DATABASE_URL and does not crash', async () => {
    delete process.env.DATABASE_URL
    const { startBossIfConfigured } = await import('../server/queue/start')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await startBossIfConfigured()).toBe(false)
    expect(mock.instances).toHaveLength(0)
    warn.mockRestore()
  })

  it('getBoss throws without DATABASE_URL and is retryable', async () => {
    delete process.env.DATABASE_URL
    const { getBoss } = await import('../server/queue/boss')
    await expect(getBoss()).rejects.toThrow(/DATABASE_URL/)
    process.env.DATABASE_URL = 'postgres://t:t@localhost/t'
    await expect(getBoss()).resolves.toBeDefined()
  })

  it('starts lazily once, creates queues (dead letter first), schedules cron, registers handlers', async () => {
    process.env.DATABASE_URL = 'postgres://t:t@localhost/t'
    const { getBoss } = await import('../server/queue/boss')
    const { registerAllHandlers } = await import('../server/queue/handlers')
    const { ALL_QUEUES, DEAD_LETTER_QUEUE, CRON_SCHEDULES } = await import('../server/queue/names')
    registerAllHandlers()
    const [a, b] = await Promise.all([getBoss(), getBoss()])
    expect(a).toBe(b)
    expect(mock.instances).toHaveLength(1)
    const boss = mock.instances[0]
    expect(boss.opts).toMatchObject({ schema: 'pgboss' })
    expect(boss.createQueue.mock.calls[0][0]).toBe(DEAD_LETTER_QUEUE)
    expect(boss.createQueue).toHaveBeenCalledTimes(ALL_QUEUES.length + 1)
    expect(boss.schedule).toHaveBeenCalledTimes(CRON_SCHEDULES.length)
    expect(Object.keys(boss.handlers).sort()).toEqual(CRON_SCHEDULES.map(s => s.queue).sort())
  })

  it('rejects duplicate handler registration; handler errors propagate (retry)', async () => {
    process.env.DATABASE_URL = 'postgres://t:t@localhost/t'
    const { registerHandler } = await import('../server/queue/registry')
    const { QUEUES } = await import('../server/queue/names')
    const { getBoss } = await import('../server/queue/boss')
    const fail = vi.fn(async () => { throw new Error('boom') })
    registerHandler(QUEUES.videoRender, fail)
    expect(() => registerHandler(QUEUES.videoRender, fail)).toThrow(/bereits/)
    await getBoss()
    const run = mock.instances[0].handlers[QUEUES.videoRender]
    await expect(run([{ id: '1', data: {} }])).rejects.toThrow('boom')
    expect(fail).toHaveBeenCalledTimes(1)
  })

  it('enqueue maps idempotencyKey to singletonKey; stopBoss shuts down gracefully', async () => {
    process.env.DATABASE_URL = 'postgres://t:t@localhost/t'
    const { enqueue, enqueueAt } = await import('../server/queue/enqueue')
    const { QUEUES } = await import('../server/queue/names')
    const { stopBoss, isBossRunning } = await import('../server/queue/boss')
    expect(await enqueue(QUEUES.videoUpload, { videoId: 'v1' }, { idempotencyKey: 'v1:upload', priority: 2 })).toBe('job-1')
    const boss = mock.instances[0]
    expect(boss.send).toHaveBeenCalledWith('video.upload', { videoId: 'v1' }, { priority: 2, singletonKey: 'v1:upload' })
    await enqueueAt(QUEUES.videoPoll, {}, 30)
    expect(boss.sendAfter).toHaveBeenCalledWith('video.poll', {}, {}, 30)
    expect(isBossRunning()).toBe(true)
    await stopBoss()
    expect(boss.stop).toHaveBeenCalledWith(expect.objectContaining({ graceful: true }))
    expect(isBossRunning()).toBe(false)
  })
})
