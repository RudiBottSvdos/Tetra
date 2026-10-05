import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, id, timestamps } from './_common'
import { project } from './project'

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'error'] as const

export const notification = pgTable('notification', {
  id: id(),
  projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  severity: text('severity').notNull().default('info'),
  message: text('message').notNull(),
  dedupeKey: text('dedupe_key'),
  readAt: timestamp('read_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deliveryAttempts: integer('delivery_attempts').notNull().default(0),
  ...timestamps()
}, t => [
  uniqueIndex('notification_dedupe_key_uq').on(t.dedupeKey),
  index('notification_project_idx').on(t.projectId),
  enumCheck('notification_severity_check', t.severity, NOTIFICATION_SEVERITIES)
])
