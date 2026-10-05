import { eq } from 'drizzle-orm'
import { schema, useDb } from '../db'
import { BudgetExceededError } from '../domain/cost-guard'
import { useNotifications, type NotificationService } from '../domain/notifications'
import { transitionVideo, type TransitionDb } from '../domain/video-transitions'
import type { VideoStatus } from '../domain/video-state'

export interface BudgetPauseContext {
  projectId: string
  /** Optional: Video, das in paused_budget wechseln soll (nur wenn videoStatus pausierbar ist). */
  videoId?: string
  videoStatus?: VideoStatus
}

export interface BudgetPauseDeps {
  notifications: Pick<NotificationService, 'create'>
  pauseProject(projectId: string, reason: string): Promise<void>
  pauseVideo(videoId: string, from: VideoStatus, reason: string): Promise<void>
}

const SCOPE_TEXT = { day: 'Tagesbudget', month: 'Monatsbudget', global: 'globales Monatsbudget' } as const

export function defaultBudgetPauseDeps(): BudgetPauseDeps {
  return {
    notifications: useNotifications(),
    async pauseProject(projectId, reason) {
      await useDb().update(schema.project)
        .set({ productionPaused: true, pauseReason: reason })
        .where(eq(schema.project.id, projectId))
    },
    async pauseVideo(videoId, from, reason) {
      await transitionVideo(useDb() as unknown as TransitionDb, { videoId, expectedFrom: from, to: 'paused_budget', message: reason })
    }
  }
}

export type BudgetPauseResult<T> = { paused: false, value: T } | { paused: true, error: BudgetExceededError }

/**
 * Job-Wrapper: faengt BudgetExceededError, pausiert das Projekt (und ggf. das Video),
 * legt eine budget_pause-Notification an und beendet den Job ohne Retry (Ergebnis paused: true).
 * Alle anderen Fehler werden unveraendert weitergeworfen.
 */
export async function withBudgetPause<T>(
  ctx: BudgetPauseContext,
  fn: () => Promise<T>,
  deps: BudgetPauseDeps = defaultBudgetPauseDeps()
): Promise<BudgetPauseResult<T>> {
  try {
    return { paused: false, value: await fn() }
  } catch (err) {
    if (!(err instanceof BudgetExceededError)) throw err
    const scope = SCOPE_TEXT[err.reason]
    const reason = `Budget ueberschritten (${scope})`
    const projectId = err.projectId ?? ctx.projectId
    // Global-Limit pausiert ebenfalls das ausloesende Projekt; Notification je Projekt/Scope.
    await deps.pauseProject(projectId, reason)
    if (ctx.videoId && ctx.videoStatus) {
      try { await deps.pauseVideo(ctx.videoId, ctx.videoStatus, reason) } catch { /* Status nicht pausierbar/Race: Projekt-Pause genuegt */ }
    }
    await deps.notifications.create({
      type: 'budget_pause',
      severity: 'error',
      projectId,
      message: `Produktion pausiert: ${scope} erreicht (${(err.usedCents / 100).toFixed(2)} von ${(err.limitCents / 100).toFixed(2)} USD).`,
      dedupeKey: `budget_pause:${err.reason}:${projectId}:${new Date().toISOString().slice(0, 10)}`
    })
    return { paused: true, error: err }
  }
}
