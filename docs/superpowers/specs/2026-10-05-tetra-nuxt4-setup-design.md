# Tetra: Nuxt 4 Projekt-Setup

## Ziel
Web-App mit Backend und Datenbank auf Basis von Nuxt 4, deploybar per Docker Compose auf Coolify.

## Techstack
| Bereich | Wahl |
|---|---|
| Framework | Nuxt 4 (TypeScript, `app/`-Verzeichnis, Nitro) |
| Package Manager | pnpm |
| UI | Nuxt UI v4 + Tailwind 4 |
| Datenbank | PostgreSQL + Drizzle ORM (drizzle-kit) |
| Auth | Better Auth mit Drizzle-Adapter |
| Tests | Vitest + `@nuxt/test-utils` |
| Deployment | Coolify, Docker Compose, Nitro-Preset `node-server` |

Nicht enthalten: ESLint/Prettier, Playwright, Pinia.

## Struktur
- `app/`: Pages, Components, Composables
- `server/api/`: API-Routen
- `server/db/`: Schema und DB-Client
- `server/utils/auth.ts`: Better-Auth-Instanz
- `drizzle.config.ts`, `drizzle/`: Migrationen

## Docker
- Multi-Stage-`Dockerfile`: baut `.output`, startet mit Node.
- `docker-compose.yml`: Services `app` und `postgres` (Volume, Healthcheck).
- `docker-compose.dev.yml`: nur Postgres für die lokale Entwicklung.
- Konfiguration über `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
- Migrationen laufen beim Start der App über ein Nitro-Plugin.

## Umfang der ersten Version
1. Nuxt 4 initialisieren, Module installieren.
2. Schema mit Better-Auth-Tabellen, erste Migration.
3. Auth-Route, Login-/Registrierungsseite, geschützte Beispielseite.
4. Dockerfile und Compose-Dateien.
5. Smoke-Test und erfolgreicher `pnpm build`.
