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
| `ALLOWED_IPS` | empfohlen | Erlaubte Client-IPs/CIDR, kommagetrennt, z. B. `178.105.17.179`; leer = IP-Sperre aus (siehe Abschnitt 9) |
| `TRUSTED_PROXY_HOPS` | nein | Vertrauenswürdige Proxys vor der App, Standard `1` (Traefik) |

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

## 9. IP-Sperre

Das Panel (UI und API) ist nur von der VPN-IP `178.105.17.179` erreichbar. Öffentlich bleiben ausschließlich `/legal/**`, `/api/health` und die statischen Assets (`/_nuxt/**`, `favicon.ico`, `robots.txt`). Login-Seite, `/api/auth/**`, Webhooks und OAuth-Callbacks sind **gesperrt** (fremde IPs erhalten ein schlichtes `403 Forbidden`). Zwei Ebenen (Defense in Depth):

**Assets-Entscheidung:** `/_nuxt/**` enthält nur gehashte, öffentlich ausgelieferte Client-Bundles ohne Secrets (Secrets liegen nur serverseitig/in der DB). Die Rechtsseiten brauchen dieselben Entry-Chunks, eine Trennung ist technisch nicht möglich. Daher sind Assets öffentlich; sie verraten nur die Struktur der UI, keine Daten.

### Ebene 1: Traefik (Coolify)

Im Dienst `app` unter "Custom Labels" ergänzen (Router-Namen `tetra` anpassen, Domain `panel.example.com`; Entrypoint/Cert-Resolver wie von Coolify generiert übernehmen, hier nur die Ergänzungen). Der `ipallowlist`-Filter hängt am Haupt-Router, ein zweiter Router mit höherer Priorität nimmt `/legal` und `/api/health` aus:

```
traefik.http.middlewares.tetra-vpn.ipallowlist.sourcerange=178.105.17.179/32
# Haupt-Router (Name aus den von Coolify erzeugten Labels, hier tetra-https): nur VPN-IP
traefik.http.routers.tetra-https.middlewares=tetra-vpn@docker
# Zweiter Router, hoehere Prioritaet, ohne IP-Filter
traefik.http.routers.tetra-public.rule=Host(`panel.example.com`) && (PathPrefix(`/legal`) || PathPrefix(`/_nuxt`) || Path(`/api/health`) || Path(`/favicon.ico`) || Path(`/robots.txt`))
traefik.http.routers.tetra-public.priority=100
traefik.http.routers.tetra-public.entrypoints=https
traefik.http.routers.tetra-public.tls=true
traefik.http.routers.tetra-public.tls.certresolver=letsencrypt
traefik.http.routers.tetra-public.service=<service-name-des-haupt-routers>
```

Hinweise: Coolify überschreibt die Labels der Compose-Ressource teils beim Deploy; Namen von Router/Service/Resolver aus den generierten Labels ablesen (nicht getestet). Traefik wertet `sourcerange` gegen die direkte Peer-IP aus. Sitzt ein weiterer Proxy/CDN davor (z. B. Cloudflare), stattdessen `ipallowlist.ipstrategy.depth` setzen und `TRUSTED_PROXY_HOPS` entsprechend erhöhen.

### Ebene 2: App-Middleware

`server/middleware/00-ip-allowlist.ts` läuft vor der Security-Middleware und prüft `ALLOWED_IPS` (IPv4/IPv6, optional CIDR, kommagetrennt). Client-IP: Bei `TRUSTED_PROXY_HOPS=N` (Standard 1) wird der N-te Eintrag **von rechts** aus `X-Forwarded-For` genommen; vom Client mitgeschickte linke Einträge werden ignoriert. `0` = Header ignorieren, Socket-IP verwenden. Fail-closed: ist `ALLOWED_IPS` gesetzt und die Client-IP nicht ermittelbar (Kette zu kurz, ungültig), gibt es 403; ungültige Einträge in `ALLOWED_IPS` werden ignoriert (Warnung im Log), sind alle ungültig, wird alles gesperrt. Ist `ALLOWED_IPS` leer, ist die Sperre aus (in Produktion Warnung im Log `[ip-allowlist] WARNUNG ...`). Wichtig: Der Container darf keinen Host-Port veröffentlichen, sonst könnte ein Angreifer `X-Forwarded-For` direkt setzen (Compose nutzt nur `expose`).

### Abhängigkeiten und Betrieb

- **OAuth** (Google/YouTube, TikTok, OneDrive): Der Callback `/api/oauth/*/callback` wird vom Browser des Nutzers aufgerufen, also über die VPN-IP, und ist deshalb erlaubt. Die Anbieter selbst rufen die App nicht auf.
- **HeyGen** arbeitet per Polling (ausgehende Requests der App), keine eingehenden Webhooks nötig. `/api/webhooks/**` ist daher ebenfalls gesperrt.
- **Prüfer/Audits** (z. B. Sicherheits- oder Lighthouse-Prüfung von außen): brauchen temporär eine freigegebene IP, d. h. in `ALLOWED_IPS` und im Traefik-`sourcerange` ergänzen und danach wieder entfernen.
- **Externes Monitoring** nutzt `/api/health` (öffentlich).
- **Selbst-Aussperrung/Notfall:** VPN-IP ändert sich oder fällt aus -> in Coolify `ALLOWED_IPS` (und das Traefik-Label) anpassen und neu deployen; Zugriff auf Server per SSH/Coolify-Oberfläche bleibt davon unberührt. Zur kompletten Deaktivierung der App-Ebene `ALLOWED_IPS` leeren (Traefik-Ebene separat entfernen).
- Prüfen: `curl -si https://panel.example.com/login` von fremder IP -> `403 Forbidden`; `curl -s https://panel.example.com/api/health` -> `{"status":"ok"}`.

## 10. Ungeprüft

Nicht getestet (kein Server, Docker-Daemon war beim Erstellen nicht gestartet): `docker build`, Compose-Start, Coolify-Menüpunkte, Backup-Konfiguration. Beim ersten echten Deploy abhaken und Abweichungen hier korrigieren.
