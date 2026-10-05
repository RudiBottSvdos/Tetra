import { afterAll, beforeAll, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from '../server/db/schema'
import { BudgetExceededError, createCostGuard, createDrizzleCostRepo, GLOBAL_BUDGET_SETTING_KEY } from '../server/domain/cost-guard'
import { createProject, describeDb, setupTestDb, testDatabaseUrl, type TestDb } from './helpers'

describeDb('CostGuard (Postgres, Rennbedingungen)', () => {
  let t: TestDb
  // eigener Pool mit mehreren Verbindungen, damit Transaktionen wirklich parallel laufen
  let pool: ReturnType<typeof postgres>
  let guard: ReturnType<typeof createCostGuard>

  beforeAll(async () => {
    t = await setupTestDb()
    pool = postgres(testDatabaseUrl!, { max: 10, connection: { search_path: t.schemaName } })
    guard = createCostGuard({ repo: createDrizzleCostRepo(drizzle(pool, { schema })) })
  })
  afterAll(async () => {
    await pool?.end()
    await t?.teardown()
  })

  const reserve = (projectId: string | null, cents: number, operation = 'llm') =>
    guard.reserve({ projectId, provider: 'deepseek', operation, estimateCents: cents })

  it('parallele Reservierungen ueberschreiten das Projekt-Tageslimit nie', async () => {
    const p = await createProject(t.db, { dailyBudgetCents: 300, monthlyBudgetCents: 6000 })
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => reserve(p.id, 100)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3)
    const rej = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rej.every(r => r.reason instanceof BudgetExceededError && r.reason.reason === 'day')).toBe(true)
  })

  it('globales Limit haelt ueber mehrere Projekte bei Parallelitaet', async () => {
    await t.db.insert(schema.appSetting).values({ key: GLOBAL_BUDGET_SETTING_KEY, value: 10000 })
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value: 10000 } })
    // Vorbelegung aus dem vorigen Test (300 Cent) zaehlt mit: 10000 - 300 = 9700 Spielraum
    const a = await createProject(t.db, { dailyBudgetCents: 100000, monthlyBudgetCents: 100000 })
    const b = await createProject(t.db, { dailyBudgetCents: 100000, monthlyBudgetCents: 100000 })
    const calls = Array.from({ length: 40 }, (_, i) => reserve(i % 2 ? a.id : b.id, 500))
    const results = await Promise.allSettled(calls)
    const ok = results.filter(r => r.status === 'fulfilled').length
    expect(ok).toBe(Math.floor(9700 / 500)) // 19
    expect(results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').every(r => r.reason.reason === 'global')).toBe(true)
  })

  it('commit/release/Reaper gegen echte DB, Betraege in micro-USD', async () => {
    const p = await createProject(t.db)
    const r = await guard.reserve({ projectId: p.id, provider: 'heygen', operation: 'render', estimateCents: 120, ttlMs: -1000 })
    const [row] = await t.db.select().from(schema.costEntry).where(eq(schema.costEntry.id, r.id))
    expect(row!.amountMicroUsd).toBe(1_200_000)
    expect(await guard.reapExpired({ commitEstimatedOperations: ['render'] })).toEqual({ released: 0, committedEstimated: 1 })

    const r2 = await reserve(p.id, 50)
    await guard.commit(r2.id, 42)
    await guard.commit(r2.id, 42)
    const [row2] = await t.db.select().from(schema.costEntry).where(eq(schema.costEntry.id, r2.id))
    expect(row2).toMatchObject({ status: 'committed', amountMicroUsd: 420_000, estimated: false })

    const r3 = await reserve(p.id, 10)
    await guard.release(r3.id)
    const [row3] = await t.db.select().from(schema.costEntry).where(eq(schema.costEntry.id, r3.id))
    expect(row3!.status).toBe('released')
  })

  it('Parallel-Commit derselben Reservierung zaehlt einmal', async () => {
    const p = await createProject(t.db)
    const r = await reserve(p.id, 100)
    await Promise.all([guard.commit(r.id, 80), guard.commit(r.id, 80), guard.commit(r.id, 80)])
    const [row] = await t.db.select().from(schema.costEntry).where(eq(schema.costEntry.id, r.id))
    expect(row).toMatchObject({ status: 'committed', amountMicroUsd: 800_000 })
  })
})
