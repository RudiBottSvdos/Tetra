// pnpm test:db: DB-/Integrationstests, schlaegt ohne TEST_DATABASE_URL fehl (kein stilles Ueberspringen).
import { spawnSync } from 'node:child_process'

if (!process.env.TEST_DATABASE_URL) {
  console.error('test:db benoetigt TEST_DATABASE_URL, z. B. postgres://tetra:tetra@localhost:5432/tetra_test (siehe docs/testing.md)')
  process.exit(1)
}
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '.db.test.'], {
  stdio: 'inherit', shell: true, env: { ...process.env, TETRA_REQUIRE_DB: '1' }
})
process.exit(r.status ?? 1)
