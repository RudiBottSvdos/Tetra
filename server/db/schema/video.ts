import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { enumCheck, enumCheckNullable, id, timestamps } from './_common'
import { project } from './project'
import { topic } from './topic'

/** Zustandsautomat (Abschnitt 3 des Plans). Uebergaenge liegen in services/video-state.ts (WP1.3). */
export const VIDEO_STATUSES = [
  'idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering',
  'awaiting_review', 'scheduled', 'uploading', 'uploaded', 'partially_uploaded',
  'failed', 'paused_budget', 'rejected'
] as const
export type VideoStatus = typeof VIDEO_STATUSES[number]
export const VISUAL_MODES = ['faceless', 'avatar'] as const
export const STORAGE_BACKENDS = ['local', 'onedrive'] as const

export const video = pgTable('video', {
  id: id(),
  projectId: uuid('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  topicId: uuid('topic_id').references(() => topic.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('idea'),
  resumeStatus: text('resume_status'),
  script: text('script'),
  scriptApprovedAt: timestamp('script_approved_at', { withTimezone: true }),
  heygenSessionId: text('heygen_session_id'),
  heygenVideoId: text('heygen_video_id'),
  visualMode: text('visual_mode'),
  filePath: text('file_path'),
  storageBackend: text('storage_backend').notNull().default('local'),
  storageRef: text('storage_ref'),
  localDeletedAt: timestamp('local_deleted_at', { withTimezone: true }),
  durationS: integer('duration_s'),
  publishAt: timestamp('publish_at', { withTimezone: true }),
  slotAt: timestamp('slot_at', { withTimezone: true }),
  rejectedReason: text('rejected_reason'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  ...timestamps()
}, t => [
  index('video_project_status_idx').on(t.projectId, t.status),
  index('video_slot_idx').on(t.slotAt),
  enumCheck('video_status_check', t.status, VIDEO_STATUSES),
  enumCheckNullable('video_resume_status_check', t.resumeStatus, VIDEO_STATUSES),
  enumCheckNullable('video_visual_mode_check', t.visualMode, VISUAL_MODES),
  enumCheck('video_storage_backend_check', t.storageBackend, STORAGE_BACKENDS)
])

export const videoEvent = pgTable('video_event', {
  id: id(),
  videoId: uuid('video_id').notNull().references(() => video.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  message: text('message'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps()
}, t => [
  index('video_event_video_idx').on(t.videoId, t.at),
  enumCheckNullable('video_event_from_status_check', t.fromStatus, VIDEO_STATUSES),
  enumCheck('video_event_to_status_check', t.toStatus, VIDEO_STATUSES)
])
