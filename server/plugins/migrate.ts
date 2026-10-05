import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

export default defineNitroPlugin(async () => {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.warn('[migrate] DATABASE_URL not set, skipping migrations')
    return
  }
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' })
    console.log('[migrate] migrations applied')
  } catch (error) {
    console.error('[migrate] migration failed', error)
    throw error
  } finally {
    await client.end()
  }
})
