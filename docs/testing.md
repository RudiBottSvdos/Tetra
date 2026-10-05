# Tests ausfuehren

| Befehl | Zweck |
|---|---|
| `pnpm test` | Unit/Komponenten/Contract-Tests, ohne Postgres. DB-Suiten werden mit Warnung uebersprungen, Exit-Code 0. |
| `pnpm test:db` | Nur `*.db.test.ts` gegen echte Postgres. Schlaegt ohne `TEST_DATABASE_URL` fehl. |
| `pnpm test:all` | Beides nacheinander (CI). |

## Test-Postgres

```
docker compose -f docker-compose.dev.yml up -d postgres
# Volume existiert schon (init-Skript laeuft nur beim ersten Start):
docker compose -f docker-compose.dev.yml exec postgres createdb -U tetra tetra_test
export TEST_DATABASE_URL=postgres://tetra:tetra@localhost:5432/tetra_test   # PowerShell: $env:TEST_DATABASE_URL = "..."
pnpm test:db
```

Jede DB-Suite legt ein temporaeres Schema (`t_<uuid>`) an, migriert `drizzle/` hinein und loescht es am Ende (`DROP SCHEMA ... CASCADE`). Suiten stoeren sich daher nicht.

## Helfer (`tests/helpers/`)

- `db.ts`: `describeDb(name, fn)` (Skip bzw. Fehler je nach Modus), `setupTestDb()` liefert `{ db, client, schemaName, teardown }`.
- `factories.ts`: `createProject/createChannel/createTopic/createVideo`, `createScenario` (ganze Kette).
- `clock.ts`: `useFakeClock()` (vi.useFakeTimers) und `createManualClock()` (injizierbar).
- `mocks.ts`: `createProviderMock<T>(methods, impl)` fuer Provider-Interfaces, `mockFetchSequence` plus `jsonResponse`, `brokenJsonResponse`, `timeoutError` fuer HTTP-Contract-Tests.

Beispiel:

```ts
import { afterAll, beforeAll, it } from 'vitest'
import { describeDb, setupTestDb, createScenario, type TestDb } from '../helpers'

describeDb('meine Suite', () => {
  let t: TestDb
  beforeAll(async () => { t = await setupTestDb() })
  afterAll(() => t?.teardown())
  it('...', async () => { const { video } = await createScenario(t.db) })
})
```

Dateien fuer `test:db` muessen auf `.db.test.ts` enden.
