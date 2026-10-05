import { and, eq } from 'drizzle-orm'
import { project, video, videoEvent } from '../db/schema'
import { isVideoStatus, transition, type TransitionOptions, type TransitionResult, type VideoStatus } from './video-state'

/** Schmale Sicht auf den drizzle-Client (useDb() oder Test-DB); erlaubt Mocks. */
export interface TransitionDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>
}

export class VideoNotFoundError extends Error {
  constructor(public readonly videoId: string) {
    super(`Video ${videoId} nicht gefunden`)
    this.name = 'VideoNotFoundError'
  }
}

/** Optimistische Nebenlaeufigkeit: Status in der DB entspricht nicht dem erwarteten Von-Status. */
export class ConcurrentTransitionError extends Error {
  constructor(public readonly videoId: string, public readonly expectedFrom: VideoStatus, public readonly actual?: string) {
    super(`Video ${videoId}: erwarteter Status ${expectedFrom}, tatsaechlich ${actual ?? 'geaendert'}`)
    this.name = 'ConcurrentTransitionError'
  }
}

export interface TransitionVideoInput extends TransitionOptions {
  videoId: string
  /** Erwarteter aktueller Status (optimistische Sperre). */
  expectedFrom: VideoStatus
  to: VideoStatus
  /** Text fuer video_event.message. */
  message?: string
  /** Fehlertext (bei Wechsel nach failed -> video.last_error). */
  error?: string
  /** Ablehnungsgrund (-> video.rejected_reason). */
  rejectedReason?: string
  now?: Date
}

/**
 * Status-Update + video_event in einer Transaktion. Wirft InvalidTransitionError,
 * VideoNotFoundError oder ConcurrentTransitionError; dann wird nichts geschrieben.
 */
export async function transitionVideo(db: TransitionDb, input: TransitionVideoInput): Promise<TransitionResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        status: video.status,
        resumeStatus: video.resumeStatus,
        scriptApprovalRequired: project.scriptApprovalRequired
      })
      .from(video)
      .innerJoin(project, eq(project.id, video.projectId))
      .where(eq(video.id, input.videoId))
      .limit(1)
    const row = rows[0]
    if (!row) throw new VideoNotFoundError(input.videoId)
    if (row.status !== input.expectedFrom) throw new ConcurrentTransitionError(input.videoId, input.expectedFrom, row.status)
    if (!isVideoStatus(row.status)) throw new Error(`Unbekannter Videostatus in DB: ${row.status}`)

    const result = transition(
      {
        status: row.status,
        resumeStatus: isVideoStatus(row.resumeStatus) ? row.resumeStatus : null,
        scriptApprovalRequired: row.scriptApprovalRequired
      },
      input.to,
      { confirmedCost: input.confirmedCost }
    )

    const now = input.now ?? new Date()
    const patch: Partial<typeof video.$inferInsert> = {
      status: result.to,
      resumeStatus: result.resumeStatus,
      updatedAt: now
    }
    if (result.resetAttempts) patch.attempts = 0
    if (result.scriptApproved) patch.scriptApprovedAt = now
    if (result.to === 'failed') patch.lastError = input.error ?? null
    else if (result.from === 'failed') patch.lastError = null
    if (input.rejectedReason !== undefined) patch.rejectedReason = input.rejectedReason

    // Bedingtes Update: schuetzt gegen Races zwischen Lesen und Schreiben.
    const updated = await tx
      .update(video)
      .set(patch)
      .where(and(eq(video.id, input.videoId), eq(video.status, input.expectedFrom)))
      .returning({ id: video.id })
    if (updated.length === 0) throw new ConcurrentTransitionError(input.videoId, input.expectedFrom)

    await tx.insert(videoEvent).values({
      videoId: input.videoId,
      fromStatus: result.from,
      toStatus: result.to,
      message: input.message ?? input.error ?? input.rejectedReason ?? null,
      at: now
    })
    return result
  })
}
