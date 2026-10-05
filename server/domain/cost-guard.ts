import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { schema, useDb } from '../db'

/**
 * CostGuard (WP1.4): Vorab-Reservierung vor kostenpflichtigen Aufrufen.
 * Alle Geldbetraege der API sind Integer-Cent (USD). In cost_entry steht micro-USD (1 Cent = 10_000).
 */

export const MICRO_USD_PER_CENT = 10_000
export const DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS = 15000
export const DEFAULT_OPERATOR_TIMEZONE = 'Europe/Berlin'
export const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000
export const ALERT_THRESHOLDS = [80, 100] as const

export const GLOBAL_BUDGET_SETTING_KEY = 'global_monthly_budget_cents'
export const OPERATOR_TIMEZONE_SETTING_KEY = 'operator_timezone'

export type BudgetScope = 'day' | 'month' | 'global'

export class BudgetExceededError extends Error {
  constructor(
    public readonly reason: BudgetScope,
    public readonly limitCents: number,
    public readonly usedCents: number,
    public readonly requestedCents: number,
    public readonly projectId: string | null
  ) {
    super(`Budget exceeded (${reason}): used ${usedCents} + requested ${requestedCents} > limit ${limitCents} cents`)
    this.name = 'BudgetExceededError'
  }
}

export class CostReservationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostReservationError'
  }
}

export interface CostAlertEvent {
  scope: BudgetScope
  projectId: string | null
  /** Ueberschrittene Schwelle in Prozent (80 oder 100). */
  threshold: number
  usedCents: number
  limitCents: number
  windowStart: Date
  windowEnd: Date
}

/** Hook-Interface; der Notification-Service (WP1.10) implementiert es. */
export interface CostAlertHook {
  onAlert(event: CostAlertEvent): void | Promise<void>
}

export type CostStatus = 'reserved' | 'committed' | 'released'

export interface CostEntryRecord {
  id: string
  projectId: string | null
  videoId: string | null
  provider: string
  operation: string
  amountCents: number
  status: CostStatus
  estimated: boolean
  reservationExpiresAt: Date | null
  at: Date
}

export interface ProjectBudget {
  dailyBudgetCents: number
  monthlyBudgetCents: number
  timezone: string
}

export interface GlobalBudget {
  monthlyLimitCents: number
  timezone: string
}

export interface NewCostEntry {
  projectId: string | null
  videoId: string | null
  provider: string
  operation: string
  amountCents: number
  units: number | null
  estimated: boolean
  reservationExpiresAt: Date
  at: Date
}

/** Operationen innerhalb einer Transaktion (Projekt- und globale Zeile sind gesperrt, sofern gelockt). */
export interface CostTx {
  lockProject(projectId: string): Promise<ProjectBudget | undefined>
  lockGlobal(): Promise<GlobalBudget>
  /** Summe reserved+committed; ohne projectId ueber alle Posten (inkl. globaler). */
  sumActiveCents(q: { projectId?: string, from: Date, to: Date }): Promise<number>
  insert(e: NewCostEntry): Promise<CostEntryRecord>
  getForUpdate(id: string): Promise<CostEntryRecord | undefined>
  update(id: string, patch: Partial<Pick<CostEntryRecord, 'status' | 'amountCents' | 'estimated' | 'reservationExpiresAt'>>): Promise<void>
  listExpired(now: Date, limit: number): Promise<CostEntryRecord[]>
}

export interface CostGuardRepo {
  transaction<T>(fn: (tx: CostTx) => Promise<T>): Promise<T>
}

// ---------- Zeitzonen-Fenster ----------

function tzParts(ts: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
  })
  const o: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(ts))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  return o as { year: number, month: number, day: number, hour: number, minute: number, second: number }
}

function tzOffsetMs(ts: number, tz: string): number {
  const p = tzParts(ts, tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000
}

/** Lokale Mitternacht (y-m-d 00:00 in tz) als UTC-Instant; Monats-/Tagesueberlauf wird von Date.UTC normalisiert. */
function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d)
  let t = guess - tzOffsetMs(guess, tz)
  t = guess - tzOffsetMs(t, tz)
  return new Date(t)
}

export function dayWindow(now: Date, tz: string): { from: Date, to: Date } {
  const p = tzParts(now.getTime(), tz)
  return { from: zonedMidnight(p.year, p.month, p.day, tz), to: zonedMidnight(p.year, p.month, p.day + 1, tz) }
}

export function monthWindow(now: Date, tz: string): { from: Date, to: Date } {
  const p = tzParts(now.getTime(), tz)
  return { from: zonedMidnight(p.year, p.month, 1, tz), to: zonedMidnight(p.year, p.month + 1, 1, tz) }
}

// ---------- Guard ----------

export interface ReserveInput {
  /** NULL = globaler Posten (nur globales Limit wird geprueft). */
  projectId: string | null
  videoId?: string | null
  provider: string
  operation: string
  estimateCents: number
  units?: number | null
  ttlMs?: number
}

export interface Reservation {
  id: string
  amountCents: number
  expiresAt: Date
  alerts: CostAlertEvent[]
}

export interface CommitResult {
  id: string
  amountCents: number
  alerts: CostAlertEvent[]
}

export interface CostGuardDeps {
  repo: CostGuardRepo
  now?: () => Date
  hook?: CostAlertHook
  defaultTtlMs?: number
}

function assertCents(v: number, name: string) {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} must be a non-negative integer (cents), got ${v}`)
}

function crossings(scope: BudgetScope, projectId: string | null, before: number, after: number, limit: number, win: { from: Date, to: Date }): CostAlertEvent[] {
  if (limit <= 0) return []
  const out: CostAlertEvent[] = []
  for (const t of ALERT_THRESHOLDS) {
    if (before * 100 < t * limit && after * 100 >= t * limit) {
      out.push({ scope, projectId, threshold: t, usedCents: after, limitCents: limit, windowStart: win.from, windowEnd: win.to })
    }
  }
  return out
}

export function createCostGuard(deps: CostGuardDeps) {
  const { repo, hook } = deps
  const now = deps.now ?? (() => new Date())
  const defaultTtl = deps.defaultTtlMs ?? DEFAULT_RESERVATION_TTL_MS

  async function emit(alerts: CostAlertEvent[]) {
    if (!hook) return
    for (const a of alerts) {
      try { await hook.onAlert(a) } catch { /* Alarm darf Buchung nicht kippen */ }
    }
  }

  /** Schwellen-Alarme fuer eine Aenderung der Summe von before auf after (delta wirkt in allen betroffenen Fenstern). */
  async function windowsFor(tx: CostTx, projectId: string | null, at: Date) {
    const g = await tx.lockGlobal()
    const gw = monthWindow(at, g.timezone)
    const out: { scope: BudgetScope, limit: number, win: { from: Date, to: Date }, used: number }[] = []
    if (projectId) {
      const p = await tx.lockProject(projectId)
      if (!p) throw new Error(`Project ${projectId} not found`)
      const dw = dayWindow(at, p.timezone)
      const mw = monthWindow(at, p.timezone)
      out.push({ scope: 'day', limit: p.dailyBudgetCents, win: dw, used: await tx.sumActiveCents({ projectId, ...dw }) })
      out.push({ scope: 'month', limit: p.monthlyBudgetCents, win: mw, used: await tx.sumActiveCents({ projectId, ...mw }) })
    }
    out.push({ scope: 'global', limit: g.monthlyLimitCents, win: gw, used: await tx.sumActiveCents({ ...gw }) })
    return out
  }

  return {
    /**
     * Reserviert `estimateCents` atomar. Reihenfolge: Projekt-Tag, Projekt-Monat, global-Monat.
     * Exakt am Limit ist erlaubt (used + estimate <= limit). Wirft BudgetExceededError.
     */
    async reserve(input: ReserveInput): Promise<Reservation> {
      assertCents(input.estimateCents, 'estimateCents')
      const at = now()
      const expiresAt = new Date(at.getTime() + (input.ttlMs ?? defaultTtl))
      const result = await repo.transaction(async (tx) => {
        const ws = await windowsFor(tx, input.projectId, at)
        const alerts: CostAlertEvent[] = []
        for (const w of ws) {
          if (w.used + input.estimateCents > w.limit) {
            throw new BudgetExceededError(w.scope, w.limit, w.used, input.estimateCents, input.projectId)
          }
          alerts.push(...crossings(w.scope, input.projectId, w.used, w.used + input.estimateCents, w.limit, w.win))
        }
        const e = await tx.insert({
          projectId: input.projectId,
          videoId: input.videoId ?? null,
          provider: input.provider,
          operation: input.operation,
          amountCents: input.estimateCents,
          units: input.units ?? null,
          estimated: true,
          reservationExpiresAt: expiresAt,
          at
        })
        return { id: e.id, amountCents: e.amountCents, expiresAt, alerts }
      })
      await emit(result.alerts)
      return result
    },

    /** Verbucht reale Kosten. Idempotent bei bereits committed (Retry zaehlt einmal). Ueberschreitung blockiert nicht, loest aber Alarm aus. */
    async commit(reservationId: string, actualCents: number, opts: { estimated?: boolean } = {}): Promise<CommitResult> {
      assertCents(actualCents, 'actualCents')
      const result = await repo.transaction(async (tx) => {
        const cur = await tx.getForUpdate(reservationId)
        if (!cur) throw new CostReservationError(`Reservation ${reservationId} not found`)
        if (cur.status === 'committed') return { id: cur.id, amountCents: cur.amountCents, alerts: [] as CostAlertEvent[] }
        if (cur.status === 'released') throw new CostReservationError(`Reservation ${reservationId} was released`)
        const ws = await windowsFor(tx, cur.projectId, cur.at)
        const alerts: CostAlertEvent[] = []
        for (const w of ws) {
          alerts.push(...crossings(w.scope, cur.projectId, w.used, w.used - cur.amountCents + actualCents, w.limit, w.win))
        }
        await tx.update(cur.id, { status: 'committed', amountCents: actualCents, estimated: opts.estimated ?? false, reservationExpiresAt: null })
        return { id: cur.id, amountCents: actualCents, alerts }
      })
      await emit(result.alerts)
      return result
    },

    /** Gibt eine Reservierung frei (Fehler/Abbruch vor dem Call). Idempotent; committed kann nicht freigegeben werden. */
    async release(reservationId: string): Promise<void> {
      await repo.transaction(async (tx) => {
        const cur = await tx.getForUpdate(reservationId)
        if (!cur) throw new CostReservationError(`Reservation ${reservationId} not found`)
        if (cur.status === 'released') return
        if (cur.status === 'committed') throw new CostReservationError(`Reservation ${reservationId} is already committed`)
        await tx.update(cur.id, { status: 'released', reservationExpiresAt: null })
      })
    },

    /**
     * Reaper: gibt abgelaufene Reservierungen frei. Operationen in `commitEstimatedOperations`
     * (bereits abgesendete Render-Calls) werden stattdessen mit Schaetzwert als committed+estimated verbucht.
     */
    async reapExpired(opts: { commitEstimatedOperations?: string[], batchSize?: number } = {}): Promise<{ released: number, committedEstimated: number }> {
      const est = new Set(opts.commitEstimatedOperations ?? [])
      return repo.transaction(async (tx) => {
        const expired = await tx.listExpired(now(), opts.batchSize ?? 500)
        let released = 0
        let committedEstimated = 0
        for (const e of expired) {
          if (est.has(e.operation)) {
            await tx.update(e.id, { status: 'committed', estimated: true, reservationExpiresAt: null })
            committedEstimated++
          } else {
            await tx.update(e.id, { status: 'released', reservationExpiresAt: null })
            released++
          }
        }
        return { released, committedEstimated }
      })
    }
  }
}

export type CostGuard = ReturnType<typeof createCostGuard>

// ---------- Drizzle-Repo ----------

type Db = PostgresJsDatabase<typeof schema>

const toMicro = (cents: number) => cents * MICRO_USD_PER_CENT
const toCents = (micro: number) => Math.ceil(micro / MICRO_USD_PER_CENT)

function rowToRecord(r: typeof schema.costEntry.$inferSelect): CostEntryRecord {
  return {
    id: r.id,
    projectId: r.projectId,
    videoId: r.videoId,
    provider: r.provider,
    operation: r.operation,
    amountCents: toCents(r.amountMicroUsd),
    status: r.status as CostStatus,
    estimated: r.estimated,
    reservationExpiresAt: r.reservationExpiresAt,
    at: r.at
  }
}

export function createDrizzleCostRepo(db: Db): CostGuardRepo {
  const ce = schema.costEntry
  return {
    transaction(fn) {
      return db.transaction(async (t) => {
        const tx: CostTx = {
          async lockProject(projectId) {
            const [r] = await t.select({
              d: schema.project.dailyBudgetCents,
              m: schema.project.monthlyBudgetCents,
              tz: schema.project.timezone
            }).from(schema.project).where(eq(schema.project.id, projectId)).for('update')
            return r ? { dailyBudgetCents: r.d, monthlyBudgetCents: r.m, timezone: r.tz } : undefined
          },
          async lockGlobal() {
            const a = schema.appSetting
            await t.insert(a).values({ key: GLOBAL_BUDGET_SETTING_KEY, value: DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS }).onConflictDoNothing({ target: a.key })
            const [g] = await t.select().from(a).where(eq(a.key, GLOBAL_BUDGET_SETTING_KEY)).for('update')
            const [tzRow] = await t.select().from(a).where(eq(a.key, OPERATOR_TIMEZONE_SETTING_KEY))
            const limit = Number(g?.value)
            return {
              monthlyLimitCents: Number.isFinite(limit) && limit >= 0 ? Math.trunc(limit) : DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS,
              timezone: typeof tzRow?.value === 'string' ? tzRow.value : DEFAULT_OPERATOR_TIMEZONE
            }
          },
          async sumActiveCents({ projectId, from, to }) {
            const [r] = await t.select({ total: sql<string>`coalesce(sum(${ce.amountMicroUsd}), 0)` }).from(ce).where(and(
              projectId ? eq(ce.projectId, projectId) : undefined,
              inArray(ce.status, ['reserved', 'committed']),
              gte(ce.at, from),
              lt(ce.at, to)
            ))
            return toCents(Number(r?.total ?? 0))
          },
          async insert(e) {
            const [r] = await t.insert(ce).values({
              projectId: e.projectId,
              videoId: e.videoId,
              provider: e.provider,
              operation: e.operation,
              amountMicroUsd: toMicro(e.amountCents),
              units: e.units,
              status: 'reserved',
              reservationExpiresAt: e.reservationExpiresAt,
              estimated: e.estimated,
              at: e.at
            }).returning()
            return rowToRecord(r!)
          },
          async getForUpdate(id) {
            const [r] = await t.select().from(ce).where(eq(ce.id, id)).for('update')
            return r ? rowToRecord(r) : undefined
          },
          async update(id, patch) {
            await t.update(ce).set({
              ...(patch.status !== undefined && { status: patch.status }),
              ...(patch.amountCents !== undefined && { amountMicroUsd: toMicro(patch.amountCents) }),
              ...(patch.estimated !== undefined && { estimated: patch.estimated }),
              ...(patch.reservationExpiresAt !== undefined && { reservationExpiresAt: patch.reservationExpiresAt })
            }).where(eq(ce.id, id))
          },
          async listExpired(now, limit) {
            const rows = await t.select().from(ce)
              .where(and(eq(ce.status, 'reserved'), lt(ce.reservationExpiresAt, now)))
              .limit(limit).for('update', { skipLocked: true })
            return rows.map(rowToRecord)
          }
        }
        return fn(tx)
      })
    }
  }
}

let _guard: CostGuard | undefined
/** Lazy Singleton auf der Anwendungs-DB; Alarm-Hook wird mit WP1.10 gesetzt. */
export function useCostGuard(hook?: CostAlertHook): CostGuard {
  if (hook) return (_guard = createCostGuard({ repo: createDrizzleCostRepo(useDb()), hook }))
  return (_guard ??= createCostGuard({ repo: createDrizzleCostRepo(useDb()) }))
}
