import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

let _db: ReturnType<typeof createDb> | undefined

function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return drizzle(postgres(url), { schema })
}

// Lazy DB client: connection is created on first use (keeps build and tests DB-free).
export function useDb() {
  return (_db ??= createDb())
}

export { schema }
