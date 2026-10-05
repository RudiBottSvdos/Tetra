import { and, desc, eq, isNull } from 'drizzle-orm'
import { schema, useDb } from '../db'
import type { CostAlertEvent, CostAlertHook } from './cost-guard'

/**
 * Notification-Service (WP1.10). Banner im Panel zuerst; externe Zustellung (E-Mail/n8n, WP6.4)
 * haengt sich ueber das NotificationChannel-Interface ein.
 */

export const NOTIFICATION_TYPES = ['cost_alert', 'budget_pause', 'token_expired', 'error', 'info'] as const
export type NotificationType = typeof NOTIFICATION_TYPES[number]
export type NotificationSeverity = 'info' | 'warning' | 'error'

export interface NotificationRecord {
  id: string
  projectId: string | null
  type: string
  severity: string
  message: string
  dedupeKey: string | null
  readAt: Date | null
  resolvedAt: Date | null
  createdAt: Date
}

export interface NewNotification {
  type: NotificationType
  message: string
  severity?: NotificationSeverity
  projectId?: string | null
  /** Idempotenz: gleicher Schluessel erzeugt keine zweite Notification. */
  dedupeKey?: string | null
}

export interface NotificationRepo {
  findByDedupeKey(key: string): Promise<NotificationRecord | undefined>
  /** Liefert undefined, wenn der dedupe_key bereits existiert (Race). */
  insert(n: { projectId: string | null, type: string, severity: string, message: string, dedupeKey: string | null }): Promise<NotificationRecord | undefined>
  listUnread(limit: number): Promise<NotificationRecord[]>
  markRead(id: string, at: Date): Promise<NotificationRecord | undefined>
}

/** Kanal fuer spaetere externe Zustellung (E-Mail, n8n-Webhook; WP6.4). */
export interface NotificationChannel {
  readonly name: string
  deliver(n: NotificationRecord): Promise<void>
}

export const noopChannel: NotificationChannel = { name: 'noop', async deliver() { /* bewusst leer */ } }

const DEFAULT_SEVERITY: Record<NotificationType, NotificationSeverity> = {
  cost_alert: 'warning', budget_pause: 'error', token_expired: 'warning', error: 'error', info: 'info'
}

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(v)
}

export interface NotificationServiceDeps {
  repo: NotificationRepo
  channels?: NotificationChannel[]
  now?: () => Date
}

export function createNotificationService(deps: NotificationServiceDeps) {
  const { repo } = deps
  const channels = deps.channels ?? [noopChannel]
  const now = deps.now ?? (() => new Date())

  return {
    /** Idempotent ueber dedupeKey: liefert bei Wiederholung die bestehende Notification (created=false). */
    async create(input: NewNotification): Promise<{ notification: NotificationRecord, created: boolean }> {
      const key = input.dedupeKey ?? null
      if (key) {
        const existing = await repo.findByDedupeKey(key)
        if (existing) return { notification: existing, created: false }
      }
      const row = await repo.insert({
        projectId: input.projectId ?? null,
        type: input.type,
        severity: input.severity ?? DEFAULT_SEVERITY[input.type],
        message: input.message,
        dedupeKey: key
      })
      if (!row) {
        const existing = key ? await repo.findByDedupeKey(key) : undefined
        if (!existing) throw new Error('Notification konnte nicht angelegt werden')
        return { notification: existing, created: false }
      }
      for (const ch of channels) {
        try { await ch.deliver(row) } catch { /* Zustellung darf die Notification nicht kippen */ }
      }
      return { notification: row, created: true }
    },
    listUnread(limit = 50) {
      return repo.listUnread(limit)
    },
    /** dismiss == als gelesen markieren; idempotent. undefined = unbekannte ID. */
    async dismiss(id: string): Promise<NotificationRecord | undefined> {
      return repo.markRead(id, now())
    },
    markRead(id: string) {
      return this.dismiss(id)
    }
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>

// ---------- Cost-Alert-Adapter ----------

const SCOPE_LABEL = { day: 'Tagesbudget', month: 'Monatsbudget', global: 'globales Monatsbudget' } as const
const fmt = (c: number) => `${(c / 100).toFixed(2)} USD`

/** Bindet den CostAlertHook des CostGuard an den Service (80 %/100 %). */
export function createCostAlertHook(service: Pick<NotificationService, 'create'>): CostAlertHook {
  return {
    async onAlert(e: CostAlertEvent) {
      const full = e.threshold >= 100
      const label = SCOPE_LABEL[e.scope]
      await service.create({
        type: 'cost_alert',
        severity: full ? 'error' : 'warning',
        projectId: e.projectId,
        message: `${e.threshold} % des ${label}s erreicht: ${fmt(e.usedCents)} von ${fmt(e.limitCents)}.`,
        dedupeKey: `cost_alert:${e.scope}:${e.projectId ?? 'global'}:${e.windowStart.toISOString()}:${e.threshold}`
      })
    }
  }
}

// ---------- Drizzle-Repo ----------

function toRecord(r: typeof schema.notification.$inferSelect): NotificationRecord {
  return {
    id: r.id, projectId: r.projectId, type: r.type, severity: r.severity, message: r.message,
    dedupeKey: r.dedupeKey, readAt: r.readAt, resolvedAt: r.resolvedAt, createdAt: r.createdAt
  }
}

export const drizzleNotificationRepo: NotificationRepo = {
  async findByDedupeKey(key) {
    const t = schema.notification
    const [r] = await useDb().select().from(t).where(eq(t.dedupeKey, key))
    return r && toRecord(r)
  },
  async insert(n) {
    const t = schema.notification
    const [r] = await useDb().insert(t).values(n).onConflictDoNothing({ target: t.dedupeKey }).returning()
    return r && toRecord(r)
  },
  async listUnread(limit) {
    const t = schema.notification
    const rows = await useDb().select().from(t).where(and(isNull(t.readAt), isNull(t.resolvedAt))).orderBy(desc(t.createdAt)).limit(limit)
    return rows.map(toRecord)
  },
  async markRead(id, at) {
    const t = schema.notification
    const [cur] = await useDb().select().from(t).where(eq(t.id, id))
    if (!cur) return undefined
    if (cur.readAt) return toRecord(cur)
    const [r] = await useDb().update(t).set({ readAt: at, updatedAt: at }).where(eq(t.id, id)).returning()
    return r && toRecord(r)
  }
}

let _svc: NotificationService | undefined
export const useNotifications = (): NotificationService => (_svc ??= createNotificationService({ repo: drizzleNotificationRepo }))

/** Setzt den Alarm-Hook am Anwendungs-CostGuard (einmal beim Serverstart/Queue-Start aufrufen). */
export async function bindCostGuardAlerts() {
  const { useCostGuard } = await import('./cost-guard')
  return useCostGuard(createCostAlertHook(useNotifications()))
}
