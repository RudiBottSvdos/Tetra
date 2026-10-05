// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveMigrationsDir } from '../server/utils/migrations-dir'

const root = join(__dirname, '..')

describe('resolveMigrationsDir', () => {
  it('finds drizzle/ upwards from the module dir, independent of cwd', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'tetra-cwd-'))
    const dir = resolveMigrationsDir({ startDir: join(root, 'server', 'plugins'), cwd: elsewhere })
    expect(dir).toBe(join(root, 'drizzle'))
  })

  it('honours an explicit MIGRATIONS_DIR', () => {
    expect(resolveMigrationsDir({ explicit: join(root, 'drizzle'), startDir: tmpdir() })).toBe(join(root, 'drizzle'))
  })

  it('rejects an explicit dir without journal', () => {
    const empty = mkdtempSync(join(tmpdir(), 'tetra-empty-'))
    expect(() => resolveMigrationsDir({ explicit: empty, startDir: root })).toThrow(/MIGRATIONS_DIR/)
  })

  it('falls back to <cwd>/drizzle and throws when nothing is found', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'tetra-fb-'))
    expect(() => resolveMigrationsDir({ startDir: cwd, cwd })).toThrow(/nicht gefunden/)
    mkdirSync(join(cwd, 'drizzle', 'meta'), { recursive: true })
    writeFileSync(join(cwd, 'drizzle', 'meta', '_journal.json'), '{}')
    expect(resolveMigrationsDir({ startDir: cwd, cwd })).toBe(join(cwd, 'drizzle'))
  })
})
