import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, enumCheckNullable, id, timestamps } from './_common'
import { channel, PLATFORMS } from './channel'
import { video } from './video'

export const PUBLICATION_STATUSES = ['draft', 'pending', 'uploading', 'ok', 'failed'] as const
export const PUBLICATION_MODES = ['inbox', 'direct', 'private'] as const
export const METRIC_SOURCES = ['api', 'manual'] as const

export const publication = pgTable('publication', {
  id: id(),
  videoId: uuid('video_id').notNull().references(() => video.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').notNull().references(() => channel.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  title: text('title').notNull().default(''),
  description: text('description').notNull().default(''),
  hashtags: jsonb('hashtags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** KI-Kennzeichnung: immer true, per CHECK erzwungen. */
  aiLabel: boolean('ai_label').notNull().default(true),
  metaEdited: boolean('meta_edited').notNull().default(false),
  externalPostId: text('external_post_id'),
  status: text('status').notNull().default('draft'),
  mode: text('mode'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  ...timestamps()
}, t => [
  uniqueIndex('publication_video_channel_uq').on(t.videoId, t.channelId),
  index('publication_channel_idx').on(t.channelId),
  check('publication_ai_label_check', sql`${t.aiLabel} = true`),
  enumCheck('publication_platform_check', t.platform, PLATFORMS),
  enumCheck('publication_status_check', t.status, PUBLICATION_STATUSES),
  enumCheckNullable('publication_mode_check', t.mode, PUBLICATION_MODES)
])

export const metricSnapshot = pgTable('metric_snapshot', {
  id: id(),
  publicationId: uuid('publication_id').notNull().references(() => publication.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  views: integer('views').notNull().default(0),
  likes: integer('likes').notNull().default(0),
  comments: integer('comments').notNull().default(0),
  shares: integer('shares'),
  source: text('source').notNull().default('api'),
  ...timestamps()
}, t => [
  uniqueIndex('metric_snapshot_publication_date_uq').on(t.publicationId, t.date),
  enumCheck('metric_snapshot_source_check', t.source, METRIC_SOURCES)
])
