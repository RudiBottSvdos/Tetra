import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const JOURNAL = join('meta', '_journal.json')

function isMigrationsDir(dir: string): boolean {
  return existsSync(join(dir, JOURNAL))
}

/**
 * Loest den Drizzle-Migrationsordner cwd-unabhaengig auf.
 * Reihenfolge: expliziter Wert (Env MIGRATIONS_DIR / Runtime-Config) -> von `startDir`
 * aufwaerts nach `drizzle/meta/_journal.json` suchen (Dev: Projektwurzel, Prod: Ordner
 * neben `.output`) -> `<cwd>/drizzle`.
 */
export function resolveMigrationsDir(options: { explicit?: string, startDir: string, cwd?: string }): string {
  const explicit = options.explicit?.trim()
  if (explicit) {
    const dir = resolve(explicit)
    if (!isMigrationsDir(dir)) {
      throw new Error(`MIGRATIONS_DIR "${dir}" enthaelt keine ${JOURNAL}`)
    }
    return dir
  }
  let current = resolve(options.startDir)
  for (;;) {
    const candidate = join(current, 'drizzle')
    if (isMigrationsDir(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const fallback = resolve(options.cwd ?? process.cwd(), 'drizzle')
  if (isMigrationsDir(fallback)) return fallback
  throw new Error('Migrationsordner nicht gefunden (MIGRATIONS_DIR setzen)')
}
