import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createDeepseekProvider, type FetchLike } from '../server/providers/deepseek'
import { AuthExpiredError, PermanentError, RateLimitError, RetryableError } from '../server/providers/errors'
import { createCredentialResolver, createRuntimeRegistry, CREDENTIAL_KEYS } from '../server/providers/credentials'
import { createSecretStore, type SecretRepo } from '../server/utils/secrets'
import { SECRET_KEYS } from '../shared/panel-constants'

const completion = (content: unknown, usage = { prompt_tokens: 1000, completion_tokens: 2000 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage }), { status: 200 })

function setup(...responses: (Response | Error)[]) {
  const queue = [...responses]
  const fn = vi.fn(async (_url: string, _init: unknown) => {
    const n = queue.shift()
    if (!n) throw new Error('keine Antwort')
    if (n instanceof Error) throw n
    return n
  })
  const p = createDeepseekProvider({ apiKey: 'sk-test', baseUrl: 'https://llm.example/', model: 'm-1', fetch: fn as unknown as FetchLike })
  return { p, fn }
}
const body = (fn: ReturnType<typeof setup>['fn'], i = 0) => JSON.parse((fn.mock.calls[i]![1] as { body: string }).body)
const promptOf = (b: { messages: { content: string }[] }) => b.messages.map(m => m.content).join(' ')

describe('DeepseekProvider', () => {
  it('Themen: JSON-Modus, Base-URL/Modell konfigurierbar, Dedup-Hinweis, Kosten aus usage', async () => {
    const { p, fn } = setup(completion({ topics: [{ title: ' A ', angle: 'x' }, { title: 'B' }] }))
    const r = await p.generateTopics({ niche: 'Katzen', count: 20, language: 'de', style: 'witzig', exclude: ['Alt-Thema'] })
    expect(r.topics).toEqual([{ title: 'A', angle: 'x' }, { title: 'B', angle: '' }])
    expect(r.usage.inputTokens).toBe(1000)
    expect(r.usage.costUsd).toBeCloseTo((1000 * 0.3 + 2000 * 1.2) / 1e6)
    const [url, init] = fn.mock.calls[0]! as [string, { headers: Record<string, string> }]
    expect(url).toBe('https://llm.example/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')
    const b = body(fn)
    expect(b.model).toBe('m-1')
    expect(b.response_format).toEqual({ type: 'json_object' })
    const prompt = promptOf(b)
    expect(prompt).toContain('20')
    expect(prompt).toContain('Katzen')
    expect(prompt).toContain('witzig')
    expect(prompt).toContain('Alt-Thema')
    expect(prompt).toContain('Deutsch')
    expect(prompt.toLowerCase()).toContain('json')
  })

  it('Skript: Länge im Prompt, Schätzung aus Wortzahl', async () => {
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`).join(' ')
    const { p, fn } = setup(completion({ script: words }))
    const r = await p.generateScript({ topic: 'T', targetSeconds: 40, language: 'en' })
    expect(r.estimatedSeconds).toBe(40)
    const prompt = promptOf(body(fn))
    expect(prompt).toContain('40 Sekunden')
    expect(prompt).toContain('100 Wörter')
    expect(prompt).toContain('Englisch')
  })

  it('Plattform-Metadaten getrennt: YouTube mit Shorts + Limits, TikTok ohne', async () => {
    const raw = { title: 'T'.repeat(150), description: 'd', hashtags: ['#Fakten', 'fakten', 'wow!'] }
    const { p, fn } = setup(completion(raw), completion(raw))
    const yt = await p.generatePlatformMeta({ topic: 't', script: 's', platform: 'youtube' })
    const tt = await p.generatePlatformMeta({ topic: 't', script: 's', platform: 'tiktok' })
    expect(yt.meta.title.length).toBeLessThanOrEqual(100)
    expect(yt.meta.hashtags).toEqual(['Fakten', 'wow', 'Shorts'])
    expect(tt.meta.title.length).toBeLessThanOrEqual(90)
    expect(tt.meta.hashtags).toEqual(['Fakten', 'wow'])
    expect(body(fn, 0).messages[0].content).toContain('YouTube')
    expect(body(fn, 1).messages[0].content).toContain('TikTok')
  })

  it.each([
    ['leere Antwort', () => completion('  ')],
    ['kein choices', () => new Response('{}', { status: 200 })],
    ['ungültiges JSON', () => completion('{nope')],
    ['falsche Form', () => completion({ topics: 'x' })],
    ['keine Themen', () => completion({ topics: [] })],
    ['5xx', () => new Response('x', { status: 503 })]
  ])('%s -> RetryableError', async (_n, mk) => {
    const { p } = setup(mk())
    await expect(p.generateTopics({ niche: 'n', count: 1 })).rejects.toBeInstanceOf(RetryableError)
  })

  it('Netzwerkfehler -> RetryableError', async () => {
    const { p } = setup(new Error('ECONNRESET'))
    await expect(p.generateTopics({ niche: 'n', count: 1 })).rejects.toBeInstanceOf(RetryableError)
  })

  it('429 -> RateLimitError, 401 -> AuthExpired, 402/400 permanent', async () => {
    const { p } = setup(
      new Response('', { status: 429, headers: { 'retry-after': '12' } }),
      new Response('', { status: 401 }),
      new Response('', { status: 402 }),
      new Response('', { status: 400 })
    )
    const req = { niche: 'n', count: 1 }
    await expect(p.generateTopics(req)).rejects.toBeInstanceOf(RateLimitError)
    await expect(p.generateTopics(req)).rejects.toBeInstanceOf(AuthExpiredError)
    await expect(p.generateTopics(req)).rejects.toMatchObject({ code: 'insufficient_balance' })
    await expect(p.generateTopics(req)).rejects.toBeInstanceOf(PermanentError)
  })

  it('429 liefert retryAfter aus dem Header', async () => {
    const { p } = setup(new Response('', { status: 429, headers: { 'retry-after': '12' } }))
    await expect(p.generateTopics({ niche: 'n', count: 1 })).rejects.toMatchObject({ retryAfter: 12 })
  })

  it('testConnection: ok und Fehler ohne Secret', async () => {
    const { p } = setup(completion({ ok: true }), new Response('', { status: 401 }))
    expect((await p.testConnection()).ok).toBe(true)
    const bad = await p.testConnection()
    expect(bad.ok).toBe(false)
    expect(JSON.stringify(bad)).not.toContain('sk-test')
  })
})

describe('CredentialResolver / Registry', () => {
  function memRepo(): SecretRepo {
    const g = new Map<string, string>()
    const p = new Map<string, string>()
    return {
      getGlobal: async k => g.get(k),
      setGlobal: async (k, v) => { g.set(k, v) },
      deleteGlobal: async (k) => { g.delete(k) },
      listGlobal: async () => [...g].map(([key, valueEnc]) => ({ key, valueEnc })),
      getProject: async (id, k) => p.get(`${id}:${k}`),
      setProject: async (id, k, v) => { p.set(`${id}:${k}`, v) },
      deleteProject: async (id, k) => { p.delete(`${id}:${k}`) },
      listProject: async () => []
    }
  }

  it('Registry-Schlüssel decken sich mit SECRET_KEYS', () => {
    const keys = SECRET_KEYS.map(k => k.key)
    expect(keys).toContain(CREDENTIAL_KEYS.idea)
    expect(keys).toContain(CREDENTIAL_KEYS.script)
    expect(keys).toContain(CREDENTIAL_KEYS.video)
  })

  it('Projekt-Override vor global, sonst global, sonst null; Registry liefert Deepseek', async () => {
    const saved = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex')
    try {
      const store = createSecretStore(memRepo())
      await store.set('deepseek.apiKey', 'global-key')
      await store.set('deepseek.apiKey', 'proj-key', { projectId: 'p1' })
      const resolve = createCredentialResolver(store)
      expect(await resolve('deepseek.apiKey', { projectId: 'p1' })).toBe('proj-key')
      expect(await resolve('deepseek.apiKey', { projectId: 'p2' })).toBe('global-key')
      expect(await resolve('deepseek.apiKey', {})).toBe('global-key')
      expect(await resolve('heygen.apiKey', {})).toBeNull()
      const reg = createRuntimeRegistry(resolve, { DEEPSEEK_MODEL: 'x' })
      expect((await reg.idea({ projectId: 'p1' })).name).toBe('deepseek')
      expect((await reg.script()).name).toBe('deepseek')
      await expect(reg.video()).rejects.toMatchObject({ code: 'not_registered' })
    } finally {
      if (saved === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = saved
    }
  })
})
