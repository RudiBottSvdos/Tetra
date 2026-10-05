import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { resolveMigrationsDir } from '../utils/migrations-dir'

// Laeuft als erstes Nitro-Plugin (Praefix 00-), vor 10-boss.
export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('[migrate] DATABASE_URL not set, skipping migrations')
    return
  }
  const migrationsFolder = resolveMigrationsDir({
    explicit: process.env.MIGRATIONS_DIR || useRuntimeConfig().migrationsDir,
    startDir: dirname(fileURLToPath(import.meta.url))
  })
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
    console.log(`[migrate] migrations applied (${migrationsFolder})`)
  } catch (error) {
    console.error('[migrate] migration failed', error)
    throw error
  } finally {
    await client.end()
  }
})
