# Deployment mit Coolify (WP0.6)

Stand: 2026-10-05. Diese Anleitung ist **noch nicht gegen eine echte Coolify-Instanz getestet** (Domain/Server fehlen noch). Menüpunkte in Coolify können je nach Version leicht abweichen.

## 0. Voraussetzungen

- Server mit installiertem Coolify, erreichbar per SSH/Browser.
- Eigene Domain (siehe `docs/zugaenge-checkliste.md`, Abschnitt 1). DNS: A-Record (oder CNAME) auf die Server-IP, z. B. `panel.example.com`.
- Das Git-Repository ist bei GitHub; Coolify bekommt Lesezugriff (GitHub-App oder Deploy-Key).
- Lokal erzeugte Geheimnisse (nicht ins Repo!):
  ```
  openssl rand -base64 48   # BETTER_AUTH_SECRET
  openssl rand -hex 32      # ENCRYPTION_KEY
  openssl rand -base64 24   # POSTGRES_PASSWORD
  ```

## 1. Coolify-Ressource anlegen

1. Projekt anlegen (z. B. "Tetra"), Environment `production`.
2. "Neue Ressource" -> "Private Repository (GitHub App)" bzw. "Public Repository" -> Repo und Branch `main` wählen.
3. Build Pack: **Docker Compose**; Compose-Datei: `/docker-compose.yml`.
4. Die Compose-Datei startet zwei Dienste: `app` (Nuxt, Port 3000, non-root) und `postgres` (17). Volumes: `pgdata` (Datenbank), `mediabuffer` (`/data/media`, temporärer Medienpuffer).

## 2. Domain und HTTPS

1. Im Dienst `app` das Feld "Domains" auf `https://panel.example.com:3000` setzen (Port 3000 = Container-Port; Coolify/Traefik holt automatisch ein Let's-Encrypt-Zertifikat).
2. Dienst `postgres` bekommt **keine** Domain und keinen Host-Port (nur intern erreichbar).
3. Ports 80/443 der Server-Firewall offen, DNS muss vor dem ersten Deploy auflösen, sonst scheitert die Zertifikatsausstellung.
4. "Force HTTPS" aktivieren.

## 3. Umgebungsvariablen

Im Coolify-Tab "Environment Variables" setzen (Vorlage: `.env.example`). Pflicht sind markiert.

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `POSTGRES_PASSWORD` | ja | Passwort der DB (Compose baut `DATABASE_URL` daraus) |
| `POSTGRES_USER`, `POSTGRES_DB` | nein | Standard `tetra` |
| `BETTER_AUTH_SECRET` | ja | Signiert Sessions; lang und zufällig |
| `BETTER_AUTH_URL` | ja | Öffentliche URL, z. B. `https://panel.example.com` (ohne Slash am Ende) |
| `ENCRYPTION_KEY` | ja | 32 Byte (64 Hex-Zeichen oder Base64); verschlüsselt alle API-Keys/Tokens in der DB |
| `ENCRYPTION_KEY_PREVIOUS` | nein | Nur während einer Key-Rotation |
| `TRUSTED_ORIGINS` | nein | Zusätzliche Origins, kommagetrennt |
| `ALLOW_SIGNUP` | nein | Standard `false`; siehe Abschnitt 5 |

Fest im Compose gesetzt (nicht ändern): `MIGRATIONS_DIR=/app/drizzle`, `MEDIA_BUFFER_DIR=/data/media`, `NODE_ENV=production`.

Hinweis: `BETTER_AUTH_URL` muss exakt zur Domain passen, sonst scheitern Login und OAuth-Redirects.

## 4. Erster Deploy und Prüfung

1. "Deploy" klicken. Beim Start laufen die Datenbankmigrationen automatisch (Log: `[migrate] migrations applied`).
2. Health prüfen:
   ```
   curl -s https://panel.example.com/api/health            # {"status":"ok"}  (Liveness)
   curl -s https://panel.example.com/api/health?deep=1     # {"status":"ok","db":"up"}  bzw. 503 bei DB-Ausfall
   ```
   Der Endpunkt ist öffentlich und gibt nur Status/DB-Erreichbarkeit zurück. Der Container-Healthcheck nutzt die Liveness-Variante; `?deep=1` eignet sich für externes Monitoring (z. B. Uptime-Kuma).
3. Im Browser `https://panel.example.com/login` öffnen, Zertifikat und Security-Header prüfen.

## 5. Erstes Konto registrieren und Signup-Sperre

Die Registrierung ist nur erlaubt, solange **kein** Nutzer existiert (oder `ALLOW_SIGNUP=true`).

1. Direkt nach dem ersten Deploy (`ALLOW_SIGNUP` leer/`false`) das eigene Konto registrieren (Passwort mind. 12 Zeichen).
2. Danach sperrt sich die Registrierung automatisch; weitere Versuche liefern "Registrierung ist gesperrt." Prüfen: Registrierung in einem privaten Fenster erneut versuchen.
3. `ALLOW_SIGNUP` **nicht** auf `true` lassen; falls es zum Test gesetzt wurde, entfernen und neu deployen.
4. Zeitfenster minimieren: Domain erst dann dauerhaft öffentlich schalten, wenn Sie bereit sind, sofort zu registrieren.

## 6. Backups

**Postgres** (enthält alle Daten und verschlüsselte Secrets):
- Coolify: Dienst `postgres` -> "Backups" -> Zeitplan (täglich) und S3-Ziel konfigurieren (Coolify kann Compose-DBs je nach Version nur bei Erkennung als Datenbank sichern; sonst Cron-Alternative).
- Manuell/Cron auf dem Host:
  ```
  docker exec <postgres-container> pg_dump -U tetra -Fc tetra > tetra-$(date +%F).dump
  ```
- Wiederherstellung testen (leere DB): `pg_restore -U tetra -d tetra --clean tetra-YYYY-MM-DD.dump`.
- Dumps verschlüsseln und außerhalb des Servers ablegen.

**ENCRYPTION_KEY** (kritisch):
- Ohne den Schlüssel sind alle in der DB gespeicherten API-Keys und OAuth-Tokens unbrauchbar. Er steht **nicht** in der DB.
- Zusätzlich zu Coolify in einem Passwortmanager sichern (getrennt vom DB-Dump). Dasselbe gilt für `BETTER_AUTH_SECRET` (bei Verlust werden nur Sessions ungültig).
- Bei Verlust: Keys/Tokens in den Einstellungen neu eingeben, OAuth-Kanäle (YouTube, TikTok, OneDrive) neu verbinden.

**Medienpuffer** (`mediabuffer`): nur Zwischenspeicher, kein Backup nötig (Archiv liegt später in OneDrive).

## 7. Updates und Rollback

- Update: Push auf `main` (oder "Redeploy"). Migrationen laufen beim Start automatisch und sind nur vorwärts gerichtet.
- Vor jedem Deploy mit Schemaänderung: Postgres-Dump anlegen (Abschnitt 6).
- Rollback der App: In Coolify unter "Deployments" die letzte funktionierende Version erneut deployen bzw. den Commit zurücksetzen (`git revert`, Push). Das gilt für Code ohne Schemaänderung.
- Rollback mit Schemaänderung: App auf alten Stand bringen **und** DB aus dem Dump vor dem Deploy wiederherstellen (Datenverlust seit dem Dump beachten). Alternative: Fix-Forward mit neuer Migration.
- Bei Startproblemen: Logs des Dienstes `app` prüfen (`[migrate]`-Zeilen, "MIGRATIONS_DIR ... enthält keine ...").

## 8. Fehlersuche

| Symptom | Ursache / Lösung |
|---|---|
| Deploy bricht mit "set POSTGRES_PASSWORD/BETTER_AUTH_SECRET/BETTER_AUTH_URL/ENCRYPTION_KEY" ab | Variable in Coolify fehlt |
| Login schlägt fehl, "Invalid origin" | `BETTER_AUTH_URL`/`TRUSTED_ORIGINS` passt nicht zur aufgerufenen Domain |
| Container "unhealthy" | `docker logs`; `/api/health` im Container prüfen; Start dauert bis ca. 40 s (Migration) |
| `/api/health?deep=1` liefert 503 | DB nicht erreichbar/Passwort geändert (Passwort im Volume bleibt das alte!) |
| Zertifikat fehlt | DNS zeigt nicht auf den Server oder Port 80/443 blockiert |

## 9. Ungeprüft

Nicht getestet (kein Server, Docker-Daemon war beim Erstellen nicht gestartet): `docker build`, Compose-Start, Coolify-Menüpunkte, Backup-Konfiguration. Beim ersten echten Deploy abhaken und Abweichungen hier korrigieren.
