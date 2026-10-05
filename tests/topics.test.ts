import { describe, expect, it } from 'vitest'
import { createTopicService, normalizeTopicTitle, topicFingerprint, type NewTopic, type TopicRepo, type TopicRow } from '../server/domain/topics'
import { guardedCall, usdToCents } from '../server/domain/guarded-call'
import { FakeIdeaProvider } from '../server/providers/fakes'
import { RetryableError } from '../server/providers/errors'
import { BudgetExceededError, type CostGuard } from '../server/domain/cost-guard'
import type { IdeaProvider } from '../server/providers/types'

const PID = '11111111-1111-4111-8111-111111111111'

function memRepo(seed: string[] = []): TopicRepo & { rows: TopicRow[] } {
  const rows: TopicRow[] = []
  let n = 0
  const mk = (i: NewTopic, batchId: string): TopicRow => ({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    projectId: PID,
    title: i.title,
    angle: i.angle,
    status: 'suggested',
    fingerprint: i.fingerprint,
    batchId,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  for (const t of seed) rows.push(mk({ title: t, angle: null, fingerprint: topicFingerprint(t) }, 'b0'))
  return {
    rows,
    getProject: async id => id === PID ? { id: PID, niche: 'Katzen', language: 'de', stylePrompt: 'witzig', topicBatchSize: 20 } : undefined,
    list: async (_p, s) => rows.filter(r => !s || r.status === s),
    existing: async () => rows.map(r => ({ title: r.title, fingerprint: r.fingerprint })),
    insertMany: async (_p, b, items) => {
      const out: TopicRow[] = []
      for (const i of items) {
        if (!rows.some(r => r.fingerprint === i.fingerprint)) {
          const r = mk(i, b)
          rows.push(r)
          out.push(r)
        }
      }
      return out
    },
    get: async (_p, id) => rows.find(r => r.id === id),
    setStatus: async (_p, id, s) => {
      const r = rows.find(x => x.id === id)
      if (r) r.status = s
      return r
    }
  }
}

function fakeGuard(opts: { reserveError?: Error } = {}) {
  const log: string[] = []
  const guard = {
    reserve: async (i: { operation: string, estimateCents: number }) => {
      if (opts.reserveError) throw opts.reserveError
      log.push(`reserve:${i.operation}:${i.estimateCents}`)
      return { id: 'r1', amountCents: i.estimateCents, expiresAt: new Date(), alerts: [] }
    },
    commit: async (id: string, c: number) => {
      log.push(`commit:${id}:${c}`)
      return { id, amountCents: c, alerts: [] }
    },
    release: async (id: string) => {
      log.push(`release:${id}`)
    }
  } as unknown as CostGuard
  return { guard, log }
}

const svc = (repo: TopicRepo, idea: IdeaProvider, guard: CostGuard) =>
  createTopicService({ repo, ideaProvider: async () => idea, costGuard: () => guard })

describe('Fingerprint', () => {
  it('ignoriert Gross-/Kleinschreibung, Akzente, Satzzeichen, Whitespace', () => {
    expect(topicFingerprint('Warum  Katzen schnurren?')).toBe(topicFingerprint('warum katzen, schnurren'))
    expect(normalizeTopicTitle('Café Größe!')).toBe('cafe grosse')
    expect(topicFingerprint('a')).not.toBe(topicFingerprint('b'))
  })
})

describe('TopicService.generate', () => {
  it('speichert neue Themen, uebergibt Ausschlussliste, reserviert und committet', async () => {
    const repo = memRepo(['Katzen Thema 1'])
    const idea = new FakeIdeaProvider()
    const { guard, log } = fakeGuard()
    const r = await svc(repo, idea, guard).generate(PID, { count: 3 })
    expect(r.created).toHaveLength(3)
    const call = idea.calls[0]!.args as { exclude: string[], niche: string, style: string, count: number }
    expect(call.exclude).toEqual(['Katzen Thema 1'])
    expect(call.niche).toBe('Katzen')
    expect(call.style).toBe('witzig')
    expect(log[0]).toMatch(/^reserve:topics.generate:/)
    expect(log[1]).toMatch(/^commit:r1:\d+$/)
    expect(repo.rows).toHaveLength(4)
  })

  it('filtert Varianten per Fingerprint (Bestand und innerhalb des Batches)', async () => {
    const repo = memRepo(['Warum Katzen schnurren'])
    const idea: IdeaProvider = {
      name: 'x',
      testConnection: async () => ({ ok: true }),
      generateTopics: async () => ({
        topics: [{ title: 'warum katzen schnurren?', angle: '' }, { title: 'Neu', angle: 'a' }, { title: 'NEU!', angle: '' }],
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.0004 }
      })
    }
    const { guard, log } = fakeGuard()
    const r = await svc(repo, idea, guard).generate(PID)
    expect(r.created.map(t => t.title)).toEqual(['Neu'])
    expect(r.duplicates).toBe(2)
    expect(log[1]).toBe('commit:r1:1')
  })

  it('Providerfehler -> release, Fehler propagiert (Retry), nichts gespeichert', async () => {
    const repo = memRepo()
    const idea = new FakeIdeaProvider({ failures: ['retryable'] })
    const { guard, log } = fakeGuard()
    await expect(svc(repo, idea, guard).generate(PID)).rejects.toBeInstanceOf(RetryableError)
    expect(log).toEqual(['reserve:topics.generate:2', 'release:r1'])
    expect(repo.rows).toHaveLength(0)
  })

  it('Budget ueberschritten -> kein Provider-Call', async () => {
    const idea = new FakeIdeaProvider()
    const { guard } = fakeGuard({ reserveError: new BudgetExceededError('day', 1, 1, 2, PID) })
    await expect(svc(memRepo(), idea, guard).generate(PID)).rejects.toBeInstanceOf(BudgetExceededError)
    expect(idea.calls).toHaveLength(0)
  })

  it('unbekanntes Projekt -> 404', async () => {
    const { guard } = fakeGuard()
    await expect(svc(memRepo(), new FakeIdeaProvider(), guard).generate('22222222-2222-4222-8222-222222222222')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('TopicService.setStatus', () => {
  it('annehmen/ablehnen, used gesperrt, ungueltiger Status 400', async () => {
    const repo = memRepo(['A', 'B'])
    const { guard } = fakeGuard()
    const s = svc(repo, new FakeIdeaProvider(), guard)
    const [a, b] = repo.rows
    expect((await s.setStatus(PID, a!.id, 'approved')).status).toBe('approved')
    expect((await s.setStatus(PID, a!.id, 'rejected')).status).toBe('rejected')
    expect((await s.list(PID, 'rejected')).map(t => t.title)).toEqual(['A'])
    b!.status = 'used'
    await expect(s.setStatus(PID, b!.id, 'approved')).rejects.toMatchObject({ statusCode: 409 })
    await expect(s.setStatus(PID, a!.id, 'used')).rejects.toMatchObject({ statusCode: 400 })
    await expect(s.setStatus(PID, '33333333-3333-4333-8333-333333333333', 'approved')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('guardedCall', () => {
  it('usdToCents rundet auf', () => {
    expect(usdToCents(0)).toBe(0)
    expect(usdToCents(0.0004)).toBe(1)
    expect(usdToCents(0.02)).toBe(2)
  })
  it('commit mit realen Kosten', async () => {
    const { guard, log } = fakeGuard()
    const r = await guardedCall(guard, { projectId: PID, provider: 'deepseek', operation: 'x', estimateCents: 5 }, async () => ({ value: 'ok', costUsd: 0.031 }))
    expect(r.result).toBe('ok')
    expect(log).toEqual(['reserve:x:5', 'commit:r1:4'])
  })
})
