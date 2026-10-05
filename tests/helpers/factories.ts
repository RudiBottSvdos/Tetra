import { randomUUID } from 'node:crypto'
import * as s from '../../server/db/schema'
import type { TestDb } from './db'

type Db = TestDb['db']
let seq = 0
const n = () => ++seq

export async function createProject(db: Db, over: Partial<typeof s.project.$inferInsert> = {}) {
  const [row] = await db.insert(s.project).values({ name: `project-${n()}`, ...over }).returning()
  return row!
}

export async function createChannel(db: Db, projectId: string, over: Partial<typeof s.channel.$inferInsert> = {}) {
  const [row] = await db.insert(s.channel).values({ projectId, platform: 'youtube', displayName: `channel-${n()}`, ...over }).returning()
  return row!
}

export async function createTopic(db: Db, projectId: string, over: Partial<typeof s.topic.$inferInsert> = {}) {
  const i = n()
  const [row] = await db.insert(s.topic).values({ projectId, title: `topic ${i}`, fingerprint: `fp-${i}-${randomUUID().slice(0, 8)}`, ...over }).returning()
  return row!
}

export async function createVideo(db: Db, projectId: string, over: Partial<typeof s.video.$inferInsert> = {}) {
  const [row] = await db.insert(s.video).values({ projectId, ...over }).returning()
  return row!
}

/** Komplette Kette project -> channel -> topic -> video. */
export async function createScenario(db: Db) {
  const project = await createProject(db)
  const channel = await createChannel(db, project.id)
  const topic = await createTopic(db, project.id)
  const video = await createVideo(db, project.id)
  return { project, channel, topic, video }
}
