// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AuthExpiredError, FakeIdeaProvider, FakePlatformPublisher, FakeScriptProvider, FakeVideoProvider,
  PermanentError, RateLimitError, RetryableError, createFakeRegistry, createProviderRegistry, isRetryable, validation
} from '../server/providers'

const up = { video: new Uint8Array([1]), title: 'T', description: 'D', hashtags: [], visibility: 'private' as const, aiGenerated: true as const }

describe('Fehlerklassen', () => {
  it('retryable vs permanent', () => {
    expect(isRetryable(new RetryableError('x', 'p'))).toBe(true)
    expect(isRetryable(new RateLimitError('p', 12))).toBe(true)
    expect(new RateLimitError('p', 12).retryAfter).toBe(12)
    expect(isRetryable(new PermanentError('x', 'p'))).toBe(false)
    expect(isRetryable(new AuthExpiredError('p'))).toBe(false)
    expect(isRetryable(new Error('x'))).toBe(false)
  })
})

describe('Fakes', () => {
  it('Ideen/Skripte deterministisch, Ausschlussliste', async () => {
    const idea = new FakeIdeaProvider()
    const a = await idea.generateTopics({ niche: 'Space', count: 2, exclude: ['Space Thema 1'] })
    expect(a.topics.map(t => t.title)).toEqual(['Space Thema 2', 'Space Thema 3'])
    const s = new FakeScriptProvider()
    expect(await s.generateScript({ topic: 'A', targetSeconds: 40 })).toEqual(await s.generateScript({ topic: 'A', targetSeconds: 40 }))
  })

  it('konfigurierbare Fehler', async () => {
    const s = new FakeScriptProvider({ failures: ['rate_limit', 'auth_expired', null], retryAfter: 7 })
    await expect(s.generateScript({ topic: 'A', targetSeconds: 10 })).rejects.toMatchObject({ retryAfter: 7 })
    await expect(s.generateScript({ topic: 'A', targetSeconds: 10 })).rejects.toBeInstanceOf(AuthExpiredError)
    await expect(s.generateScript({ topic: 'A', targetSeconds: 10 })).resolves.toBeDefined()
  })

  it('Verzögerung', async () => {
    const t = Date.now()
    await new FakeIdeaProvider({ delayMs: 30 }).testConnection()
    expect(Date.now() - t).toBeGreaterThanOrEqual(25)
  })

  it('Video: Render-Lebenszyklus, Idempotenz, Kosten', async () => {
    const v = new FakeVideoProvider({ pollsUntilDone: 2 })
    const req = { script: 's', visualMode: 'faceless' as const, targetSeconds: 40, idempotencyKey: 'k' }
    const h1 = await v.startRender(req)
    const h2 = await v.startRender(req)
    expect(h2.sessionId).toBe(h1.sessionId)
    expect((await v.pollRender(h1.sessionId)).status).toBe('processing')
    expect((await v.pollRender(h1.sessionId)).status).toBe('processing')
    const done = await v.pollRender(h1.sessionId)
    expect(done.status).toBe('completed')
    expect(done.durationSeconds).toBe(40)
    expect(v.estimateCost({ targetSeconds: 40 }).costUsd).toBeCloseTo(1.332, 3)
    expect(v.estimateCost({ targetSeconds: 40 }).reserveUsd).toBeGreaterThan(1.332)
    expect((await v.download(done.videoUrl!)).byteLength).toBeGreaterThan(0)
  })

  it('Video: failed und Webhook-Signatur', async () => {
    const v = new FakeVideoProvider({ pollsUntilDone: 0, renderFails: true })
    const h = await v.startRender({ script: 's', visualMode: 'avatar', targetSeconds: 30 })
    expect((await v.pollRender(h.sessionId)).status).toBe('failed')
    const body = JSON.stringify({ event: 'video_agent.success', session_id: 'x' })
    expect(v.handleWebhook({ rawBody: body, headers: { 'x-signature': 'fake-secret' } })).toEqual({ sessionId: 'x', status: 'completed', error: undefined })
    expect(() => v.handleWebhook({ rawBody: body, headers: { 'x-signature': 'bad' } })).toThrow(PermanentError)
    await expect(v.pollRender('nope')).rejects.toBeInstanceOf(PermanentError)
  })

  it('Publisher: Upload, Status, Metriken, TikTok-Entwurf', async () => {
    const yt = new FakePlatformPublisher('youtube')
    const { externalId } = await yt.upload(up)
    expect((await yt.getStatus(externalId)).status).toBe('processing')
    expect((await yt.getStatus(externalId)).status).toBe('published')
    expect(await yt.fetchMetrics(externalId)).toEqual(await yt.fetchMetrics(externalId))
    const tt = new FakePlatformPublisher('tiktok', { checksUntilPublished: 0 })
    const t = await tt.upload({ ...up, visibility: 'draft' })
    expect((await tt.getStatus(t.externalId)).status).toBe('draft')
  })
})

describe('Validierung', () => {
  const check = validation.obj('deepseek', { topics: validation.arrayOf('deepseek', validation.str('deepseek')) })
  it('akzeptiert gültiges JSON', () => {
    expect(validation.parseJson('deepseek', '{"topics":["a"]}', check)).toEqual({ topics: ['a'] })
  })
  it('ungültiges JSON/Form -> retryable', () => {
    expect(() => validation.parseJson('deepseek', '{oops', check)).toThrow(RetryableError)
    expect(() => validation.parseJson('deepseek', '{"topics":[1]}', check)).toThrow(RetryableError)
  })
})

describe('Registry', () => {
  const builders = { video: () => new FakeVideoProvider(), publisher: { youtube: () => new FakePlatformPublisher('youtube') } }

  it('löst mit Credential auf und reicht Scope durch', async () => {
    const seen: unknown[] = []
    const reg = createProviderRegistry(async (k, s) => {
      seen.push([k, s.projectId])
      return 'key'
    }, builders)
    expect((await reg.video({ projectId: 'p1' })).name).toBe('fake-video')
    expect(seen).toEqual([['heygen.apiKey', 'p1']])
  })

  it('Fallback Projekt -> global im Resolver, fehlender Key ist permanent', async () => {
    const store: Record<string, string> = { 'global:heygen.apiKey': 'g' }
    const resolve = async (k: string, s: { projectId?: string }) => (s.projectId && store[`${s.projectId}:${k}`]) || store[`global:${k}`] || null
    const reg = createProviderRegistry(resolve, builders)
    await expect(reg.video({ projectId: 'p1' })).resolves.toBeDefined()
    await expect(reg.publisher('youtube')).rejects.toMatchObject({ code: 'missing_credential', kind: 'permanent' })
  })

  it('nicht registrierter Provider', async () => {
    const reg = createProviderRegistry(async () => 'k', {})
    await expect(reg.publisher('tiktok')).rejects.toMatchObject({ code: 'not_registered' })
    await expect(reg.idea()).rejects.toBeInstanceOf(PermanentError)
  })

  it('Fake-Registry', async () => {
    const reg = createFakeRegistry()
    expect((await reg.publisher('tiktok')).platform).toBe('tiktok')
    expect((await (await reg.idea()).testConnection()).ok).toBe(true)
  })
})
