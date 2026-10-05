/** Themen-Service (WP1.5): generieren -> Dedup per Fingerprint -> speichern; annehmen/ablehnen. */
import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { schema, useDb } from '../db'
import type { TOPIC_STATUSES } from '../db/schema/topic'
import type { IdeaProvider, TopicSuggestion, Usage } from '../providers/types'
import { useProviderRegistry } from '../providers/credentials'
import { useCostGuard, type CostGuard } from './cost-guard'
import { guardedCall } from './guarded-call'

export type TopicStatus = typeof TOPIC_STATUSES[number]
export type TopicRow = typeof schema.topic.$inferSelect

export interface TopicProject {
  id: string
  niche: string
  language: string
  stylePrompt: string
  topicBatchSize: number
}

export interface NewTopic { title: string, angle: string | null, fingerprint: string }

export interface TopicRepo {
  getProject(projectId: string): Promise<TopicProject | undefined>
  list(projectId: string, status?: TopicStatus): Promise<TopicRow[]>
  /** Alle Titel + Fingerprints des Projekts (für Ausschlussliste und Dedup). */
  existing(projectId: string): Promise<{ title: string, fingerprint: string }[]>
  /** Fügt ein; bei Fingerprint-Konflikt (Race) wird die Zeile übersprungen. */
  insertMany(projectId: string, batchId: string, items: NewTopic[]): Promise<TopicRow[]>
  get(projectId: string, topicId: string): Promise<TopicRow | undefined>
  setStatus(projectId: string, topicId: string, status: TopicStatus): Promise<TopicRow | undefined>
}

/** Normalisiert (Kleinschreibung, ohne Akzente/Satzzeichen, Whitespace) und hasht (sha256 hex). */
export function normalizeTopicTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function topicFingerprint(title: string): string {
  return createHash('sha256').update(normalizeTopicTitle(title)).digest('hex')
}

export const MAX_TOPIC_COUNT = 50
/** Pauschale Reservierung je Themen-Call (Cent, aufgerundet; Deepseek-Kosten liegen darunter). */
export const TOPIC_RESERVE_CENTS = 2

export interface GenerateResult {
  batchId: string
  requested: number
  created: TopicRow[]
  duplicates: number
  usage: Usage
}

export interface TopicServiceDeps {
  repo: TopicRepo
  ideaProvider: (projectId: string) => Promise<IdeaProvider>
  costGuard: () => CostGuard
}

const TARGETS: readonly TopicStatus[] = ['approved', 'rejected']

export function createTopicService(deps: TopicServiceDeps) {
  const { repo } = deps
  const notFound = (what: string) => createError({ statusCode: 404, statusMessage: `${what} nicht gefunden` })

  async function requireProject(id: string) {
    const p = await repo.getProject(id)
    if (!p) throw notFound('Projekt')
    return p
  }

  return {
    async list(projectId: string, status?: TopicStatus) {
      await requireProject(projectId)
      return repo.list(projectId, status)
    },

    async generate(projectId: string, opts: { count?: number } = {}): Promise<GenerateResult> {
      const project = await requireProject(projectId)
      const count = Math.min(Math.max(Math.trunc(opts.count ?? project.topicBatchSize), 1), MAX_TOPIC_COUNT)
      const known = await repo.existing(projectId)
      const seen = new Set(known.map(k => k.fingerprint))
      const provider = await deps.ideaProvider(projectId)

      const { result } = await guardedCall(deps.costGuard(), {
        projectId,
        provider: provider.name,
        operation: 'topics.generate',
        estimateCents: TOPIC_RESERVE_CENTS
      }, async () => {
        const r = await provider.generateTopics({
          niche: project.niche,
          count,
          language: project.language,
          style: project.stylePrompt || undefined,
          exclude: known.map(k => k.title)
        })
        return { value: r, costUsd: r.usage.costUsd }
      })

      // Dedup gegen Bestand und innerhalb des Batches.
      const fresh: NewTopic[] = []
      let duplicates = 0
      for (const t of result.topics as TopicSuggestion[]) {
        const title = t.title.trim()
        const fp = topicFingerprint(title)
        if (!normalizeTopicTitle(title) || seen.has(fp)) {
          duplicates++
          continue
        }
        seen.add(fp)
        fresh.push({ title, angle: t.angle?.trim() || null, fingerprint: fp })
      }
      const batchId = randomUUID()
      const created = fresh.length ? await repo.insertMany(projectId, batchId, fresh) : []
      duplicates += fresh.length - created.length
      return { batchId, requested: count, created, duplicates, usage: result.usage }
    },

    /** Annehmen/Ablehnen; verwendete Themen sind gesperrt. */
    async setStatus(projectId: string, topicId: string, status: string): Promise<TopicRow> {
      if (!(TARGETS as readonly string[]).includes(status)) {
        throw createError({ statusCode: 400, statusMessage: 'Ungültige Eingabe', data: { errors: { status: 'Erlaubt: approved, rejected.' } } })
      }
      await requireProject(projectId)
      const cur = await repo.get(projectId, topicId)
      if (!cur) throw notFound('Thema')
      if (cur.status === 'used') throw createError({ statusCode: 409, statusMessage: 'Verwendete Themen können nicht geändert werden.' })
      if (cur.status === status) return cur
      const updated = await repo.setStatus(projectId, topicId, status as TopicStatus)
      if (!updated) throw notFound('Thema')
      return updated
    }
  }
}

export const drizzleTopicRepo: TopicRepo = {
  async getProject(projectId) {
    const p = schema.project
    const [r] = await useDb().select({
      id: p.id, niche: p.niche, language: p.language, stylePrompt: p.stylePrompt, topicBatchSize: p.topicBatchSize
    }).from(p).where(eq(p.id, projectId))
    return r
  },
  async list(projectId, status) {
    const t = schema.topic
    return useDb().select().from(t)
      .where(status ? and(eq(t.projectId, projectId), eq(t.status, status)) : eq(t.projectId, projectId))
      .orderBy(desc(t.createdAt))
  },
  async existing(projectId) {
    const t = schema.topic
    return useDb().select({ title: t.title, fingerprint: t.fingerprint }).from(t).where(eq(t.projectId, projectId))
  },
  async insertMany(projectId, batchId, items) {
    return useDb().insert(schema.topic)
      .values(items.map(i => ({ projectId, batchId, title: i.title, angle: i.angle, fingerprint: i.fingerprint })))
      .onConflictDoNothing({ target: [schema.topic.projectId, schema.topic.fingerprint] })
      .returning()
  },
  async get(projectId, topicId) {
    const t = schema.topic
    const [r] = await useDb().select().from(t).where(and(eq(t.projectId, projectId), eq(t.id, topicId)))
    return r
  },
  async setStatus(projectId, topicId, status) {
    const t = schema.topic
    const [r] = await useDb().update(t).set({ status }).where(and(eq(t.projectId, projectId), eq(t.id, topicId))).returning()
    return r
  }
}

let _svc: ReturnType<typeof createTopicService> | undefined
export const topicService = () => (_svc ??= createTopicService({
  repo: drizzleTopicRepo,
  ideaProvider: projectId => useProviderRegistry().idea({ projectId }),
  costGuard: () => useCostGuard()
}))
