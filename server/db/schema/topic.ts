import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, id, timestamps } from './_common'
import { project } from './project'

export const TOPIC_STATUSES = ['suggested', 'approved', 'rejected', 'used'] as const
export type TopicStatus = typeof TOPIC_STATUSES[number]

export const topic = pgTable('topic', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  angle: text('angle'),
  status: text('status').notNull().default('suggested'),
  fingerprint: text('fingerprint').notNull(),
  batchId: uuid('batch_id'),
  ...timestamps()
}, t => [
  uniqueIndex('topic_project_fingerprint_uq').on(t.projectId, t.fingerprint),
  enumCheck('topic_status_check', t.status, TOPIC_STATUSES)
])
