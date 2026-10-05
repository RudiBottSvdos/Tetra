import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, id, timestamps } from './_common'
import { project } from './project'

export const PLATFORMS = ['youtube', 'tiktok'] as const
export type Platform = typeof PLATFORMS[number]
export const CHANNEL_STATUSES = ['connected', 'expired', 'audit_pending'] as const
export const TIKTOK_MODES = ['inbox', 'direct'] as const
export const YOUTUBE_VISIBILITIES = ['private', 'public'] as const

export const channel = pgTable('channel', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  displayName: text('display_name').notNull(),
  externalId: text('external_id'),
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  scopes: text('scopes'),
  status: text('status').notNull().default('connected'),
  tiktokMode: text('tiktok_mode').notNull().default('inbox'),
  youtubeVisibility: text('youtube_visibility').notNull().default('private'),
  ...timestamps()
}, t => [
  index('channel_project_idx').on(t.projectId),
  enumCheck('channel_platform_check', t.platform, PLATFORMS),
  enumCheck('channel_status_check', t.status, CHANNEL_STATUSES),
  enumCheck('channel_tiktok_mode_check', t.tiktokMode, TIKTOK_MODES),
  enumCheck('channel_youtube_visibility_check', t.youtubeVisibility, YOUTUBE_VISIBILITIES)
])

export const scheduleRule = pgTable('schedule_rule', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  /** 0 = Sonntag ... 6 = Samstag */
  weekday: integer('weekday').notNull(),
  timeLocal: time('time_local').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  videosPerDay: integer('videos_per_day').notNull().default(1),
  enabled: boolean('enabled').notNull().default(true),
  ...timestamps()
}, t => [
  index('schedule_rule_project_idx').on(t.projectId),
  check('schedule_rule_weekday_check', sql`${t.weekday} between 0 and 6`),
  check('schedule_rule_videos_check', sql`${t.videosPerDay} >= 1`)
])
