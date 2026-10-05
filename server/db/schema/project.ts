import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, id, timestamps } from './_common'

export const VIDEO_PROVIDERS = ['heygen', 'fallback'] as const
export type VideoProviderKey = typeof VIDEO_PROVIDERS[number]

export const project = pgTable('project', {
  id: id(),
  name: text('name').notNull(),
  niche: text('niche').notNull().default(''),
  language: text('language').notNull().default('de'),
  stylePrompt: text('style_prompt').notNull().default(''),
  visualStylePrompt: text('visual_style_prompt').notNull().default(''),
  /** NULL = avatarlos */
  heygenAvatarId: text('heygen_avatar_id'),
  heygenVoiceId: text('heygen_voice_id'),
  videoProvider: text('video_provider').notNull().default('heygen'),
  scriptApprovalRequired: boolean('script_approval_required').notNull().default(true),
  dailyBudgetCents: integer('daily_budget_cents').notNull().default(300),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(6000),
  productionPaused: boolean('production_paused').notNull().default(false),
  pauseReason: text('pause_reason'),
  targetVideoLengthS: integer('target_video_length_s').notNull().default(40),
  topicBatchSize: integer('topic_batch_size').notNull().default(20),
  maxRetries: integer('max_retries').notNull().default(3),
  maxVideosInReview: integer('max_videos_in_review').notNull().default(3),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  ...timestamps()
}, t => [
  enumCheck('project_video_provider_check', t.videoProvider, VIDEO_PROVIDERS),
  check('project_target_length_check', sql`${t.targetVideoLengthS} between 30 and 45`),
  check('project_budget_check', sql`${t.dailyBudgetCents} >= 0 and ${t.monthlyBudgetCents} >= 0`)
])

export const projectSecret = pgTable('project_secret', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  valueEnc: text('value_enc').notNull(),
  ...timestamps()
}, t => [uniqueIndex('project_secret_project_key_uq').on(t.projectId, t.key)])
