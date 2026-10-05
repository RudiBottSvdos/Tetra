import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, id, timestamps } from './_common'
import { project } from './project'
import { video } from './video'

export const COST_STATUSES = ['reserved', 'committed', 'released'] as const

export const costEntry = pgTable('cost_entry', {
  id: id(),
  /** NULL = globaler Posten */
  projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
  videoId: uuid('video_id').references(() => video.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  operation: text('operation').notNull(),
  amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
  units: bigint('units', { mode: 'number' }),
  status: text('status').notNull().default('reserved'),
  reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }),
  estimated: boolean('estimated').notNull().default(false),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps()
}, t => [
  index('cost_entry_project_at_idx').on(t.projectId, t.at),
  index('cost_entry_status_expiry_idx').on(t.status, t.reservationExpiresAt),
  enumCheck('cost_entry_status_check', t.status, COST_STATUSES),
  check('cost_entry_amount_check', sql`${t.amountMicroUsd} >= 0`)
])
