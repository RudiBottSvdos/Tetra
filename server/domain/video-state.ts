import { VIDEO_STATUSES, type VideoStatus } from '../db/schema/video'

/**
 * Reiner, DB-unabhaengiger Zustandsautomat fuer Videos (Plan Abschnitt 3, WP1.3).
 * Persistenz: server/domain/video-transitions.ts.
 */

export type { VideoStatus }
export { VIDEO_STATUSES }

/** Zustaende, aus denen pausiert/fehlgeschlagen wird und die danach fortsetzbar sind. */
export const RESUMABLE_STATUSES = ['idea', 'scripting', 'rendering', 'uploading'] as const satisfies readonly VideoStatus[]
/** Zustaende, aus denen heraus pausiert wird (Budget). */
export const PAUSABLE_STATUSES = ['idea', 'scripting', 'rendering'] as const satisfies readonly VideoStatus[]

/**
 * Statische Uebergangstabelle (beide Skript-Gate-Pfade enthalten; die Konfiguration
 * entscheidet in den Guards). `failed` und `paused_budget` zeigen auf die moeglichen
 * Wiederaufnahme-Ziele; das konkrete Ziel ist `resume_status`.
 */
export const TRANSITIONS: Readonly<Record<VideoStatus, readonly VideoStatus[]>> = {
  idea: ['scripting', 'paused_budget'],
  scripting: ['script_ready', 'failed', 'paused_budget'],
  script_ready: ['awaiting_script_approval', 'rendering'],
  awaiting_script_approval: ['rendering', 'scripting', 'rejected'],
  rendering: ['awaiting_review', 'failed', 'paused_budget'],
  awaiting_review: ['scheduled', 'rejected'],
  rejected: ['scripting', 'rendering'],
  scheduled: ['uploading', 'awaiting_review'],
  uploading: ['uploaded', 'partially_uploaded', 'failed'],
  partially_uploaded: ['uploading', 'uploaded'],
  uploaded: [],
  failed: [...RESUMABLE_STATUSES],
  paused_budget: [...PAUSABLE_STATUSES]
}

/** Endzustand ohne weitere Uebergaenge. `rejected` erlaubt nur bewusstes Neu-Starten. */
export const TERMINAL_STATUSES = ['uploaded'] as const satisfies readonly VideoStatus[]

export class InvalidTransitionError extends Error {
  constructor(public readonly from: VideoStatus, public readonly to: VideoStatus, reason?: string) {
    super(`Ungueltiger Video-Uebergang ${from} -> ${to}${reason ? `: ${reason}` : ''}`)
    this.name = 'InvalidTransitionError'
  }
}

export interface TransitionContext {
  status: VideoStatus
  resumeStatus: VideoStatus | null
  /** project.script_approval_required */
  scriptApprovalRequired: boolean
}

export interface TransitionOptions {
  /** Kostenbestaetigung fuer (Neu-)Rendern aus rejected/failed. */
  confirmedCost?: boolean
}

export interface TransitionResult {
  from: VideoStatus
  to: VideoStatus
  /** Neuer Wert fuer video.resume_status (null = leeren). */
  resumeStatus: VideoStatus | null
  /** attempts auf 0 setzen (manueller Retry aus failed). */
  resetAttempts: boolean
  /** Skript wurde freigegeben (awaiting_script_approval -> rendering). */
  scriptApproved: boolean
}

export function isVideoStatus(v: unknown): v is VideoStatus {
  return typeof v === 'string' && (VIDEO_STATUSES as readonly string[]).includes(v)
}

export function isTerminal(status: VideoStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Reine Tabellenpruefung ohne Kontext (Gate/resume). */
export function isAllowedByTable(from: VideoStatus, to: VideoStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** Guard: Skript-Gate. Gate an -> nur ueber awaiting_script_approval, Gate aus -> direkt rendering. */
export function guardScriptGate(from: VideoStatus, to: VideoStatus, scriptApprovalRequired: boolean): string | null {
  if (from !== 'script_ready') return null
  if (to === 'awaiting_script_approval' && !scriptApprovalRequired) return 'Skript-Freigabe ist fuer das Projekt deaktiviert (Gate aus)'
  if (to === 'rendering' && scriptApprovalRequired) return 'Skript-Freigabe ist aktiv, Gate muss durchlaufen werden'
  return null
}

/** Guard: Wiederaufnahme nur in den gemerkten resume_status. */
export function guardResume(ctx: Pick<TransitionContext, 'status' | 'resumeStatus'>, to: VideoStatus): string | null {
  if (ctx.status !== 'failed' && ctx.status !== 'paused_budget') return null
  if (!ctx.resumeStatus) return 'resume_status fehlt'
  if (ctx.resumeStatus !== to) return `Wiederaufnahme nur nach ${ctx.resumeStatus}`
  return null
}

/** Guard: kostenpflichtiges Rendern aus rejected/failed braucht Bestaetigung. */
export function guardCostConfirmation(from: VideoStatus, to: VideoStatus, confirmedCost: boolean): string | null {
  if (to === 'rendering' && (from === 'rejected' || from === 'failed') && !confirmedCost) {
    return 'Neu-Rendern ist kostenpflichtig und braucht eine Bestaetigung'
  }
  return null
}

/** Guard: pausieren/fehlschlagen nur aus Zustaenden, die danach fortsetzbar sind. */
export function guardResumable(from: VideoStatus, to: VideoStatus): string | null {
  if (to === 'failed' && from === 'scripting') return null
  if ((to === 'paused_budget' || to === 'failed') && !(RESUMABLE_STATUSES as readonly string[]).includes(from)) {
    return `${from} kann nicht nach ${to} wechseln`
  }
  return null
}

/** Liefert den Ablehnungsgrund oder null, wenn der Uebergang zulaessig ist. */
export function checkTransition(ctx: TransitionContext, to: VideoStatus, opts: TransitionOptions = {}): string | null {
  if (!isAllowedByTable(ctx.status, to)) return 'nicht in der Uebergangstabelle'
  return guardScriptGate(ctx.status, to, ctx.scriptApprovalRequired)
    ?? guardResumable(ctx.status, to)
    ?? guardResume(ctx, to)
    ?? guardCostConfirmation(ctx.status, to, opts.confirmedCost ?? false)
}

export function canTransition(ctx: TransitionContext, to: VideoStatus, opts: TransitionOptions = {}): boolean {
  return checkTransition(ctx, to, opts) === null
}

/** Alle im Kontext (Gate, resume_status) erlaubten Folgezustaende. */
export function allowedTransitions(ctx: TransitionContext, opts: TransitionOptions = {}): VideoStatus[] {
  return TRANSITIONS[ctx.status].filter(to => canTransition(ctx, to, opts))
}

/**
 * Berechnet den Folgezustand (inkl. resume_status-Pflege) oder wirft InvalidTransitionError.
 * - Wechsel nach failed/paused_budget: resume_status = bisheriger Zustand.
 * - Wiederaufnahme aus failed/paused_budget: resume_status wird geleert; aus failed attempts zuruecksetzen.
 * - Sonst bleibt resume_status unveraendert.
 */
export function transition(ctx: TransitionContext, to: VideoStatus, opts: TransitionOptions = {}): TransitionResult {
  const reason = checkTransition(ctx, to, opts)
  if (reason) throw new InvalidTransitionError(ctx.status, to, reason)

  const entersHold = to === 'failed' || to === 'paused_budget'
  const leavesHold = ctx.status === 'failed' || ctx.status === 'paused_budget'
  return {
    from: ctx.status,
    to,
    resumeStatus: entersHold ? ctx.status : leavesHold ? null : ctx.resumeStatus,
    resetAttempts: ctx.status === 'failed',
    scriptApproved: ctx.status === 'awaiting_script_approval' && to === 'rendering'
  }
}
