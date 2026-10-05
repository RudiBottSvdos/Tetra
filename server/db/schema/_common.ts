import { sql, type SQL } from 'drizzle-orm'
import { check, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export const id = () => uuid('id').primaryKey().defaultRandom()

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
})

/** SQL-Fragment `"col" in ('a','b')` fuer CHECK-Constraints. */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.join(values.map(v => sql.raw(`'${v.replace(/'/g, "''")}'`)), sql`, `)})`
}

/** Wie inList, erlaubt zusaetzlich NULL. */
export function inListOrNull(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} is null or ${inList(column, values)}`
}

export function enumCheck(name: string, column: AnyPgColumn, values: readonly string[]) {
  return check(name, inList(column, values))
}

export function enumCheckNullable(name: string, column: AnyPgColumn, values: readonly string[]) {
  return check(name, inListOrNull(column, values))
}
