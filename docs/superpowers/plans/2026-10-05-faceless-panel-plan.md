# Umsetzungsplan: Faceless-Social-Media-Panel

Stand: 2026-10-05 (überarbeitet nach Interview). Basis: bestehendes Nuxt-4-Setup (Nuxt UI 4, Drizzle/Postgres, Better Auth, Vitest, Docker/Coolify, Migration per Nitro-Plugin). Dieser Plan ändert keinen Code.

## 0. Entscheidungen (Interview 2026-10-05)

1. **Visuell**: avatarlos (Voiceover + B-Roll + eingebrannte Untertitel) ist Standard. Avatar ist pro Projekt optional (`heygen_avatar_id` nullable; NULL = avatarlos). WP0.1 muss prüfen, ob HeyGen Video Agent avatarlos liefert (B-Roll, Untertitel, wörtliches Voiceover). Falls nein: Fallback-Provider (WP1.11) hinter demselben `VideoProvider`-Interface.
2. **Zwischenmodi akzeptiert**: YouTube zuerst (Uploads bleiben bis zum Audit privat), TikTok zunächst als Inbox-Entwurf. Beide Audits werden sofort vorbereitet und so früh wie möglich beantragt (WP0.0, WP4.2, WP0.6).
3. **Es existieren noch keine Konten/Zugänge.** Der Plan enthält eine Zugangs-Checkliste (Abschnitt 1a, WP0.0) mit Fälligkeit vor der jeweils betroffenen Welle.
4. **Freigabestufen**: Themenauswahl und Video-Freigabe sind Pflicht. Skriptfreigabe ist ein Schalter pro Projekt (`script_approval_required`, Standard an). Der Zustandsautomat enthält dafür ein script-Gate.
5. **Start**: 1-2 Projekte, 1 Video/Tag/Projekt, 30-45 s. Limits pro Projekt 3 USD/Tag und 60 USD/Monat, zusätzlich globales Monatslimit 150 USD (Datenmodell + CostGuard).
6. **Rechtstexte** liefert der Nutzer (Betreiber: er selbst, Privatperson). Der Agent baut die Seiten (Datenschutz, Nutzungsbedingungen, Impressum) mit Platzhaltern. KI-Kennzeichnung (YouTube `containsSyntheticMedia`, TikTok AIGC-Label) ist immer an und nicht abschaltbar.
7. **Erreichbarkeit**: Panel ist aus dem Internet erreichbar (Coolify, eigene Domain, HTTPS), aber hinter Login; nur Rechtsseiten (und Landingpage) ohne Login. Härtung: Rate Limit, Registrierung nach erstem Nutzer gesperrt, deny-by-default für alle Routen.
8. **Medien**: lokal nur Zwischenspeicher (HeyGen `video_url` läuft ab, Upload braucht Bytes). Nach erfolgreichem Upload wird die Datei ins OneDrive verschoben (privates Microsoft-Konto, Microsoft Graph, Upload-Session, Azure-App-Registrierung für Personal Accounts, Refresh-Token verschlüsselt) und lokal gelöscht. Storage-Interface (`local`/`onedrive`). Keine Löschfrist/GB-Grenze in OneDrive, aber lokaler Puffer-Cleanup. Vorschau/Download in Review.
9. **Benachrichtigungen**: zuerst nur Panel-Banner; in Phase 6 E-Mail oder Webhook (n8n) für Budgetpause, Token abgelaufen, Job endgültig fehlgeschlagen. Der 80-%-Kostenalarm ist ein eigenes Arbeitspaket (WP1.10).
10. **Plattform-Metadaten**: gleiches Video auf beiden Kanälen, aber Titel/Beschreibung/Hashtags je Plattform, von Deepseek generiert, in `publication` gespeichert und in Review editierbar. UI 1+1 Kanäle, Datenmodell offen für mehr.
11. **Keys** liegen global verschlüsselt in der DB (`ENCRYPTION_KEY`) mit optionalem Override pro Projekt.

## 1. Ziel und Rahmen

Single-Tenant-Panel, das für Projekte (Kanalpaar TikTok + YouTube Shorts) vollständig KI-generierte Kurzvideos produziert: Deepseek (Themen, Skripte, Plattform-Metadaten) -> Video-Provider (HeyGen Video Agent, avatarlos als Standard) -> manuelle Freigaben -> Upload per offizieller API -> Archivierung in OneDrive -> Kennzahlen. Hintergrundjobs über pg-boss, Kostenlimits pro Projekt und global, Zugangsdaten verschlüsselt in der DB.

Startlast: 1-2 Projekte, 1 Video/Tag/Projekt, 30-45 s (Standard `target_video_length_s` = 40). Kostenabschätzung: ca. 1-1,5 USD/Video bei 0,0333 USD/s, also ca. 30-45 USD/Monat/Projekt, passt in 60 USD (Projekt) und 150 USD (global); Puffer für Neu-Renderings und LLM-Kosten bleibt knapp, Alarm bei 80 % ist deshalb Pflicht.

Ist-Zustand (Code): Auth mit E-Mail/Passwort, Seiten `index`, `login`, `dashboard`, Tabellen nur `user/session/account/verification`, `runtimeConfig` mit `databaseUrl`, `betterAuthSecret`, `betterAuthUrl`, Tests `tests/app.test.ts`, `tests/schema.test.ts`, Migration per `server/plugins/migrate.ts` (wird in WP0.3 zu `00-migrate.ts`). Hinweis: Die Spec-Datei `docs/superpowers/specs/2026-10-05-tetra-nuxt4-setup-design.md` wird auf Wunsch des Nutzers gelöscht (separater Commit); dieser Plan stützt sich nicht auf sie.

**Single-Tenant-Absicherung (dynamisch)**: Registrierung wird per Before-Hook/`databaseHooks.user.create.before` in Better Auth geprüft: erlaubt nur, wenn die `user`-Tabelle leer ist oder `ALLOW_SIGNUP=true` gesetzt ist (Notfall-/Bootstrap-Flag, Standard aus). Kein statisches `disableSignUp`, sonst wäre der erste Nutzer nicht anlegbar. Zusätzlich: deny-by-default-Server-Middleware für `/api/**` (Allowlist: `/api/auth/**`, `/api/webhooks/**` mit Signaturprüfung, `/api/oauth/*/callback` mit State-Prüfung, Health-Route ohne Details) und Seiten-Guard (Allowlist: `/`, `/login`, `/legal/*`).

## 1a. Zugangs-Checkliste (Konten und Anträge)

Aktueller Stand: nichts davon existiert. Verantwortlich ist der Nutzer; der Agent liefert in WP0.0 eine Schritt-für-Schritt-Anleitung (Redirect-URIs, Scopes, Namen) als Markdown in `docs/`. "Fällig vor" bezieht sich auf die Welle, ab der Pakete real getestet werden (bis dahin reichen Fakes/Mocks).

| Zugang / Antrag | Inhalt | Fällig vor | Hinweis |
|---|---|---|---|
| Domain + DNS + Coolify-Host | Eigene Domain, HTTPS (Let's Encrypt), A/CNAME auf Coolify | W3 (WP0.6) | Blockiert OAuth-Redirects und beide Audits; so früh wie möglich |
| Google-Cloud-Projekt + YouTube Data API v3 | Projekt, API aktivieren, OAuth-Client (Web), Redirect-URI `https://<domain>/api/oauth/google/callback` | W4 (WP3.1) | Consent-Screen auf "In production" stellen (sonst Refresh-Tokens nach 7 Tagen ungültig); Google-App-Verifizierung (Scope `youtube.upload` ist sensibel) ist getrennt vom YouTube-API-Compliance-Audit |
| YouTube-Brand-Accounts/Kanäle | Je Projekt ein Brand-Account/Kanal | W5 (WP3.2 Live-Test) | Kanal-Verifizierung (Telefon) für längere Uploads/Features beachten |
| YouTube-API-Compliance-Audit | Formular für Audit/Quota-Erweiterung | Antrag sofort nach WP0.6 + WP4.2 (Seiten online) | Bis zur Freigabe sind Uploads privat |
| TikTok-Developer-Konto + App | App mit Content Posting API, Scopes `video.upload` (Inbox), später `video.publish`, Redirect-URI, Domain-/URL-Verifizierung, Link auf Rechtsseiten | W4 (WP3.1) | Inbox braucht kein Audit; Zielkonto als Tester eintragen |
| TikTok-Audit (Direct Post) | Demo-Video des Flows, Website, Datenschutz, Nutzungsbedingungen | Vorbereitung ab WP4.2, Einreichung sobald Audit-UX (WP4.3-UX) demonstrierbar | WP0.1 klärt, ob Demo in Sandbox möglich ist |
| HeyGen-API-Plan + Guthaben | API-Key, prepaid Guthaben | W1 (WP0.1, ggf. kleines Guthaben) bzw. W4 (WP1.7 Live-Smoke) | Preise/Avatarlos-Fähigkeit prüfen vor Kauf eines großen Plans |
| Deepseek-Guthaben | API-Key, Guthaben | W4 (WP1.5 Live-Smoke) | |
| Azure-App-Registrierung (OneDrive) | App für "Personal Microsoft accounts only" (Tenant `consumers`), Redirect-URI `https://<domain>/api/oauth/onedrive/callback`, delegierte Rechte `Files.ReadWrite`, `offline_access`, Client-Secret | W5 (WP3.5) | Privates Microsoft-Konto mit ausreichend Speicher |
| Optional je nach WP0.1 | TTS-/Stock-Footage-API-Keys (nur falls Fallback-Provider WP1.11 nötig) | vor WP1.11 | |
| E-Mail-SMTP oder n8n-Webhook-URL | Ziel für Benachrichtigungen | W8 (WP6.4) | |

## 2. Recherche-Stand der Fremd-APIs (Annahmen, ehrlich)

Per kurzer Web-Recherche am 2026-10-05; nichts davon ist gegen echte Konten getestet. Jede Annahme wird in Phase 0 per Spike verifiziert.

**HeyGen Video Agent**
- `POST /v3/video-agents`, Auth per Header `X-Api-Key`. Parameter: `prompt` (1-10.000 Zeichen), optional `avatar_id`, `voice_id`, `orientation` (`portrait` für Shorts), `callback_url`/`callback_id`.
- Asynchron: erst `GET /v3/video-agents/{session_id}` liefert `video_id`, dann `GET /v3/videos/{video_id}` bis `completed`/`failed`. Dauer laut Doku grob 5-10x Videolänge.
- Preis laut Drittquellen ca. 0,0333 USD/Sekunde (ca. 1-2 USD pro 30-60-s-Video), prepaid Guthaben. Unsicher/unbestätigt: **ob avatarlose Ausgabe (Voiceover + B-Roll + eingebrannte Untertitel) ohne `avatar_id` zuverlässig erzeugt wird**, Länge steuert man nur im Prompt (kein Parameter), Ablaufzeit der `video_url` (nicht dokumentiert -> sofort herunterladen), Rate Limits, ob der Agent das Skript wörtlich übernimmt (Prompt muss "sprich exakt diesen Text" erzwingen; Abweichungen prüfen), Kosten-Rückmeldung pro Video (ggf. nur aus Dauer x Tarif schätzbar).

**YouTube Data API**
- Upload via `videos.insert` (OAuth, Scope `youtube.upload`), Statistiken via `videos.list` (`statistics`, Scope `youtube.readonly`). Shorts sind normale Uploads: vertikal, <= 3 Minuten (aktuell Obergrenze prüfen), `#Shorts` in Titel/Beschreibung.
- Zwei getrennte Verfahren: (a) **Google-OAuth-App-Verifizierung** (Consent Screen, sensible Scopes; Status muss "In production" sein, sonst Refresh-Tokens nach 7 Tagen ungültig; unverifizierte Apps zeigen Warnseite und haben Nutzerlimit, für einen einzelnen Betreiber akzeptabel) und (b) **YouTube API Services Compliance Audit** (hebt den Privatzwang für Uploads aus nicht auditierten API-Projekten, erstellt nach 28.07.2020, auf). Beide separat beantragen.
- Quota-Regeln wurden laut Quellen 2025/2026 geändert (Upload-Kosten gesenkt, eigener Bucket mit ca. 100 Calls/Tag) -> Zahlen vor Umsetzung gegen die offizielle Doku prüfen. Zeitplanung nativ möglich (`status.publishAt` mit `privacyStatus=private`), wir planen aber selbst per Cron.
- Offenlegung "altered/synthetic content" (`status.containsSyntheticMedia`) für realistische KI-Inhalte; Feld und Pflicht prüfen.

**TikTok Content Posting API**
- Zwei Modi: Direct Post (Scope `video.publish`) und Upload/Inbox-Entwurf (Scope `video.upload`, kein Audit nötig, Nutzer schließt den Post in der App ab; laut Quellen ca. 5 offene Entwürfe/24 h). Nicht auditierte Clients dürfen nur `SELF_ONLY` posten (Fehler `unaudited_client_can_only_post_to_private_accounts`), begrenzte Nutzerzahl. Ob der AIGC-Label im Inbox-Modus per API setzbar ist, ist offen (sonst Hinweis im Panel: Label beim Veröffentlichen in der App setzen).
- Audit verlangt u. a. öffentliche Website, Datenschutzerklärung, Nutzungsbedingungen, Demo-Video des Flows und UX-Vorgaben (Creator-Info abfragen, Privacy-Auswahl, Disclosure-Toggles, Hinweis "Posted by"). Das Panel muss diese UX-Pflichten beim Direct Post erfüllen.
- Tokens: Access Token kurzlebig (ca. 24 h), Refresh Token länger; Refresh-Flow zwingend.
- Statistiken: Video-Metriken (Views/Likes) über Display-/Research-API-Scopes (`video.list`, `user.info.stats`); Verfügbarkeit für Entwurfs-/nicht auditierte Posts unsicher. Fallback: manuelle Eingabe oder nur YouTube-Kennzahlen (WP5.3).

**Microsoft Graph / OneDrive (privates Konto)**
- Auth: OAuth2 Code-Flow gegen Tenant `consumers`, Scopes `Files.ReadWrite offline_access`. Refresh-Token wird bei jedem Refresh rotiert und muss atomar neu gespeichert werden.
- Dateien > 4 MB über Upload-Session (`createUploadSession`, Chunks in Vielfachen von 320 KiB). Download per kurzlebiger `@microsoft.graph.downloadUrl` oder Proxy-Stream. Details in WP0.1 prüfen (Limits, Throttling, Ordnerstruktur).

## 3. Architekturentscheidungen

- **Provider-Interfaces** in `server/providers/`: `LlmProvider` (Deepseek), `VideoProvider` (HeyGen, optional Fallback), `PublisherProvider` (YouTube, TikTok), `MetricsProvider` (je Plattform), `StorageProvider` (`local`, `onedrive`). Jedes Interface hat `testConnection()` (für den Test-Verbindung-Knopf, WP2.5). Registry löst Implementierung + Credentials pro Projekt auf. Tests nutzen Fakes.
- **Verschlüsselte Secrets**: `server/utils/crypto.ts`, AES-256-GCM, 12-Byte-Zufalls-IV, Format `v1:iv:tag:ciphertext` (Base64), Schlüssel aus `ENCRYPTION_KEY` (32 Byte, Base64/Hex). **Lazy-Validierung**: Der Schlüssel wird erst bei der ersten Ver-/Entschlüsselung geprüft (`getKey()`, bei Fehler klare Exception); Tests setzen den Key per Helper. Der Start-Check (Abbruch bei fehlendem/ungültigem Key) läuft nur im Nitro-Plugin `00-migrate.ts`, wenn `DATABASE_URL` gesetzt und nicht im Test-/Build-Modus; Start ohne DB und `pnpm test`/`pnpm build` brechen dadurch nicht. Versionspräfix erlaubt spätere Rotation. API gibt Secrets nie zurück (nur "gesetzt/zuletzt geändert" + Maske). OAuth-Tokens (YouTube, TikTok, OneDrive-Refresh-Token) nutzen dieselbe Verschlüsselung.
- **Nitro-Plugin-Reihenfolge**: Plugins laden alphabetisch, daher Präfixe: `server/plugins/00-migrate.ts` (Migration + Key-Check), `server/plugins/10-boss.ts` (pg-boss + Worker). `migrationsFolder` wird cwd-unabhängig aufgelöst (Env `MIGRATIONS_DIR`, sonst relativ zur Moduldatei bzw. Nitro-`serverAssets`; im Dockerfile wird `drizzle/` an den erwarteten Ort kopiert; Test deckt Start aus abweichendem cwd ab). `drizzle.config.ts` setzt `schemaFilter: ['public']`, damit das pg-boss-Schema `pgboss` nie in Migrationen landet.
- **pg-boss** (eigenes Schema `pgboss` in derselben DB), Worker im App-Prozess (Single-Instance ausreichend; `app` bleibt 1 Replika). Queues: `topics.generate`, `script.generate`, `video.render` (+ `video.poll`), `video.upload`, `media.archive`, `media.cleanup`, `metrics.sync`, `scheduler.tick`, `cost.alert`, `notify.deliver`. Retry mit Backoff und festem Limit pro Queue; Idempotenzschlüssel (`singletonKey`) pro Video/Schritt.
- **Zustandsautomat Video** (Übergänge nur über eine zentrale Funktion mit Übergangstabelle, jeder Übergang schreibt `video_event`):
  - `idea -> scripting -> script_ready`
  - `script_ready -> awaiting_script_approval` (Gate an, `project.script_approval_required`) oder direkt `-> rendering` (Gate aus)
  - `awaiting_script_approval -> rendering` (freigegeben) | `-> scripting` (Skript abgelehnt: neues Skript, Grund wird dem Prompt mitgegeben) | `-> rejected`
  - `rendering -> awaiting_review | failed | paused_budget`
  - `awaiting_review -> scheduled` (freigegeben) | `-> rejected`
  - `rejected -> scripting` (neues Skript) | `-> rendering` (Neu-Rendern, kostenpflichtig, nur mit Bestätigung); sonst bleibt `rejected` Endzustand (verworfen)
  - `scheduled -> uploading` | `-> awaiting_review` (Freigabe zurückziehen)
  - `uploading -> uploaded | partially_uploaded | failed`
  - `partially_uploaded -> uploading` (nur fehlgeschlagene Kanäle wiederholen, getrennt je `publication`) | `-> uploaded`
  - `failed -> <resume_status>` per manuellem Retry (Panel-Aktion, setzt `attempts` zurück, Kostenbestätigung bei Render)
  - `paused_budget -> <resume_status>`: `video.resume_status` hält den Zustand vor der Pause; Rückkehr beim Fortsetzen des Projekts (oder nach Monatswechsel). Auch `scripting` und `idea` können pausieren.
  - `uploaded` und `rejected` sind Endzustände (Archivierung ist Teil von `media.archive`, kein Videostatus).
  Das Skript-Gate ist reine Konfiguration; die Tabelle enthält beide Pfade.
- **Kostenkontrolle**: `CostGuard.reserve(projectId, estimate)` vor jedem kostenpflichtigen Call (LLM, Render) prüft transaktionell (`SELECT ... FOR UPDATE` auf Projekt + globale Zeile in `app_setting`) in dieser Reihenfolge: Projekt-Tageslimit, Projekt-Monatslimit (Projektzeitzone), **globales Monatslimit** (Standard 150 USD, Kalendermonat in Betreiberzeitzone). Ergebnis ist eine Reservierung (`cost_entry` mit `status = reserved`, `reservation_expires_at`). Danach `commit(reservationId, actual)` (setzt `committed`, Ist-Wert, `estimated` false/true) oder `release(reservationId)` bei Fehlern, Abbruch, Retry vor dem Call, nicht gestarteten Jobs (Rollback). Ein Reaper gibt abgelaufene Reservierungen frei (Absturz-Sicherheit); bereits abgesendete Render-Calls werden nicht freigegeben, sondern mit Schätzwert als `committed, estimated` verbucht. Bei Überschreitung: Job bricht ohne Retry ab, Video -> `paused_budget` (mit `resume_status`), Projekt-Flag `production_paused` bzw. globales `global_paused` mit Grund und Notification. Der 80-%-Alarm (Projekt Tag/Monat, global Monat) läuft über `cost.alert` (WP1.10).
- **Medienspeicher (`StorageProvider`)**: gerenderte MP4 sofort in lokalen Zwischenspeicher (`/data/videos`, Docker-Volume) laden; Pfad in `video.file_path`. Review-Auslieferung über geschützte Route mit Range-Support (lokal) oder Proxy-Stream/kurzlebige Link-Weiterleitung (OneDrive) plus Download-Button. Ablauf: Upload zu den Plattformen immer aus der lokalen Datei; sobald alle `publication`-Uploads `ok` sind (oder das Video `rejected` ist und die Aufbewahrungsfrist des lokalen Puffers abgelaufen ist), verschiebt `media.archive` die Datei ins OneDrive (Upload-Session, Größen-/Hash-Prüfung nach Upload), setzt `storage_backend = onedrive`, `storage_ref` (Item-ID) und löscht erst danach lokal (`local_deleted_at`). Schlägt Archivierung fehl, bleibt die lokale Datei, Retry + Notification. `media.cleanup` (täglich) räumt nur lokale Dateien auf, die bereits archiviert sind, sowie verwaiste Dateien ohne DB-Eintrag; Warnung bei Unterschreiten von freiem Speicherplatz. In OneDrive gibt es keine Löschfrist und keine GB-Grenze. Fehlt die lokale Datei beim Re-Upload (Retry), lädt das System sie aus OneDrive zurück.
- **Zeitplan**: `scheduler.tick` (jede Minute) belegt Slots aus Wochenplan (Uhrzeit, Zeitzone, Videos/Tag) mit freigegebenen Videos; Überschreibung `video.publish_at`. Zeitzonenlogik (DST) mit `date-fns-tz`/Luxon, klar gekapselt.
- **Plattform-Metadaten**: Deepseek erzeugt im Skript-Schritt je verbundenem Kanal Titel/Beschreibung/Hashtags (plattformspezifisch: YouTube mit `#Shorts`, TikTok kurz mit Hashtags), gespeichert in `publication`; in Review editierbar. Kanäle, die erst später verbunden werden, erhalten ihre Metadaten bei der nächsten Generierung/auf Knopfdruck (günstiger LLM-Call, über CostGuard).
- **KI-Kennzeichnung**: `publication.ai_label` ist `NOT NULL DEFAULT true` mit CHECK-Constraint `ai_label = true` und wird von den Publishern immer gesendet; keine UI-Option zum Abschalten.
- **Notifications**: Tabelle `notification` (Typ, Schwere, Projekt, Text, `dedupe_key`, `read_at`, `resolved_at`); Banner im Panel zuerst; externe Zustellung (E-Mail/n8n-Webhook) später als `notify.deliver`-Kanäle (WP6.4), Ereignisse: Budgetpause, Kostenalarm 80 %, Token abgelaufen/Refresh fehlgeschlagen, Job endgültig fehlgeschlagen, Archivierung fehlgeschlagen, Speicher knapp.
- **Härtung für Internetbetrieb**: Better-Auth-Rate-Limit + Nitro-Rate-Limit-Middleware für Login/Auth-Routen, sichere Cookies/HSTS hinter Coolify-Proxy (`trustedOrigins`, `betterAuthUrl` mit HTTPS), Security-Header, deny-by-default-Allowlist, Route-Enumerations-Test.

## 4. Datenmodell (Skizze)

Alle Tabellen mit `id` (uuid), `created_at`, `updated_at`. Das gesamte Schema (inkl. `notification`, `app_setting`) wird in WP0.3 angelegt, damit spätere Pakete nicht dieselben Schema-Dateien ändern.

- `settings_secret`: `key` (z. B. `heygen.apiKey`, `deepseek.apiKey`, `onedrive.clientId`, `onedrive.clientSecret`, `onedrive.refreshToken`), `value_enc`, `updated_at` (globale Standards).
- `app_setting`: `key`, `value` (jsonb, nicht geheim): `global_monthly_budget_cents` (Standard 15000), `global_paused`, `global_pause_reason`, `local_buffer_retention_days` (Standard 7), `operator_timezone`.
- `project`: `name`, `niche`, `language`, `style_prompt`, `visual_style_prompt` (B-Roll-/Untertitelstil), `heygen_avatar_id` (nullable, NULL = avatarlos), `heygen_voice_id`, `video_provider` (`heygen`|`fallback`, Standard `heygen`), `script_approval_required` (bool, Standard true), `daily_budget_cents` (Standard 300), `monthly_budget_cents` (Standard 6000), `production_paused`, `pause_reason`, `target_video_length_s` (Standard 40, Bereich 30-45), `topic_batch_size` (Standard 20), `max_retries`, `max_videos_in_review` (Standard 3), `timezone`.
- `project_secret`: `project_id`, `key`, `value_enc` (optionale Überschreibung HeyGen/Deepseek).
- `channel`: `project_id`, `platform` (`youtube`|`tiktok`), `display_name`, `external_id`, `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `scopes`, `status` (`connected`|`expired`|`audit_pending`), `tiktok_mode` (`inbox`|`direct`, Standard `inbox`), `youtube_visibility` (`private`|`public`, Standard `private`). Mehrere Kanäle je Projekt möglich (UI zunächst 1+1).
- `schedule_rule`: `project_id`, `weekday`, `time_local`, `timezone`, `videos_per_day`/Slots, `enabled`.
- `topic`: `project_id`, `title`, `angle`, `status` (`suggested`|`approved`|`rejected`|`used`), `fingerprint` (normalisierter Titel), `batch_id`. Eindeutigkeit (`project_id`, `fingerprint`); alle bisherigen Themen gehen als Ausschlussliste in den Deepseek-Prompt. Themenauswahl ist Pflicht (nie Auto-Approve).
- `video`: `project_id`, `topic_id`, `status`, `resume_status` (für `paused_budget`/`failed`), `script`, `script_approved_at`, `heygen_session_id`, `heygen_video_id`, `visual_mode` (`faceless`|`avatar`, aus Projekt zum Renderzeitpunkt), `file_path`, `storage_backend` (`local`|`onedrive`), `storage_ref` (OneDrive-Item-ID), `local_deleted_at`, `duration_s`, `publish_at` (Override), `slot_at`, `rejected_reason`, `attempts`, `last_error`. Titel/Beschreibung/Hashtags liegen nicht mehr im `video`, sondern je Plattform in `publication`.
- `video_event`: `video_id`, `from_status`, `to_status`, `message`, `at`.
- `publication`: `video_id`, `channel_id`, `platform`, `title`, `description`, `hashtags` (jsonb), `ai_label` (bool, immer true, CHECK), `meta_edited` (bool), `external_post_id`, `status` (`draft`|`pending`|`uploading`|`ok`|`failed`), `mode` (`inbox`|`direct`|`private`), `uploaded_at`, `error`, `attempts`. Eindeutig (`video_id`, `channel_id`).
- `cost_entry`: `project_id` (nullable für globale Posten), `video_id?`, `provider`, `operation`, `amount_micro_usd`, `units` (Tokens/Sekunden), `status` (`reserved`|`committed`|`released`), `reservation_expires_at`, `estimated` (bool), `at`.
- `notification`: `project_id?`, `type`, `severity`, `message`, `dedupe_key`, `read_at`, `resolved_at`, `delivered_at` (externe Zustellung), `delivery_attempts`.
- `metric_snapshot`: `publication_id`, `date`, `views`, `likes`, `comments`, `shares?`, `source` (`api`|`manual`); Unique (`publication_id`, `date`).
- pg-boss legt eigene Tabellen im Schema `pgboss` an (nicht in Drizzle verwalten; `schemaFilter: ['public']`).

## 5. Modulstruktur

```
server/
  db/schema.ts                  (aufteilen in server/db/schema/*.ts, Re-Export; komplettes Schema in WP0.3)
  utils/crypto.ts               AES-256-GCM, lazy Key-Validierung
  utils/secrets.ts              Auflösung global/Projekt, Maskierung
  utils/require-user.ts         Auth-Guard
  utils/auth.ts                 Better Auth inkl. Signup-Sperre (User-Count/ALLOW_SIGNUP), Rate Limit
  middleware/auth-guard.ts      deny-by-default, Allowlist
  providers/
    types.ts                    Interfaces + Fehlerklassen (Retryable/Fatal/BudgetExceeded)
    registry.ts
    deepseek/ heygen/ fallback-video/ youtube/ tiktok/ storage/ (local, onedrive)
    fakes/                      Test-Doubles
  services/
    cost-guard.ts  video-state.ts  topics.ts  scripts.ts  scheduler.ts  metrics.ts  media.ts  notifications.ts
  jobs/
    boss.ts (Start/Stop)  handlers/*.ts  register.ts
  plugins/00-migrate.ts         Migration (+ Key-Check)
  plugins/10-boss.ts            pg-boss, nach Migration
  api/
    projects/ channels/ topics/ videos/ settings/ metrics/ notifications/ oauth/ webhooks/heygen.post.ts health.get.ts
app/
  pages/ index (öffentlich), login, projects/index, projects/[id]/(overview|topics|videos|schedule|channels|costs|metrics), review/[id], settings, legal/privacy, legal/terms, legal/imprint (öffentlich)
  components/ composables/
tests/ (unit, integration mit Test-DB, provider-contract)
```

## 6. Phasen, Meilensteine und Arbeitspakete

Konventionen: Agent-Typen aus den installierten SuperClaude-Agents; Modell nach Aufwand (haiku = Boilerplate, sonnet = Standard, opus = schwierige Entscheidungen/kritische Reviews). Jedes Paket endet mit grünem `pnpm test` (Unit, ohne Postgres lauffähig) und `pnpm build`; DB-/Integrationstests laufen zusätzlich mit `pnpm test:db` (siehe WP0.5). Schema-Änderungen immer mit `drizzle-kit generate` und Test im Stil von `tests/schema.test.ts`.

### Phase 0: Spikes, Zugänge und Fundament (Meilenstein M0: Annahmen geklärt, Grundlage steht, Anträge gestellt)

**WP0.0 Zugangs-Checkliste und Anträge vorbereiten**: Ziel: Anleitung `docs/setup/zugaenge.md` (Schritte, Redirect-URIs aus Abschnitt 1a, Scopes, Consent-Screen "In production", Brand-Accounts, TikTok-App, Azure-App für Personal Accounts, Audit-Formulare mit Textbausteinen/App-Beschreibung) und Statusliste. Der Nutzer legt die Konten an und meldet Domain/Keys; dieses Paket läuft parallel zu allen Wellen und blockiert nur die in 1a genannten Termine. Akzeptanz: Checkliste vollständig, jede Zeile mit Fälligkeits-Welle; beide Audits sind nach WP0.6 + WP4.2 beantragt oder Blocker dokumentiert. Abh.: keine (Nutzer-Aufgabe, Agent als Zuarbeiter). Agent: `technical-writer`, haiku/sonnet.

**WP0.1 API-Spikes (Recherche)**: Ziel: Annahmen aus Abschnitt 2 gegen aktuelle Offiziell-Doku/Sandbox prüfen: HeyGen Request/Response/Preis/Ablauf-URL **und Fähigkeit zu avatarloser Ausgabe (B-Roll, Voiceover, Untertitel, wörtliches Skript)** mit Ergebnis "ja/teilweise/nein"; bei "nein/teilweise" Vorschlag und Kostenrahmen für Fallback-Provider (z. B. TTS + Stock-Footage + ffmpeg-Untertitel); YouTube Quota/Audit/Synthetic-Flag/Verifizierungsprozess; TikTok Scopes/AIGC-Feld im Inbox-Modus/Metrik-Endpunkte/Audit-Checkliste und Sandbox-Demo; Microsoft Graph Upload-Session/Refresh-Rotation/Limits. Dateien: Ergebnis als Ergänzung in Abschnitt 10 dieses Plans bzw. Kommentar in `server/providers/types.ts`. Akzeptanz: je Anbieter 1 Seite Fakten mit Links, Abweichungen vom Plan markiert, Entscheidung zu WP1.11 (Fallback ja/nein) getroffen. Abh.: keine. Agent: `deep-research-agent`, Modell sonnet.

**WP0.2 Crypto + Secret-Store**: Ziel: `crypto.ts`, `secrets.ts`, Tabellen `settings_secret`, `project_secret` (aus WP0.3-Schema), `.env.example`, `docker-compose.yml` (`ENCRYPTION_KEY`), `nuxt.config.ts` runtimeConfig. Akzeptanz/Tests: Roundtrip, manipulierter Tag/Ciphertext wird abgelehnt, IV nie wiederverwendet, falscher Schlüssel schlägt fehl, Maskierung; **Key-Validierung lazy: Importieren/Test-Läufe/Build/Start ohne DB und ohne Key brechen nicht, erst Ver-/Entschlüsselung wirft; Start-Check nur im Plugin bei gesetzter `DATABASE_URL`**. Abh.: WP0.3. Agent: `backend-architect` (Impl.) + `security-engineer` (Review), Modell sonnet, Review opus.

**WP0.3 Schema-Grundlage + Plugin-Reihenfolge**: Ziel: komplettes Schema aus Abschnitt 4 (inkl. `settings_secret`, `project_secret`, `app_setting`, `notification`; keine weiteren Schemaänderungen in späteren Paketen ohne Absprache), Aufteilung `schema.ts` in `schema/*.ts`, Migration, Umbenennung `migrate.ts -> 00-migrate.ts`, cwd-unabhängiger `migrationsFolder` (Env `MIGRATIONS_DIR` + Fallback), `drizzle.config.ts` mit `schemaFilter: ['public']`, CHECK `ai_label = true`. Akzeptanz: Migration läuft in Test-DB und beim Start aus beliebigem cwd, Constraints (Unique Fingerprint, FK-Cascade, ai_label-CHECK) getestet, `drizzle-kit generate` erzeugt nichts für `pgboss`. Abh.: keine (läuft zuerst in W1; WP0.2 folgt). Agent: `backend-architect`, sonnet.

**WP0.4 Auth-Härtung Single-Tenant + Internet-Härtung**: Ziel: dynamische Signup-Sperre (Before-Hook/`databaseHooks.user.create.before`: nur wenn `user`-Tabelle leer oder `ALLOW_SIGNUP=true`), deny-by-default-Middleware für `/api/**` und Seiten mit Allowlist (`/`, `/login`, `/legal/*`, `/api/auth/**`, `/api/webhooks/**`, `/api/oauth/*/callback`, `/api/health`), Rate Limit auf Auth-Routen, Security-Header, `trustedOrigins`. Dateien: `server/utils/auth.ts`, `server/middleware/`. Die Allowlist ist eine zentrale Konstante, die WP4.2 erweitert. Akzeptanz: unauthentifizierte Requests 401, erster Nutzer kann sich registrieren, zweite Registrierung abgelehnt (ohne Neustart, ohne Konfigurationsänderung), mit `ALLOW_SIGNUP=true` erlaubt, Route-Enumerations-Test (alle registrierten Server-Routen außer Allowlist liefern 401), Rate-Limit-Test. Abh.: keine. Agent: `security-engineer`, sonnet.

**WP0.5 Test-Infrastruktur**: Ziel: Integrationstest-Setup mit echter Postgres (Compose-Dev-DB oder Testcontainer), Provider-Fakes-Gerüst, HTTP-Mock (z. B. `msw`/`undici MockAgent`) für Provider-Contracts, Helper für `ENCRYPTION_KEY` in Tests. **Verhalten ohne Postgres**: `pnpm test` führt Unit-Tests aus und **überspringt DB-Tests** (`describe.skipIf(!process.env.TEST_DATABASE_URL)` mit sichtbarer Skip-Meldung) und endet grün; `pnpm test:db` (Skript startet/erwartet Postgres, setzt `TEST_DATABASE_URL`) führt alles aus und schlägt ohne DB fehl (kein stilles Überspringen). `pnpm test:all` = beides. Dateien: `vitest.config.ts`, `package.json`, `tests/helpers/`. Akzeptanz: Beispiel-Integrationstest läuft mit `pnpm test:db`, wird mit `pnpm test` ohne DB sauber übersprungen; CI-Befehl dokumentiert. Abh.: WP0.3. Agent: `quality-engineer`, sonnet.

**WP0.6 Erst-Deployment (Coolify, Domain, HTTPS)**: Ziel: lauffähiges Deployment mit eigener Domain und HTTPS hinter Login (Compose/Coolify-Konfiguration, Env inkl. `ENCRYPTION_KEY`, `BETTER_AUTH_URL`, Volume `/data/videos`, Healthcheck), erster Nutzer wird angelegt, danach Registrierung gesperrt; öffentliche Rechtsseiten erreichbar. Dies ist Voraussetzung für OAuth-Redirects und Audit-Anträge. Akzeptanz: Smoke-Test von außen (Login nötig, `/legal/*` offen, übrige Routen 401/Redirect, Rate Limit greift), Migration beim Containerstart. Abh.: WP0.2, WP0.4, WP4.2, Domain aus WP0.0. Agent: `devops-architect`, sonnet.

### Phase 1: Kern-Engine (M1: Idee -> Skript -> Freigaben -> Video mit Fakes End-to-End)

**WP1.1 Provider-Interfaces + Registry**: Ziel: `types.ts` (Methoden: `generateTopics`, `generateScript`, `generatePlatformMeta`, `createVideo`, `getVideoStatus`, `publish`, `fetchMetrics`, Storage `put/get/stream/delete/move`, überall `testConnection`; Fehlerklassen), Registry mit Credential-Auflösung (Projekt -> global). `createVideo` kennt `visualMode` (`faceless`|`avatar`). Akzeptanz: Fakes erfüllen die Interfaces; Registry-Tests zu Fallback und fehlendem Key. Abh.: WP0.2, WP0.3. Agent: `system-architect`, Modell opus (Interface-Design ist langlebig).

**WP1.2 pg-boss-Integration**: Ziel: Boss-Start/Stop im Nitro-Plugin `10-boss.ts` (nach `00-migrate.ts`), Queue-Definitionen (Abschnitt 3), Retry/Backoff/Dead-Letter, Cron-Registrierung, Graceful Shutdown. Dateien: `server/jobs/`, `server/plugins/10-boss.ts`. Akzeptanz: Integrationstest (Job läuft, Retry greift, nach Limit `failed`), Plugin-Reihenfolge getestet (Boss startet erst nach Migration), App startet ohne `DATABASE_URL` weiterhin ohne Crash (Test-Modus). Abh.: WP0.5. Agent: `backend-architect`, sonnet.

**WP1.3 Video-Zustandsautomat**: Ziel: `video-state.ts` mit vollständiger Übergangstabelle aus Abschnitt 3 (script-Gate, `rejected -> scripting|rendering`, `failed -> resume_status`, `paused_budget -> resume_status`, `partially_uploaded`) + `video_event`. Akzeptanz: unzulässige Übergänge werfen, Tabellen-/Property-Tests aller Übergänge, Gate an/aus, `resume_status` wird gesetzt und beim Zurückkehren geleert. Abh.: WP0.3. Agent: `backend-architect`, sonnet.

**WP1.4 CostGuard**: Ziel: `reserve/commit/release`, Reaper für abgelaufene Reservierungen, Tages-/Monatsfenster in Projektzeitzone, **globales Monatslimit**, Pausieren (Projekt und global), Wiederaufnahme. Akzeptanz: Tests für Grenzfälle (exakt am Limit, parallele Reservierungen, Monatswechsel, Retry zählt Kosten genau einmal, `release` bei Fehler vor dem Call, `estimated` vs. Ist, globales Limit greift vor Projektlimit, Projekt-Summe über Limit blockiert trotz globalem Spielraum). Abh.: WP0.3. Agent: `backend-architect`, sonnet (Review `quality-engineer`).

**WP1.5 Themen-Service + Deepseek-Provider**: Ziel: Batch-Vorschlag (N Themen, Ausschlussliste aus bestehenden `topic`), Normalisierung + Fingerprint, Dopplungsfilter, Annehmen/Ablehnen (Pflichtschritt). Provider spricht Deepseek per OpenAI-kompatibler Chat-API (Base-URL/Modell konfigurierbar, JSON-Ausgabe mit `zod` validiert), Token-Kosten aus `usage`, `testConnection`. Akzeptanz: Contract-Test mit aufgezeichneten Antworten, Duplikate werden verworfen, ungültiges JSON -> Retry, CostGuard reserve/commit/release korrekt. Abh.: WP1.1, WP1.2, WP1.4. Agent: `backend-architect`, sonnet.

**WP1.6 Skript-Service + Plattform-Metadaten**: Ziel: aus freigegebenem Thema Skript (Projektsprache, Stil-Prompt, Zielsekunden 30-45) und je Kanal `publication`-Metadaten (Titel/Beschreibung/Hashtags plattformspezifisch); Längenprüfung; Übergang `script_ready` -> `awaiting_script_approval` oder `rendering` je `script_approval_required`; bei Ablehnung mit Grund neu generieren. Akzeptanz: Fake-LLM-Tests, Sprach-/Längenregeln, Gate an/aus, YouTube-Meta enthält `#Shorts`, Metadaten-Längenlimits je Plattform. Abh.: WP1.3, WP1.5. Agent: `backend-architect`, sonnet.

**WP1.7 HeyGen-Provider + Render-Job**: Ziel: `createVideo` (Prompt mit wörtlichem Skript, `orientation: portrait`; **avatarlos, wenn `heygen_avatar_id` NULL**, mit Prompt-Anweisungen für B-Roll + eingebrannte Untertitel und `visual_style_prompt`; Voice aus Projekt), Polling-Job (2-stufig) plus optionaler Webhook-Endpoint mit Signatur-/Secret-Prüfung, Download in Medienspeicher (WP1.9), Kostenerfassung, `testConnection`. Akzeptanz: Contract-Tests gegen gemockte HeyGen-Antworten (Erfolg, `failed`, Timeout, 429/5xx -> Retry, 4xx -> fatal), kein Doppel-Render bei Job-Retry (Idempotenz über `heygen_session_id`), avatarloser und Avatar-Prompt getestet, CostGuard-`release` bei Fehler vor Absenden. Abh.: WP0.1, WP1.1-1.4, WP1.9. Agent: `backend-architect`, sonnet.

**WP1.8 Orchestrierung Produktionsschleife**: Ziel: Cron/Trigger, der pro Projekt genehmigte Themen in Skript- und Render-Jobs überführt (1 Video/Tag/Projekt Richtwert über `schedule_rule`/Puffer), solange Budget (Projekt + global) und Puffer (`max_videos_in_review`) es erlauben; berücksichtigt Skript-Gate. Akzeptanz: Integrationstest mit Fakes: Thema -> `awaiting_review` (mit und ohne Skript-Gate); Budget voll -> `paused_budget` und Rückkehr in den richtigen Zustand nach Fortsetzen; Retry-Limit -> `failed`, manueller Retry setzt fort. Abh.: WP1.5-1.7, WP1.9, WP1.10. Agent: `backend-architect`, sonnet.

**WP1.9 Storage-Interface + Local-Storage + Puffer-Cleanup**: Ziel: `StorageProvider`-Interface, `LocalStorage` (`/data/videos`, Pfad-Traversal-sicher, Range-Stream), Registry-Anbindung, `media.cleanup`-Job (nur bereits archivierte oder verwaiste lokale Dateien, Frist `local_buffer_retention_days`, Warnung bei knappem Speicher), `media.archive`-Job-Gerüst (Verschieben `local -> onedrive` über Interface, Löschen erst nach bestätigtem Upload). Akzeptanz: Tests mit Fake-Remote-Storage (Archivieren, Fehlerfall behält lokal, Cleanup löscht nichts Unarchiviertes, Traversal wird abgewiesen). Abh.: WP0.3, WP1.1, WP1.2. Agent: `backend-architect`, sonnet.

**WP1.10 Notification-Service + 80-%-Kostenalarm**: Ziel: `notifications.ts` (anlegen mit `dedupe_key`, lesen, als gelesen/erledigt markieren, API-Endpunkte), Job `cost.alert`: Schwellen bei 80 % (und 100 % = Pause) für Projekt-Tag, Projekt-Monat und globales Monatslimit, jeweils einmal je Fenster. Ereignisquellen für Budgetpause, Token abgelaufen, Job endgültig fehlgeschlagen, Archivierung fehlgeschlagen werden angebunden (Panel-Banner; externe Kanäle in WP6.4). Akzeptanz: 80 % löst genau eine Notification aus, Wiederholung wird dedupliziert, Fensterwechsel setzt zurück, Tests mit CostGuard-Fixtures. Abh.: WP0.3, WP1.2, WP1.4. Agent: `backend-architect`, sonnet.

**WP1.11 Fallback-VideoProvider (bedingt)**: Ziel: Nur falls WP0.1 avatarlose HeyGen-Ausgabe verneint oder als unzureichend bewertet: `fallback-video`-Provider hinter `VideoProvider` (TTS-Voiceover + Stock-/Generiertes B-Roll + ffmpeg-Komposition mit eingebrannten Untertiteln, 9:16). Beinhaltet `ffmpeg` im Docker-Image, Kostenerfassung je Dienst und `testConnection`. Auswahl pro Projekt über `project.video_provider`. Akzeptanz: Contract-/Fake-Tests gegen dasselbe Interface wie HeyGen, Videolänge/Format geprüft, Lizenz-/Quellenhinweis für Stock-Material dokumentiert. Abh.: WP0.1 (Entscheidung), WP1.1, WP1.4, WP1.9. Agent: `backend-architect`, sonnet (Architekturentscheid bei Bedarf `system-architect` opus).

### Phase 2: Panel-UI Kern (M2: Bedienbares Panel ohne Upload)

Parallel zu Phase 1 ab Vorliegen der API-Verträge (WP2.0).

**WP2.0 API-Verträge**: Ziel: Zod-Schemas/Typen für alle Panel-Endpunkte (Projekte, Themen, Videos, Publications, Settings, Notifications) in `server/api/**` + geteilte Typen in `shared/`. Akzeptanz: Typecheck, Verträge reviewt. Abh.: WP0.3. Agent: `system-architect`, sonnet.

**WP2.1 Projekt-CRUD + Einstellungen (API+UI)**: Seiten `projects/*`, `settings` (globale Keys inkl. OneDrive-Verbindung-Platzhalter, maskiert, editierbar), Projekt-Overrides, Sprache, Budget (Projekt Tag/Monat; globales Monatslimit in Settings), **Schalter "Skriptfreigabe erforderlich" (Standard an)**, Avatar optional (leer = avatarlos), Wochenplan-Editor. Der Test-Verbindung-Knopf ist **nicht** Teil dieses Pakets (siehe WP2.5). Akzeptanz: Secrets nie im Response, Validierung (Zielsekunden 30-45), Komponententests (happy-dom). Abh.: WP0.2, WP2.0. Agent: `frontend-architect` (UI) + `backend-architect` (API), sonnet.

**WP2.2 Themen-UI**: Batch erzeugen, Liste mit Annehmen/Ablehnen (Mehrfachauswahl), Verlauf. Abh.: WP1.5, WP2.0. Agent: `frontend-architect`, sonnet.

**WP2.3 Videoliste + Skript-Review + Video-Review**: Pipeline-Statusübersicht (Filter, Zustände inkl. `awaiting_script_approval`, `partially_uploaded`, `paused_budget`, `failed`); **Skript-Review** (Skript editierbar, Freigeben / Ablehnen mit Grund -> neues Skript); **Video-Review**: Player (Vorschau lokal per Range-Stream oder aus OneDrive per Proxy), Download-Button, Plattform-Titel/Beschreibung/Hashtags je `publication` editierbar (KI-Kennzeichnung angezeigt, nicht abschaltbar), Freigeben/Ablehnen (mit Grund; Aktionen "neues Skript" oder "Neu-Rendern, kostenpflichtig mit Bestätigung"), `publish_at`-Override, manueller Retry bei `failed`/Teil-Upload. Akzeptanz: nur `awaiting_script_approval`/`awaiting_review` freigebbar; Skript-Freigabe -> `rendering`, Video-Freigabe -> `scheduled`; Metadaten-Edit setzt `meta_edited`. Abh.: WP1.3, WP1.9, WP2.0 (Render-Status nur über API-Verträge). Agent: `frontend-architect`, sonnet.

**WP2.4 Kosten-Ansicht + Banner**: Kosten pro Video/Projekt, Tages-/Monatsverbrauch gegen Projekt- und globales Limit, Pausen-Banner mit Fortsetzen, **Panel-Banner für Notifications** (Kostenalarm 80 %, Budgetpause, Token abgelaufen, Fehler). Abh.: WP1.4, WP1.10. Agent: `frontend-architect`, sonnet.

**WP2.5 Test-Verbindung-Knopf**: Ziel: UI-Knopf je Provider/Key (Deepseek, HeyGen bzw. Fallback, YouTube/TikTok-Kanal, OneDrive) in Settings/Projekt, ruft `testConnection()` der echten Implementierungen über die Registry; zeigt Ergebnis ohne Secrets. Akzeptanz: Komponententest mit Fakes, Fehlerfall (Key falsch, Token abgelaufen) verständlich. Abh.: WP2.1, WP1.5, WP1.7, WP3.2, WP3.5, WP4.1 (und WP1.11 falls umgesetzt). Agent: `frontend-architect`, haiku/sonnet.

### Phase 3: Veröffentlichung (M3: Freigegebenes Video landet auf YouTube, Datei archiviert in OneDrive)

**WP3.1 OAuth-Framework + Kanalverbindung**: Ziel: generischer OAuth-Flow (State + PKCE, Callback-Routen `/api/oauth/{youtube,tiktok,onedrive}/callback`), Tokens verschlüsselt, Refresh-Service mit Sperre gegen parallele Refreshs, atomare Speicherung rotierter Refresh-Tokens, Status `expired` -> Notification + UI-Hinweis. **Google-Consent-Screen**: Anleitung/Check, dass das Projekt auf "In production" steht (Testing = Refresh-Token verfällt nach 7 Tagen); Erkennung von `invalid_grant` -> `expired` + Notification; Dokumentation der Google-App-Verifizierung getrennt vom YouTube-API-Compliance-Audit. Akzeptanz: State-Manipulation wird abgewiesen, Tokens nie im Log/Response, Refresh-Tests (abgelaufen, widerrufen, `invalid_grant`, parallele Refreshs). Abh.: WP0.2, WP0.4, WP1.1, WP1.10. Agent: `security-engineer`, Modell opus (kritisch), Impl. sonnet.

**WP3.2 YouTube-Publisher**: Ziel: Resumable Upload aus Datei, Titel/Beschreibung/Tags aus `publication`, Shorts-Konventionen, `containsSyntheticMedia` immer true, Kind-Einstellung ("made for kids" = nein). Sichtbarkeit `private` solange nicht auditiert (`channel.youtube_visibility`, Schalter pro Kanal; Panel zeigt Hinweis). `testConnection`. Akzeptanz: Mock-Contract-Tests (Resumable-Ablauf, 401 -> Refresh, quotaExceeded -> verschieben statt Retry-Sturm, Synthetic-Flag gesetzt). Abh.: WP3.1, WP0.1. Agent: `backend-architect`, sonnet.

**WP3.3 Slot-Scheduler + Upload-Job**: Ziel: `scheduler.tick`, Slotvergabe aus `schedule_rule` (DST-sicher) mit Override, Upload-Job je `publication` über die Registry (YouTube und TikTok, sobald deren Provider existieren), Upload aus lokaler Datei (aus OneDrive zurückladen, falls lokal fehlend), Teil-Erfolg: ein Kanal ok, anderer failed -> `partially_uploaded`, getrennt wiederholbar; nach vollständigem Erfolg Auslösen von `media.archive` (Verschieben ins OneDrive, lokal löschen). Akzeptanz: Zeitzonen-/DST-Tests, kein Doppel-Upload (Idempotenz via `publication`), Teil-Upload-Test (ein Kanal fehlschlagen lassen, Wiederholung betrifft nur diesen), Archivierung nach Erfolg, Fehlerstatus sichtbar. Abh.: WP1.2, WP1.3, WP1.9, WP1.10, WP3.2. Agent: `backend-architect`, sonnet.

**WP3.4 Planungs-UI + Publikationsstatus**: Wochenplan-Ansicht, Kalender der Slots, Publikationsstatus je Kanal, Fehler/Wiederholen-Aktionen (je `publication`). Abh.: WP3.3. Agent: `frontend-architect`, sonnet.

**WP3.5 OneDrive-Storage (Microsoft Graph)**: Ziel: `OneDriveStorage` hinter `StorageProvider`: OAuth gegen Tenant `consumers` (über WP3.1-Framework), Refresh-Token verschlüsselt mit Rotation, Upload-Session mit Chunks (Vielfache von 320 KiB), Fortsetzung nach Abbruch, Größen-/Hash-Prüfung, Ordnerstruktur `<Projekt>/<Jahr-Monat>/`, Download/Proxy-Stream für Vorschau/Download, Throttling-Backoff (429/`Retry-After`), `testConnection`. Aktivierung in Settings. Akzeptanz: Mock-Contract-Tests (Upload-Session, Chunk-Fehler -> Resume, 401 -> Refresh mit Rotation, 429), lokale Datei wird erst nach bestätigter Verifikation gelöscht. Abh.: WP0.2, WP1.9, WP3.1, Azure-App aus WP0.0. Agent: `backend-architect`, sonnet.

### Phase 4: TikTok (M4: TikTok-Entwurf; später Direct Post)

**WP4.1 TikTok-Publisher Inbox-Modus**: Ziel: Upload als Entwurf (`video.upload`), Statusabfrage, Entwurfs-Limit beachten (Warnung im Panel: Nutzer muss Entwurf in der App veröffentlichen und dort das KI-Label setzen, falls API es im Inbox-Modus nicht setzt; WP0.1-Ergebnis), `testConnection`. Der Provider wird von der Registry geliefert; der Upload-Job aus WP3.3 nutzt ihn ohne eigene Anpassung. Akzeptanz: Mock-Contract-Tests inkl. Chunk-Upload, Token-Refresh, Limit-Fehler. Abh.: WP3.1, WP1.1 (nicht mehr WP3.3). Agent: `backend-architect`, sonnet.

**WP4.2 Öffentliche Rechtsseiten (Audit-Vorbereitung)**: Ziel: `/legal/privacy`, `/legal/terms`, `/legal/imprint` (öffentlich, ohne Login, in der Allowlist aus WP0.4) mit **Platzhaltern** (Betreiber: Privatperson, Texte liefert der Nutzer; klar markierte `[[PLATZHALTER]]`), Beschreibung des tatsächlichen Datenflusses (OAuth-Scopes, Speicherung verschlüsselter Tokens, Medien in OneDrive, Löschung/Token-Widerruf), Landingpage `index.vue` mit Zweck der App (öffentlich, ohne Login, keine internen Daten). Akzeptanz: ohne Login erreichbar, Platzhalter-Check (Test oder Lint warnt, solange Platzhalter im Produktions-Build vorhanden sind; Warnung, kein Build-Abbruch), Inhalte entsprechen dem Datenfluss (Texte vom Nutzer final freizugeben, keine Rechtsberatung). Abh.: WP0.4 (Allowlist). Agent: `technical-writer` + `frontend-architect`, haiku/sonnet.

**WP4.3 Direct-Post-Modus + Audit-UX**: Ziel (nach bestandenem Audit; UX vorab bauen, damit das Demo-Video fürs Audit aufgenommen werden kann): `creator_info` abfragen, Privacy-Auswahl, Disclosure-Toggles (KI-generiert/AIGC immer an, nicht abschaltbar), vorherige Nutzerzustimmung je Post im Review, Hinweis "Posted by". Umschalter `tiktok_mode` pro Kanal. Akzeptanz: Checkliste gegen TikTok-UX-Richtlinien abgehakt; Mock-Tests beider Modi. Abh.: WP4.1, WP4.2, WP2.3, externer Auditentscheid. Agent: `frontend-architect` + `backend-architect`, sonnet.

### Phase 5: Kennzahlen (M5: Dashboard mit Views/Likes)

**WP5.1 Metrics-Sync (YouTube)**: Ziel: täglicher Job je `publication` (YouTube `videos.list`), Snapshots, Fehlertoleranz (ein Anbieter down -> andere laufen), generische `MetricsProvider`-Anbindung, die WP5.3 ohne Änderung nutzt. Akzeptanz: Mock-Tests, Idempotenz je Tag, Quota-schonend (Batch bis 50 IDs). Abh.: WP3.2, WP0.1, WP1.2 (keine Abhängigkeit mehr von WP4.1). Agent: `backend-architect`, sonnet.

**WP5.2 Kennzahlen-UI**: Tabellen/Verläufe pro Video und Projekt, Summen, Zeitraumfilter, Kennzeichnung der Datenquelle (`api`/`manual`), Eingabemaske für manuelle TikTok-Zahlen falls API nicht verfügbar. Abh.: WP5.1, WP5.3. Agent: `frontend-architect`, sonnet.

**WP5.3 TikTok-Metriken**: Ziel: `MetricsProvider` für TikTok soweit per API verfügbar (Ergebnis aus WP0.1, Scopes `video.list`/`user.info.stats`; für Inbox-Entwürfe ggf. nicht verfügbar), sonst Fallback manuelle Erfassung (`metric_snapshot.source = manual`) und Hinweis im Panel. Akzeptanz: Mock-Tests, klares Verhalten bei nicht verfügbaren Metriken (kein Fehler-Sturm), Zuordnung `publication.external_post_id` nach Veröffentlichung aus der Inbox (sofern ermittelbar). Abh.: WP4.1, WP0.1, WP5.1 (gemeinsames Gerüst). Agent: `backend-architect`, sonnet.

### Phase 6: Härtung und Abnahme (M6: Betriebsbereit)

**WP6.1 Security-Review**: Secrets-Handling, OAuth (Google, TikTok, Microsoft), Webhook-Authentizität, Pfad-/Range-Zugriff auf Videos und Proxy-Stream aus OneDrive, SSRF bei Download-URLs (HeyGen `video_url`), Log-Hygiene, Rate Limit auf Login, Signup-Sperre unter Last/Race (zwei parallele Erst-Registrierungen), Route-Enumerations-Test, Security-Header, Öffentlichkeit nur Rechtsseiten/Landing. Agent: `security-engineer`, opus.

**WP6.2 Betrieb**: Compose (`ENCRYPTION_KEY`, Volume `/data/videos`, Healthcheck-Route), Backup-Hinweis (Schlüsselverlust = Secrets unwiederbringlich; OneDrive-Token neu verbinden), Coolify-Doku, Logging, Admin-Seite "Jobs" (Queue-Stand, fehlgeschlagene Jobs), Speicherplatz-/Puffer-Monitoring. Agent: `devops-architect`, sonnet.

**WP6.3 E2E-Abnahme + Doku**: Gesamtlauf mit Fakes, danach Live-Smoke mit Testkonto (1 Video, YouTube privat, TikTok-Entwurf, OneDrive-Archivierung, lokale Datei gelöscht). README/Betriebsdoku auf Deutsch. Agent: `quality-engineer` + `technical-writer`, sonnet.

**WP6.4 Externe Benachrichtigungen (E-Mail oder n8n-Webhook)**: Ziel: Zustellkanal(e) für `notify.deliver`: SMTP-E-Mail und/oder Webhook (n8n), konfigurierbar in Settings (Secret verschlüsselt), Ereignisse: Budgetpause, Kostenalarm 80 %, Token abgelaufen, Job endgültig fehlgeschlagen (plus Archivierungsfehler/Speicher knapp). Retry mit Backoff, Deduplizierung über `dedupe_key`, Test-Nachricht-Knopf. Akzeptanz: Mock-Tests (Erfolg, Fehler -> Retry, kein Doppelversand), Webhook-Payload ohne Secrets. Abh.: WP1.10, WP0.2, WP2.4. Agent: `backend-architect`, sonnet.

## 7. Abhängigkeitsgraph und Wellen

Wellen sind parallel ausführbar; Pakete einer Welle dürfen nicht dieselben Dateien ändern. Das komplette Schema entsteht in WP0.3 (W1); spätere Pakete ändern Schema-Dateien nur in Absprache (sonst Migrationskonflikte). WP0.0 ist eine Nutzer-Aufgabe, die über alle Wellen läuft; die Fälligkeiten stehen in Abschnitt 1a.

| Welle | Pakete (parallel) | Voraussetzung |
|---|---|---|
| W1 | WP0.0, WP0.1, WP0.3, WP0.4 | keine |
| W2 | WP0.2, WP0.5, WP2.0, WP4.2 | WP0.3 (WP4.2: WP0.4) |
| W3 | WP0.6, WP1.1, WP1.2, WP1.3, WP1.4, WP2.1 | W2 (WP0.6: Domain aus WP0.0) |
| W4 | WP1.5, WP1.9, WP1.10, WP3.1 | W3 |
| W5 | WP1.6, WP1.7, WP1.11 (bedingt), WP2.2, WP2.3, WP2.4, WP3.2, WP3.5, WP4.1 | W4 (WP1.7 braucht WP0.1 und WP1.9; WP1.11 braucht Entscheid aus WP0.1 und WP1.9) |
| W6 | WP1.8, WP3.3, WP5.1, WP5.3, WP2.5 | W5 |
| W7 | WP3.4, WP5.2 | W6 |
| W8 | WP4.3 (nach Audit), WP6.1, WP6.2, WP6.4 | W7 |
| W9 | WP6.3 | W8 |

Meilensteine: M0 nach W2 (Annahmen geklärt, Schema, Test-Infrastruktur; Domain/Anträge laufen), M1 nach W6 (Fakes-E2E inkl. Gates), M2 nach W5 (UI bedienbar; Review-/Gate-Flows), M3 nach W6/W7 (YouTube live privat + OneDrive-Archivierung), M4 nach W6 (TikTok-Entwurf über WP3.3 + WP4.1), M5 nach W7, M6 nach W9. Kritischer Pfad: WP0.3 -> WP1.1 -> WP1.9 -> WP1.7 -> WP1.8 -> WP3.3 -> WP3.4; extern lange laufend (früh starten): beide Audits, Domain/Hosting, Developer-Konten, Azure-App.

Orchestrierung durch die Hauptsession: pro Welle alle Pakete in einer Nachricht als Subagents starten (je Paket `/sc:implement`-Stil-Prompt mit Ziel, Dateien, Akzeptanz; QA-Paket nach jeder Welle `quality-engineer` mit `/sc:test`), Ergebnisse zusammenführen, bei Konflikten Welle serialisieren. Nach jeder Aufgabe: graphify aktualisieren, committen, pushen (Nutzerregel).

## 8. Teststrategie

- **Zwei Testebenen**: `pnpm test` = Unit/Komponenten/Contract-Tests ohne Postgres (DB-Tests werden mit klarer Meldung übersprungen, Exit-Code 0). `pnpm test:db` = zusätzlich Integrationstests mit echter Postgres + pg-boss (kein stilles Überspringen, schlägt ohne DB fehl). `pnpm test:all` = beides. CI führt `test:all` aus.
- **Unit**: Crypto (lazy Key), Zustandsautomat (inkl. Gate, Resume-Pfade), CostGuard (reserve/commit/release, globales Limit), Themen-Fingerprint, Zeitplanlogik (DST), Secret-Auflösung, Notification-Dedupe.
- **Provider-Contract-Tests**: HTTP-Mocks mit aufgezeichneten/handgeschriebenen Antworten je Anbieter (Erfolg, 4xx, 429, 5xx, Timeout, kaputtes JSON); gleiche Suite läuft gegen die Fakes, damit Interface-Verträge einheitlich bleiben (LLM, Video, Publisher, Metrics, Storage). Keine echten API-Calls in CI.
- **Integration (`test:db`)**: echte Postgres + pg-boss + Fake-Provider: Pipeline von Thema bis `uploaded` und Archivierung (mit/ohne Skript-Gate), Retries, Budget-Pause und Rückkehr, Teil-Upload, Idempotenz bei Doppelzustellung, Plugin-Reihenfolge und Migration aus abweichendem cwd.
- **API/Security**: Auth-Guard (401), Route-Enumeration, Signup-Sperre, Rate Limit, Secrets nie in Responses/Logs, OAuth-State, Webhook-Signatur.
- **UI**: Komponententests (happy-dom) für Review (Skript + Video), Settings, Themenliste; manueller Smoke im Browser pro Phase.
- **Live-Smoke (manuell, optional)**: je Anbieter 1 Call mit Testkonto, Kostenobergrenze per Projektlimit.

## 9. Risiken und Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| TikTok-Audit dauert/scheitert | Nur Entwürfe bzw. nur privat posten | Inbox-Modus von Anfang an (Entscheidung 2); Rechtsseiten früh (WP4.2) und Deployment früh (WP0.6); Audit-UX in WP4.3 vorab bauen; Fallback: manuelles Veröffentlichen aus Entwurf |
| YouTube-Audit/Privatzwang | Uploads bleiben privat | Audit-Antrag sofort nach WP0.6/WP4.2; bis dahin Sichtbarkeit manuell in Studio umstellen (Panel zeigt Hinweis) |
| Google-Consent-Screen im Status "Testing" | Refresh-Token verfällt nach 7 Tagen, Kanal wird ständig `expired` | Auf "In production" stellen (WP3.1, WP0.0); `invalid_grant`-Erkennung + Notification; Google-App-Verifizierung getrennt vom YouTube-Audit planen |
| HeyGen kann nicht avatarlos / schlechte B-Roll-Qualität | Kernfunktion (Entscheidung 1) fehlt | WP0.1-Spike mit Ja/Nein, Fallback-Provider WP1.11 hinter demselben Interface, Avatar optional als Rückfallmodus |
| HeyGen-Details unklar (Länge, Skripttreue, Kosten, URL-Ablauf, Limits) | Falsche Videos, Kostenabweichung | WP0.1-Spike, wörtliches Skript im Prompt, Dauer-/Transkript-Plausibilisierung, Kosten als `estimated` markieren und gegen Guthaben abgleichen, Video sofort lokal speichern |
| Plattformregeln für KI-Content | Reichweitenverlust/Sperre | KI-Kennzeichnung immer an (DB-CHECK + Publisher); menschliche Freigaben (Thema, Video); keine Täuschung über reale Personen; Richtlinien (Spam/"inauthentic content", Wiederholungsinhalte) vor Start prüfen, Varianz in Prompts erzwingen, plattformspezifische Metadaten |
| Kostenexplosion (Retry-Schleifen, Neu-Rendern) | Unerwartete Rechnung | Reservierung mit Commit/Release, harte Tages-/Monatslimits je Projekt plus globales 150-USD-Limit, Retry-Limit, kein automatisches Neu-Rendern, Puffergrenze `awaiting_review`, Alarm bei 80 % (WP1.10) |
| Hängende Reservierungen nach Absturz | Budget fälschlich blockiert | `reservation_expires_at` + Reaper, Tests |
| Token-/Secret-Leck | Kontoübernahme | AES-GCM, Maskierung, Log-Filter, kein Secret im Client, Security-Review (WP6.1) |
| Verlust von `ENCRYPTION_KEY` | Alle Secrets unbrauchbar | Dokumentierte Sicherung außerhalb der DB; Re-Eingabe-Flow in UI |
| Panel im Internet erreichbar | Angriffsfläche (Brute Force, offene Routen, Fremdregistrierung) | Login-Pflicht, deny-by-default, Rate Limit, dynamische Signup-Sperre, Security-Header, Route-Enumerations-Test, Review WP6.1 |
| Verlust/Fehler beim Verschieben ins OneDrive | Video weg | Lokal löschen erst nach verifiziertem Upload (Größe/Hash), Retry + Notification, Cleanup nur bereits Archiviertes; Refresh-Token-Rotation atomar speichern |
| OneDrive-Token ungültig (Rotation, Widerruf, Passwortänderung) | Archivierung stoppt, lokaler Puffer läuft voll | Notification, Speicher-Warnung, Neuverbinden-Flow, Produktion pausiert optional bei Puffer voll |
| Lokaler Zwischenspeicher läuft voll | Render-/Download-Fehler | `media.cleanup`, Speicher-Monitoring (WP6.2), `max_videos_in_review` |
| Nitro-Plugin-Reihenfolge/cwd | Boss startet vor Migration, Migration findet Ordner nicht | Präfixe `00-`/`10-`, cwd-unabhängiger `MIGRATIONS_DIR`, Tests (WP0.3, WP1.2) |
| pg-boss im App-Prozess | Jobs stoppen beim Deploy | Graceful Shutdown, idempotente Handler, Single-Replika; bei Wachstum separater Worker-Prozess |
| API-Änderungen (Quota, Preise) | Brüche | Provider-Interfaces, Contract-Tests, Konfig statt Hardcode |
| Rechtstexte nur Platzhalter | Audit scheitert/Impressumspflicht verletzt | Hinweis im Build/Admin, Abnahme erst mit vom Nutzer gelieferten Texten |

## 10. Offene Punkte

Geklärt durch das Interview (Abschnitt 0): Domain/Hosting-Pflicht (Domain wird benötigt, Beschaffung in WP0.0), Rechtstexte (Nutzer liefert), Videos/Tag und Budgets, Medien-Retention (OneDrive ohne Frist; lokaler Puffer), Benachrichtigungen (Banner, später E-Mail/Webhook), Kanalpaare (UI 1+1, Modell offen).

Weiterhin offen:
1. Konkrete Domain/URL und Coolify-Host (Nutzer, WP0.0), da OAuth-Redirects und Audits stabile URLs brauchen.
2. HeyGen: Ergebnis des Avatarlos-Spikes (WP0.1), Voice-Strategie pro Sprache, wörtliche Skriptübernahme und Videolänge, Webhook vs. Polling; bei negativem Ergebnis Auswahl der Bausteine für WP1.11 (TTS, Stock-Quelle, Lizenz).
3. TikTok: Metrik-Zugriff (Views/Likes) für eigene Posts per API verfügbar? AIGC-Label im Inbox-Modus per API setzbar? Audit-Demo in Sandbox möglich? (WP0.1, WP5.3)
4. Deepseek-Modellname/Endpoint und Kosten pro Token (konfigurierbar halten).
5. Genaue lokale Puffergröße/Aufbewahrungstage (Vorschlag 7 Tage, Standard `local_buffer_retention_days`) und freier Speicher auf dem Coolify-Host.
6. Externer Benachrichtigungskanal in WP6.4: E-Mail (SMTP-Zugang) oder n8n-Webhook oder beides.
7. Endgültige Rechtstexte inkl. Impressumsdaten (Nutzer), Freigabe vor Audit-Einreichung.
8. Ordnerstruktur und Benennung in OneDrive (Vorschlag `<Projekt>/<Jahr-Monat>/<video-id>.mp4`).

## 11. Definition of Done

- Alle Pakete der Phasen 0-6 erfüllen ihre Akzeptanzkriterien; `pnpm test` (Unit, ohne Postgres, DB-Tests sichtbar übersprungen) und `pnpm build` sind grün; **`pnpm test:db` (inkl. Integrationstests mit Postgres) ist grün und läuft in CI**; Migrationen laufen auf leerer DB, beim Containerstart und aus beliebigem cwd.
- Ein Projekt durchläuft mit echten Konten den Weg Thema wählen (Pflicht) -> Skript (mit Freigabe, solange Schalter an) -> HeyGen-Video (avatarlos als Standard, oder über Fallback-Provider) -> Review/Freigabe (Pflicht) -> Upload (YouTube; TikTok mindestens als Entwurf) mit plattformspezifischen, editierbaren Metadaten -> Verschieben ins OneDrive und lokales Löschen -> Kennzahlen sichtbar (TikTok-Zahlen ggf. manuell).
- KI-Kennzeichnung ist auf beiden Plattformen immer gesetzt und nicht abschaltbar (DB-CHECK, Publisher-Tests).
- Budgetlimits (Projekt Tag/Monat und globales Monatslimit) pausieren nachweislich die Produktion mit korrektem Rückkehrzustand; Reservierungen werden bei Fehlern freigegeben; 80-%-Alarm erscheint als Banner; Retries sind begrenzt; Fehler sind im Panel sichtbar und manuell wiederholbar (inkl. Teil-Upload je Kanal).
- Alle Secrets (inkl. OAuth- und OneDrive-Tokens) verschlüsselt in der DB, nirgends im Log oder Client-Response; Security-Review ohne offene kritische Funde.
- Panel ist über HTTPS-Domain erreichbar, hinter Login; nur Rechtsseiten und Landingpage sind öffentlich; Signup nach erstem Nutzer gesperrt; Rate Limit aktiv; Route-Enumerations-Test grün.
- Öffentliche Rechtsseiten erreichbar (Platzhalter durch Nutzer-Texte ersetzt oder als offener Punkt dokumentiert); TikTok-/YouTube-Audit beantragt (Bestehen ist keine DoD-Bedingung, aber Modus-Umschalter vorhanden); Google-OAuth-Consent-Screen steht auf "In production".
- Externe Benachrichtigung (E-Mail oder Webhook) für Budgetpause, Token abgelaufen und endgültig fehlgeschlagene Jobs funktioniert.
- Compose/Coolify-Deployment dokumentiert (Env-Variablen inkl. `ENCRYPTION_KEY`, Volumes, Backup, OneDrive-/Azure-Einrichtung).
- Deutsche Betriebsdoku und aktualisierter graphify-Graph sind committet und gepusht.
