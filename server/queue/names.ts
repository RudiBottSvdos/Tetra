import type { Queue } from 'pg-boss'

/** pg-boss legt seine Tabellen im eigenen Schema an; nie nach `public`, nie in Drizzle-Migrationen. */
export const PGBOSS_SCHEMA = 'pgboss'

export const QUEUES = {
  topicsGenerate: 'topics.generate',
  scriptGenerate: 'script.generate',
  videoRender: 'video.render',
  videoPoll: 'video.poll',
  videoUpload: 'video.upload',
  mediaArchive: 'media.archive',
  mediaCleanup: 'media.cleanup',
  metricsSync: 'metrics.sync',
  schedulerTick: 'scheduler.tick',
  costAlert: 'cost.alert',
  notifyDeliver: 'notify.deliver',
  reservationReap: 'reservation.reap'
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

/** Gemeinsame Dead-Letter-Queue: Jobs, die das Retry-Limit ueberschreiten, landen hier. */
export const DEAD_LETTER_QUEUE = 'jobs.dead_letter'

/**
 * Payload-Typen je Queue. Spaetere Pakete praezisieren die Typen hier (gemeinsame Datei,
 * Absprache noetig) oder nutzen Declaration Merging auf diesem Interface.
 */
export interface QueuePayloads {
  'topics.generate': Record<string, unknown>
  'script.generate': Record<string, unknown>
  'video.render': Record<string, unknown>
  'video.poll': Record<string, unknown>
  'video.upload': Record<string, unknown>
  'media.archive': Record<string, unknown>
  'media.cleanup': Record<string, unknown>
  'metrics.sync': Record<string, unknown>
  'scheduler.tick': Record<string, unknown>
  'cost.alert': Record<string, unknown>
  'notify.deliver': Record<string, unknown>
  'reservation.reap': Record<string, unknown>
}

export type PayloadOf<Q extends QueueName> = Q extends keyof QueuePayloads ? QueuePayloads[Q] : Record<string, unknown>

export type QueueConfig = Omit<Queue, 'name'>

/** Retry-/Backoff-Defaults: begrenzte Wiederholungen mit exponentiellem Backoff, dann Dead-Letter. */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
  expireInSeconds: 15 * 60,
  retentionSeconds: 14 * 24 * 3600,
  deleteAfterSeconds: 7 * 24 * 3600,
  deadLetter: DEAD_LETTER_QUEUE
}

/** Abweichungen vom Default je Queue (Render/Poll/Upload laufen laenger bzw. brauchen andere Limits). */
const OVERRIDES: Partial<Record<QueueName, QueueConfig>> = {
  [QUEUES.videoRender]: { retryLimit: 2, retryDelay: 60, expireInSeconds: 30 * 60 },
  [QUEUES.videoPoll]: { retryLimit: 20, retryDelay: 30, retryBackoff: false, expireInSeconds: 5 * 60 },
  [QUEUES.videoUpload]: { retryLimit: 5, retryDelay: 60, expireInSeconds: 60 * 60 },
  [QUEUES.mediaArchive]: { retryLimit: 5, retryDelay: 60, expireInSeconds: 60 * 60 },
  [QUEUES.schedulerTick]: { retryLimit: 0, expireInSeconds: 120 },
  [QUEUES.reservationReap]: { retryLimit: 0, expireInSeconds: 120 },
  [QUEUES.metricsSync]: { retryLimit: 2, retryDelay: 300, expireInSeconds: 30 * 60 }
}

export function queueConfig(name: QueueName): QueueConfig {
  return { ...DEFAULT_QUEUE_CONFIG, ...OVERRIDES[name] }
}

export const ALL_QUEUES = Object.values(QUEUES) as QueueName[]

export interface CronSchedule {
  queue: QueueName
  cron: string
  /** pg-boss `key`: macht die Registrierung idempotent. */
  key: string
}

/** Cron-Registrierung (Platzhalter-Jobs; echte Handler liefern spaetere Pakete). Zeitzone UTC. */
export const CRON_SCHEDULES: readonly CronSchedule[] = [
  { queue: QUEUES.schedulerTick, cron: '* * * * *', key: 'slot-scheduler' },
  { queue: QUEUES.metricsSync, cron: '0 4 * * *', key: 'metrics-daily' },
  { queue: QUEUES.reservationReap, cron: '*/5 * * * *', key: 'reservation-reaper' }
]
