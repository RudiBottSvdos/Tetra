import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '../../server/db/schema'

export const testDatabaseUrl = process.env.TEST_DATABASE_URL
export const dbTestsRequired = process.env.TETRA_REQUIRE_DB === '1'

/**
 * describe fuer DB-Tests: ohne TEST_DATABASE_URL sichtbar uebersprungen (pnpm test),
 * unter `pnpm test:db` (TETRA_REQUIRE_DB=1) schlaegt die Suite stattdessen fehl.
 */
export function describeDb(name: string, fn: () => void) {
  if (testDatabaseUrl) return describe(name, fn)
  if (dbTestsRequired) {
    return describe(name, () => {
      it('requires TEST_DATABASE_URL', () => {
        throw new Error('TEST_DATABASE_URL fehlt (test:db benoetigt eine Postgres)')
      })
    })
  }
  console.warn(`[tests] TEST_DATABASE_URL nicht gesetzt: DB-Suite "${name}" uebersprungen`)
  return describe.skip(name, fn)
}

export interface TestDb {
  db: ReturnType<typeof drizzle<typeof schema>>
  client: ReturnType<typeof postgres>
  schemaName: string
  teardown: () => Promise<void>
}

/** Legt ein temporaeres Schema an, migriert drizzle/ hinein und liefert db + teardown. */
export async function setupTestDb(): Promise<TestDb> {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL nicht gesetzt')
  const schemaName = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = postgres(testDatabaseUrl, { max: 1 })
  await admin.unsafe(`create schema ${schemaName}`)
  await admin.end()
  const client = postgres(testDatabaseUrl, { max: 1, connection: { search_path: schemaName } })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: join(__dirname, '..', '..', 'drizzle'), migrationsSchema: schemaName })
  return {
    db,
    client,
    schemaName,
    async teardown() {
      await client.end()
      const a = postgres(testDatabaseUrl!, { max: 1 })
      await a.unsafe(`drop schema if exists ${schemaName} cascade`)
      await a.end()
    }
  }
}
