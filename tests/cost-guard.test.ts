import { beforeEach, describe, expect, it } from 'vitest'
import {
  BudgetExceededError,
  CostReservationError,
  createCostGuard,
  dayWindow,
  monthWindow,
  type CostAlertEvent,
  type CostEntryRecord,
  type CostGuardRepo,
  type CostTx,
  type GlobalBudget,
  type ProjectBudget
} from '../server/domain/cost-guard'
import { createManualClock } from './helpers/clock'

/** In-Memory-Repo; Transaktionen werden per Mutex serialisiert (simuliert FOR UPDATE). */
export function createMemoryCostRepo() {
  const projects = new Map<string, ProjectBudget>()
  const entries = new Map<string, CostEntryRecord>()
  let global: GlobalBudget = { monthlyLimitCents: 15000, timezone: 'Europe/Berlin' }
  let seq = 0
  let chain: Promise<unknown> = Promise.resolve()

  const tx: CostTx = {
    async lockProject(id) { return projects.get(id) },
    async lockGlobal() { return global },
    async sumActiveCents({ projectId, from, to }) {
      let s = 0
      for (const e of entries.values()) {
        if (e.status === 'released') continue
        if (projectId && e.projectId !== projectId) continue
        if (e.at >= from && e.at < to) s += e.amountCents
      }
      return s
    },
    async insert(e) {
      const rec: CostEntryRecord = {
        id: `c${++seq}`, projectId: e.projectId, videoId: e.videoId, provider: e.provider, operation: e.operation,
        amountCents: e.amountCents, status: 'reserved', estimated: e.estimated, reservationExpiresAt: e.reservationExpiresAt, at: e.at
      }
      entries.set(rec.id, rec)
      return { ...rec }
    },
    async getForUpdate(id) { const e = entries.get(id); return e && { ...e } },
    async update(id, patch) { Object.assign(entries.get(id)!, patch) },
    async listExpired(now, limit) {
      return [...entries.values()].filter(e => e.status === 'reserved' && e.reservationExpiresAt && e.reservationExpiresAt < now).slice(0, limit).map(e => ({ ...e }))
    }
  }

  const repo: CostGuardRepo = {
    transaction<T>(fn: (t: CostTx) => Promise<T>) {
      const run = chain.then(async () => {
        // Rollback-Semantik: Snapshot, bei Fehler zuruecksetzen
        const snap = new Map([...entries].map(([k, v]) => [k, { ...v }]))
        try { return await fn(tx) } catch (err) {
          entries.clear(); for (const [k, v] of snap) entries.set(k, v)
          throw err
        }
      })
      chain = run.catch(() => {})
      return run
    }
  }
  return {
    repo,
    entries,
    addProject(id: string, b: Partial<ProjectBudget> = {}) {
      projects.set(id, { dailyBudgetCents: 300, monthlyBudgetCents: 6000, timezone: 'Europe/Berlin', ...b })
    },
    setGlobal(g: Partial<GlobalBudget>) { global = { ...global, ...g } }
  }
}

describe('Zeitfenster', () => {
  it('Tagesgrenze in Projektzeitzone (Berlin, Winter)', () => {
    // 2026-01-15 23:30Z = 16.01. 00:30 Berlin
    const w = dayWindow(new Date('2026-01-15T23:30:00Z'), 'Europe/Berlin')
    expect(w.from.toISOString()).toBe('2026-01-15T23:00:00.000Z')
    expect(w.to.toISOString()).toBe('2026-01-16T23:00:00.000Z')
  })
  it('Sommerzeit: Monatsfenster Berlin Juli', () => {
    const w = monthWindow(new Date('2026-07-10T12:00:00Z'), 'Europe/Berlin')
    expect(w.from.toISOString()).toBe('2026-06-30T22:00:00.000Z')
    expect(w.to.toISOString()).toBe('2026-07-31T22:00:00.000Z')
  })
  it('DST-Umstellung: Tag hat 23 Stunden (30.03.2026)', () => {
    const w = dayWindow(new Date('2026-03-29T10:00:00Z'), 'Europe/Berlin')
    expect(w.to.getTime() - w.from.getTime()).toBe(23 * 3600_000)
  })
  it('Zeitzone mit negativem Offset (New York)', () => {
    const w = dayWindow(new Date('2026-01-15T03:00:00Z'), 'America/New_York')
    expect(w.from.toISOString()).toBe('2026-01-14T05:00:00.000Z')
  })
})

describe('CostGuard (In-Memory)', () => {
  let mem: ReturnType<typeof createMemoryCostRepo>
  let clock: ReturnType<typeof createManualClock>
  let alerts: CostAlertEvent[]
  let guard: ReturnType<typeof createCostGuard>
  const P = 'p1'

  beforeEach(() => {
    mem = createMemoryCostRepo()
    mem.addProject(P)
    mem.addProject('p2')
    clock = createManualClock('2026-03-10T10:00:00Z')
    alerts = []
    guard = createCostGuard({ repo: mem.repo, now: clock.now, hook: { onAlert: (e) => { alerts.push(e) } } })
  })
  const res = (cents: number, projectId: string | null = P) =>
    guard.reserve({ projectId, provider: 'deepseek', operation: 'llm', estimateCents: cents })

  it('exakt am Tageslimit erlaubt, 1 Cent darueber blockiert (day)', async () => {
    await res(300)
    await expect(res(1)).rejects.toMatchObject({ name: 'BudgetExceededError', reason: 'day', limitCents: 300, usedCents: 300 })
  })

  it('Monatslimit greift nach mehreren Tagen (month)', async () => {
    for (let d = 0; d < 20; d++) { // 20 Tage * 300 = 6000
      await res(300)
      clock.advance(24 * 3600_000)
    }
    // 30.03.: Monat Maerz hat 6000 verbraucht? Tage 10..29 = 20 Eintraege -> 6000
    const err = await res(1).catch(e => e)
    expect(err).toBeInstanceOf(BudgetExceededError)
    expect(err.reason).toBe('month')
  })

  it('Tagesgrenze: neuer Tag nach lokaler Mitternacht, nicht nach UTC-Mitternacht', async () => {
    clock.set('2026-01-15T22:30:00Z') // 23:30 Berlin
    await res(300)
    clock.set('2026-01-15T23:30:00Z') // 00:30 Berlin, naechster Tag
    await expect(res(300)).resolves.toBeTruthy()
    clock.set('2026-01-16T22:30:00Z') // 23:30 Berlin (16.01.), noch derselbe Tag wie 00:30
    await expect(res(1)).rejects.toMatchObject({ reason: 'day' })
  })

  it('Tagesgrenze in anderer Projektzeitzone (Tokyo)', async () => {
    mem.addProject('tokyo', { timezone: 'Asia/Tokyo' })
    clock.set('2026-01-15T14:30:00Z') // 23:30 Tokyo
    await res(300, 'tokyo')
    clock.set('2026-01-15T15:30:00Z') // 00:30 Tokyo naechster Tag
    await expect(res(300, 'tokyo')).resolves.toBeTruthy()
  })

  it('Monatswechsel setzt Monatssumme zurueck', async () => {
    clock.set('2026-03-31T10:00:00Z')
    mem.addProject('m', { dailyBudgetCents: 10000, monthlyBudgetCents: 1000 })
    await res(1000, 'm')
    await expect(res(1, 'm')).rejects.toMatchObject({ reason: 'month' })
    clock.set('2026-04-01T10:00:00Z')
    await expect(res(1000, 'm')).resolves.toBeTruthy()
  })

  it('globales Limit greift vor Projektlimit', async () => {
    mem.setGlobal({ monthlyLimitCents: 400 })
    await res(300)
    // p2 hat selbst Spielraum, global nur 100 uebrig
    await expect(res(200, 'p2')).rejects.toMatchObject({ reason: 'global', limitCents: 400, usedCents: 300 })
  })

  it('Projektsumme ueber Limit blockiert trotz globalem Spielraum', async () => {
    await res(300)
    await expect(res(1)).rejects.toMatchObject({ reason: 'day' })
  })

  it('Reihenfolge: day vor month vor global', async () => {
    mem.addProject('o', { dailyBudgetCents: 10, monthlyBudgetCents: 10 })
    mem.setGlobal({ monthlyLimitCents: 10 })
    await expect(res(11, 'o')).rejects.toMatchObject({ reason: 'day' })
    mem.addProject('o2', { dailyBudgetCents: 100, monthlyBudgetCents: 10 })
    await expect(res(11, 'o2')).rejects.toMatchObject({ reason: 'month' })
  })

  it('globaler Posten (projectId null) zaehlt nur gegen globales Limit und in dessen Summe', async () => {
    mem.setGlobal({ monthlyLimitCents: 500 })
    await res(300, null)
    await res(200, 'p2')
    await expect(res(1, null)).rejects.toMatchObject({ reason: 'global' })
  })

  it('release gibt Budget frei und ist idempotent', async () => {
    const r = await res(300)
    await expect(res(1)).rejects.toBeInstanceOf(BudgetExceededError)
    await guard.release(r.id)
    await guard.release(r.id)
    await expect(res(300)).resolves.toBeTruthy()
  })

  it('commit setzt reale Kosten; Differenz wird frei bzw. belegt', async () => {
    const r = await res(200)
    const c = await guard.commit(r.id, 50)
    expect(c.amountCents).toBe(50)
    expect(mem.entries.get(r.id)).toMatchObject({ status: 'committed', amountCents: 50, estimated: false, reservationExpiresAt: null })
    await expect(res(250)).resolves.toBeTruthy()
  })

  it('commit mit Ist ueber Limit blockiert nicht (Kosten sind entstanden)', async () => {
    const r = await res(300)
    await expect(guard.commit(r.id, 350)).resolves.toMatchObject({ amountCents: 350 })
  })

  it('commit ist idempotent (Retry zaehlt Kosten genau einmal)', async () => {
    const r = await res(100)
    await guard.commit(r.id, 80)
    await guard.commit(r.id, 80)
    await guard.commit(r.id, 999)
    expect([...mem.entries.values()].filter(e => e.status === 'committed')).toHaveLength(1)
    expect(mem.entries.get(r.id)!.amountCents).toBe(80)
  })

  it('commit mit estimated-Flag', async () => {
    const r = await res(100)
    await guard.commit(r.id, 100, { estimated: true })
    expect(mem.entries.get(r.id)!.estimated).toBe(true)
  })

  it('Zustandsfehler: release nach commit, commit nach release, unbekannte ID', async () => {
    const a = await res(10)
    await guard.commit(a.id, 10)
    await expect(guard.release(a.id)).rejects.toBeInstanceOf(CostReservationError)
    const b = await res(10)
    await guard.release(b.id)
    await expect(guard.commit(b.id, 10)).rejects.toBeInstanceOf(CostReservationError)
    await expect(guard.commit('nope', 1)).rejects.toBeInstanceOf(CostReservationError)
  })

  it('Eingabevalidierung: nur nicht-negative Integer-Cent', async () => {
    await expect(res(-1)).rejects.toBeInstanceOf(RangeError)
    await expect(res(1.5)).rejects.toBeInstanceOf(RangeError)
    const r = await res(1)
    await expect(guard.commit(r.id, 0.5)).rejects.toBeInstanceOf(RangeError)
  })

  it('unbekanntes Projekt wirft', async () => {
    await expect(res(1, 'ghost')).rejects.toThrow(/not found/)
  })

  it('fehlgeschlagene Reservierung hinterlaesst keinen Eintrag', async () => {
    await expect(res(301)).rejects.toBeInstanceOf(BudgetExceededError)
    expect(mem.entries.size).toBe(0)
  })

  describe('Reaper', () => {
    it('gibt abgelaufene Reservierungen frei, laufende nicht', async () => {
      const old = await guard.reserve({ projectId: P, provider: 'x', operation: 'llm', estimateCents: 100, ttlMs: 60_000 })
      const live = await guard.reserve({ projectId: P, provider: 'x', operation: 'llm', estimateCents: 100, ttlMs: 3600_000 })
      clock.advance(120_000)
      expect(await guard.reapExpired()).toEqual({ released: 1, committedEstimated: 0 })
      expect(mem.entries.get(old.id)!.status).toBe('released')
      expect(mem.entries.get(live.id)!.status).toBe('reserved')
      await expect(res(200)).resolves.toBeTruthy() // 100 freigegeben
    })

    it('committed bereits abgesendete Render-Calls mit Schaetzwert', async () => {
      const r = await guard.reserve({ projectId: P, provider: 'heygen', operation: 'render', estimateCents: 120, ttlMs: 1000 })
      clock.advance(5000)
      expect(await guard.reapExpired({ commitEstimatedOperations: ['render'] })).toEqual({ released: 0, committedEstimated: 1 })
      expect(mem.entries.get(r.id)).toMatchObject({ status: 'committed', estimated: true, amountCents: 120 })
      await expect(res(200)).rejects.toMatchObject({ reason: 'day' }) // 120 bleiben belegt
    })

    it('committed/released-Eintraege werden nicht angefasst', async () => {
      const r = await guard.reserve({ projectId: P, provider: 'x', operation: 'llm', estimateCents: 10, ttlMs: 1 })
      await guard.commit(r.id, 10)
      clock.advance(10_000)
      expect(await guard.reapExpired()).toEqual({ released: 0, committedEstimated: 0 })
    })
  })

  describe('parallele Reservierungen', () => {
    it('nie mehr als das Limit reserviert', async () => {
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => res(100)))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3)
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(rejected).toHaveLength(7)
      expect(rejected.every(r => r.reason instanceof BudgetExceededError)).toBe(true)
    })

    it('globales Limit gilt ueber Projekte hinweg', async () => {
      mem.setGlobal({ monthlyLimitCents: 500 })
      const results = await Promise.allSettled([...Array(5)].flatMap(() => [res(100, P), res(100, 'p2')]))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5)
    })
  })

  describe('80-%-Alarm', () => {
    it('liefert Alarm genau beim Ueberschreiten von 80 % (Tag, Monat, global getrennt)', async () => {
      await res(200) // 66 %
      expect(alerts).toHaveLength(0)
      const r = await res(40) // 240/300 = 80 % exakt
      expect(alerts.filter(a => a.scope === 'day')).toEqual([
        expect.objectContaining({ scope: 'day', threshold: 80, usedCents: 240, limitCents: 300, projectId: P })
      ])
      expect(r.alerts.map(a => a.scope)).toEqual(['day'])
      await res(10) // bereits darueber: kein zweiter 80-%-Alarm
      expect(alerts.filter(a => a.scope === 'day' && a.threshold === 80)).toHaveLength(1)
    })

    it('100 % wird gemeldet, globale Schwelle separat', async () => {
      mem.setGlobal({ monthlyLimitCents: 1000 })
      await res(300)
      await res(300, 'p2')
      mem.addProject('p3')
      await res(200, 'p3') // global 800 -> 80 %
      expect(alerts.some(a => a.scope === 'global' && a.threshold === 80 && a.projectId === 'p3')).toBe(true)
      expect(alerts.some(a => a.scope === 'day' && a.threshold === 100 && a.usedCents === 300)).toBe(true)
    })

    it('commit mit hoeherem Ist-Wert kann Alarm ausloesen', async () => {
      const r = await res(100)
      await guard.commit(r.id, 250) // 83 %
      expect(alerts.some(a => a.scope === 'day' && a.threshold === 80)).toBe(true)
    })

    it('kein Alarm bei abgelehnter Reservierung; Hook-Fehler kippt Buchung nicht', async () => {
      await expect(res(301)).rejects.toBeInstanceOf(BudgetExceededError)
      expect(alerts).toHaveLength(0)
      const g = createCostGuard({ repo: mem.repo, now: clock.now, hook: { onAlert: () => { throw new Error('boom') } } })
      await expect(g.reserve({ projectId: P, provider: 'x', operation: 'llm', estimateCents: 290 })).resolves.toBeTruthy()
    })
  })

  it('BudgetExceededError traegt Grund und Zahlen', async () => {
    await res(300)
    const err = await res(5).catch(e => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).toMatchObject({ reason: 'day', requestedCents: 5, projectId: P, name: 'BudgetExceededError' })
  })
})
