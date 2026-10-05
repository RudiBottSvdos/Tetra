# Umsetzungsplan: Faceless-Social-Media-Panel

Stand: 2026-10-05. Basis: bestehendes Nuxt-4-Setup (Nuxt UI 4, Drizzle/Postgres, Better Auth, Vitest, Docker/Coolify, Migration per Nitro-Plugin `server/plugins/migrate.ts`). Dieser Plan ändert keinen Code.

## 1. Ziel und Rahmen

Single-Tenant-Panel, das für Projekte (Kanalpaar TikTok + YouTube Shorts) vollständig KI-generierte Kurzvideos produziert: Deepseek (Themen, Skripte) -> HeyGen Video Agent (Video) -> manuelle Freigabe -> Upload per offizieller API -> Kennzahlen. Hintergrundjobs über pg-boss, Kostenlimits pro Projekt, Zugangsdaten verschlüsselt in der DB.

Ist-Zustand (Code): Auth mit E-Mail/Passwort, Seiten `index`, `login`, `dashboard`, Tabellen nur `user/session/account/verification`, `runtimeConfig` mit `databaseUrl`, `betterAuthSecret`, `betterAuthUrl`, Tests `tests/app.test.ts`, `tests/schema.test.ts`. Hinweis: Die Spec-Datei `docs/superpowers/specs/2026-10-05-tetra-nuxt4-setup-design.md` ist im Working Tree als gelöscht markiert (in HEAD vorhanden); dieser Plan fasst sie nicht an.

Single-Tenant-Absicherung: Registrierung nach dem ersten Nutzer sperren (Better Auth `emailAndPassword.disableSignUp` o. ä. nach Bootstrap), alle `/api/**` außer Auth, Webhooks und öffentlichen Seiten per Server-Middleware schützen.

## 2. Recherche-Stand der Fremd-APIs (Annahmen, ehrlich)

Per kurzer Web-Recherche am 2026-10-05; nichts davon ist gegen echte Konten getestet. Jede Annahme wird in Phase 0 per Spike verifiziert.

**HeyGen Video Agent**
- `POST /v3/video-agents`, Auth per Header `X-Api-Key`. Parameter: `prompt` (1-10.000 Zeichen), optional `avatar_id`, `voice_id`, `orientation` (`portrait` für Shorts), `callback_url`/`callback_id`.
- Asynchron: erst `GET /v3/video-agents/{session_id}` liefert `video_id`, dann `GET /v3/videos/{video_id}` bis `completed`/`failed`. Dauer laut Doku grob 5-10x Videolänge.
- Preis laut Drittquellen ca. 0,0333 USD/Sekunde (also ca. 1-2 USD pro 30-60-s-Video), prepaid Guthaben. Unsicher/unbestätigt: Länge steuert man nur im Prompt (kein Parameter), Ablaufzeit der `video_url` (nicht dokumentiert -> sofort herunterladen und selbst speichern), Rate Limits, ob der Agent das Skript wörtlich übernimmt (Prompt muss "sprich exakt diesen Text" erzwingen; Abweichungen prüfen), genaue Kosten-Rückmeldung pro Video (ggf. nur aus Dauer x Tarif schätzbar).

**YouTube Data API**
- Upload via `videos.insert` (OAuth, Scope `youtube.upload`), Statistiken via `videos.list` (`statistics`, Scope `youtube.readonly`). Shorts sind normale Uploads: vertikal, <= 3 Minuten (aktuell Obergrenze prüfen), `#Shorts` in Titel/Beschreibung.
- Wichtig: Videos aus nicht auditierten API-Projekten (erstellt nach 28.07.2020) werden auf privat gezwungen; öffentliche Uploads brauchen den YouTube "API Services Compliance Audit". Quota-Regeln wurden laut Quellen 2025/2026 geändert (Upload-Kosten gesenkt, eigener Bucket mit ca. 100 Calls/Tag) -> Zahlen vor Umsetzung gegen die offizielle Doku prüfen. Zeitplanung nativ möglich (`status.publishAt` mit `privacyStatus=private`), wir planen aber selbst per Cron.
- Neu für YouTube: Offenlegung "altered/synthetic content" (`status.containsSyntheticMedia`) für realistische KI-Inhalte; Feld und Pflicht prüfen.

**TikTok Content Posting API**
- Zwei Modi: Direct Post (Scope `video.publish`) und Upload/Inbox-Entwurf (Scope `video.upload`, kein Audit nötig, Nutzer schließt den Post in der App ab; laut Quellen ca. 5 offene Entwürfe/24 h). Nicht auditierte Clients dürfen nur `SELF_ONLY` posten (Fehler `unaudited_client_can_only_post_to_private_accounts`), begrenzte Nutzerzahl.
- Audit verlangt u. a. öffentliche Website, Datenschutzerklärung, Nutzungsbedingungen, Demo-Video des Flows und UX-Vorgaben (Creator-Info abfragen, Privacy-Auswahl, Disclosure-Toggles, Hinweis "Posted by"). Das Panel muss diese UX-Pflichten beim Direct Post erfüllen (Phase 6).
- Tokens: Access Token kurzlebig (ca. 24 h), Refresh Token länger; Refresh-Flow zwingend.
- Statistiken: Video-Metriken (Views/Likes) laufen über die Display-/Research-API-Scopes (`video.list`, `user.info.stats`); Verfügbarkeit für Entwurfs-/nicht auditierte Posts unsicher. Fallback: manuelle Eingabe oder nur YouTube-Kennzahlen.

## 3. Architekturentscheidungen

- **Provider-Interfaces** in `server/providers/`: `LlmProvider` (Deepseek), `VideoProvider` (HeyGen), `PublisherProvider` (YouTube, TikTok), `MetricsProvider` (je Plattform). Registry löst Implementierung + Credentials pro Projekt auf. Tests nutzen Fakes.
- **Verschlüsselte Secrets**: `server/utils/crypto.ts`, AES-256-GCM, 12-Byte-Zufalls-IV, Format `v1:iv:tag:ciphertext` (Base64), Schlüssel aus `ENCRYPTION_KEY` (32 Byte, Base64/Hex; Start bricht ab, wenn fehlt). Versionspräfix erlaubt spätere Rotation. API gibt Secrets nie zurück (nur "gesetzt/zuletzt geändert" + Maske).
- **pg-boss** (eigenes Schema `pgboss` in derselben DB), Start über Nitro-Plugin nach der Migration; Worker laufen im App-Prozess (Single-Instance ausreichend; `app` bleibt 1 Replika). Queues: `topics.generate`, `script.generate`, `video.render` (+ `video.poll`), `video.upload`, `metrics.sync`, `scheduler.tick`. Retry mit Backoff und festem Limit pro Queue; Idempotenzschlüssel (`singletonKey`) pro Video/Schritt.
- **Zustandsautomat Video**: `idea -> scripting -> script_ready -> rendering -> awaiting_review -> scheduled -> uploading -> uploaded | failed`, plus `rejected`, `paused_budget`. Übergänge nur über eine zentrale Funktion mit erlaubter Übergangstabelle und Eintrag in `video_events`.
- **Kostenkontrolle**: `CostGuard.reserve(projectId, estimate)` vor jedem kostenpflichtigen Call (LLM, Render); prüft Tages-/Monatslimit (Projektzeitzone) transaktionell (Advisory Lock/`SELECT ... FOR UPDATE` auf Projekt), schreibt `cost_entries` nach dem Call mit Ist-Wert. Bei Überschreitung: Job bricht ohne Retry ab, Video -> `paused_budget`, Projekt-Flag `production_paused` mit Grund.
- **Medienspeicher**: gerenderte MP4 sofort in ein Docker-Volume (`/data/videos`, in Compose ergänzen) herunterladen; Pfad in DB; Auslieferung für Review über geschützte Route mit Range-Support. Aufräumen nach Upload + Frist.
- **Zeitplan**: `scheduler.tick` (jede Minute) belegt Slots aus Wochenplan (Uhrzeit, Zeitzone, Videos/Tag) mit freigegebenen Videos; Überschreibung `video.publish_at`. Zeitzonenlogik (DST) mit `Temporal`-freier Bibliothek, z. B. `date-fns-tz`/Luxon, klar gekapselt.

## 4. Datenmodell (Skizze)

Alle Tabellen mit `id` (uuid), `created_at`, `updated_at`.

- `settings_secret`: `key` (z. B. `heygen.apiKey`, `deepseek.apiKey`), `value_enc`, `updated_at` (globale Standards).
- `project`: `name`, `niche` (Text), `language` (z. B. `de`, `en`), `style_prompt`, `heygen_avatar_id`, `heygen_voice_id`, `daily_budget_cents`, `monthly_budget_cents`, `production_paused`, `pause_reason`, `target_video_length_s`, `topic_batch_size` (Standard 20), `max_retries`.
- `project_secret`: `project_id`, `key`, `value_enc` (optionale Überschreibung HeyGen/Deepseek).
- `channel`: `project_id`, `platform` (`youtube`|`tiktok`), `display_name`, `external_id`, `access_token_enc`, `refresh_token_enc`, `token_expires_at`, `scopes`, `status` (`connected`|`expired`|`audit_pending`), `tiktok_mode` (`inbox`|`direct`).
- `schedule_rule`: `project_id`, `weekday`, `time_local`, `timezone`, `videos_per_day`/Slots, `enabled`.
- `topic`: `project_id`, `title`, `angle`, `status` (`suggested`|`approved`|`rejected`|`used`), `fingerprint` (normalisierter Hash/Embedding-frei: normalisierter Titel), `batch_id`. Eindeutigkeit (`project_id`, `fingerprint`); bisherige Themen (alle Status) gehen als Ausschlussliste in den Deepseek-Prompt.
- `video`: `project_id`, `topic_id`, `status`, `script`, `title`, `description`, `hashtags`, `heygen_session_id`, `heygen_video_id`, `file_path`, `duration_s`, `publish_at` (Override), `slot_at`, `rejected_reason`, `attempts`, `last_error`.
- `video_event`: `video_id`, `from_status`, `to_status`, `message`, `at`.
- `publication`: `video_id`, `channel_id`, `platform`, `external_post_id`, `status`, `mode` (`inbox`|`direct`|`private`), `uploaded_at`, `error`.
- `cost_entry`: `project_id`, `video_id?`, `provider`, `operation`, `amount_micro_usd`, `units` (Tokens/Sekunden), `estimated` (bool), `at`.
- `metric_snapshot`: `publication_id`, `date`, `views`, `likes`, `comments`, `shares?`; Unique (`publication_id`, `date`).
- pg-boss legt eigene Tabellen im Schema `pgboss` an (nicht in Drizzle verwalten, in `drizzle.config.ts` ausschließen).

## 5. Modulstruktur

```
server/
  db/schema.ts                  (aufteilen in server/db/schema/*.ts, Re-Export)
  utils/crypto.ts               AES-256-GCM
  utils/secrets.ts              Auflösung global/Projekt, Maskierung
  utils/require-user.ts         Auth-Guard
  middleware/auth-guard.ts
  providers/
    types.ts                    Interfaces + Fehlerklassen (Retryable/Fatal/BudgetExceeded)
    registry.ts
    deepseek/ heygen/ youtube/ tiktok/
    fakes/                      Test-Doubles
  services/
    cost-guard.ts  video-state.ts  topics.ts  scripts.ts  scheduler.ts  metrics.ts
  jobs/
    boss.ts (Start/Stop)  handlers/*.ts  register.ts
  plugins/boss.ts               nach migrate
  api/
    projects/ channels/ topics/ videos/ settings/ metrics/ oauth/ webhooks/heygen.post.ts
app/
  pages/ projects/index, projects/[id]/(overview|topics|videos|schedule|channels|costs|metrics), review/[id], settings, legal/privacy, legal/terms (öffentlich)
  components/ composables/
tests/ (unit, integration mit Test-DB, provider-contract)
```

## 6. Phasen, Meilensteine und Arbeitspakete

Konventionen: Agent-Typen aus den installierten SuperClaude-Agents; Modell nach Aufwand (haiku = Boilerplate, sonnet = Standard, opus = schwierige Entscheidungen/kritische Reviews). Jedes Paket endet mit grünem `pnpm test` und `pnpm build`; Schema-Änderungen immer mit `drizzle-kit generate` und Test in `tests/schema.test.ts`-Stil.

### Phase 0: Spikes und Fundament (Meilenstein M0: Annahmen geklärt, Grundlage steht)

**WP0.1 API-Spikes (Recherche)**: Ziel: Annahmen aus Abschnitt 2 gegen aktuelle Offiziell-Doku/Sandbox prüfen (HeyGen Request/Response/Preis/Ablauf-URL, YouTube Quota/Audit/Synthetic-Flag, TikTok Scopes/Metrik-Endpunkte/Audit-Checkliste). Dateien: Ergebnis nur als Ergänzung im Abschnitt "Offene Punkte" dieses Plans bzw. Kommentar in `server/providers/types.ts`. Akzeptanz: je Anbieter 1 Seite Fakten mit Links, Abweichungen vom Plan markiert. Abhängigkeit: keine. Agent: `deep-research-agent`, Modell sonnet.

**WP0.2 Crypto + Secret-Store**: Ziel: `crypto.ts`, `secrets.ts`, Tabellen `settings_secret`, `project_secret`. Dateien: `server/utils/`, `server/db/schema/`, `.env.example`, `docker-compose.yml` (`ENCRYPTION_KEY`), `nuxt.config.ts` runtimeConfig. Akzeptanz/Tests: Roundtrip, manipulierter Tag/Ciphertext wird abgelehnt, IV nie wiederverwendet, falscher Schlüssel schlägt fehl, Start ohne Key schlägt fehl, Maskierung. Abhängigkeit: keine. Agent: `security-engineer` (Review) + `backend-architect` (Impl.), Modell sonnet, Review opus.

**WP0.3 Schema-Grundlage**: Ziel: Tabellen aus Abschnitt 4 (ohne Secrets), Migration, Aufteilung `schema.ts`. Akzeptanz: Migration läuft in Test-DB, Constraints (Unique Fingerprint, FK-Cascade) getestet. Abhängigkeit: keine (WP0.2 ergänzt nur seine Tabellen; Merge-Konflikt vermeiden: WP0.3 legt die Schema-Ordnerstruktur an und läuft zuerst, WP0.2 danach oder in Absprache). Agent: `backend-architect`, sonnet.

**WP0.4 Auth-Härtung Single-Tenant**: Ziel: Registrierung nach erstem Nutzer sperren, Server-Middleware schützt `/api/**` (Ausnahmen: `/api/auth/**`, `/api/webhooks/**`, `/api/oauth/*/callback` mit State-Prüfung, öffentliche Seiten). Dateien: `server/utils/auth.ts`, `server/middleware/`. Akzeptanz: unauthentifizierte Requests 401, zweite Registrierung abgelehnt. Abhängigkeit: keine. Agent: `security-engineer`, sonnet.

**WP0.5 Test-Infrastruktur**: Ziel: Integrationstest-Setup mit echter Postgres (Compose-Dev-DB oder Testcontainer), Provider-Fakes-Gerüst, HTTP-Mock (z. B. `msw`/`undici MockAgent`) für Provider-Contracts. Dateien: `vitest.config.ts`, `tests/helpers/`. Akzeptanz: Beispiel-Integrationstest läuft lokal und in CI-Befehl `pnpm test`. Abhängigkeit: WP0.3. Agent: `quality-engineer`, sonnet.

### Phase 1: Kern-Engine (M1: Idee -> Skript -> Freigabe mit Fakes End-to-End)

**WP1.1 Provider-Interfaces + Registry**: Ziel: `types.ts` (Methoden: `generateTopics`, `generateScript`, `createVideo`, `getVideoStatus`, `publish`, `fetchMetrics`; Fehlerklassen), Registry mit Credential-Auflösung (Projekt -> global). Akzeptanz: Fakes erfüllen die Interfaces; Registry-Tests zu Fallback und fehlendem Key. Abh.: WP0.2, WP0.3. Agent: `system-architect`, Modell opus (Interface-Design ist langlebig).

**WP1.2 pg-boss-Integration**: Ziel: Boss-Start/Stop im Nitro-Plugin nach Migration, Queue-Definitionen, Retry/Backoff/Dead-Letter, Cron-Registrierung, Graceful Shutdown. Dateien: `server/jobs/`, `server/plugins/boss.ts`, `drizzle.config.ts` (Schema-Ausschluss). Akzeptanz: Integrationstest (Job läuft, Retry greift, nach Limit `failed`), App startet ohne `DATABASE_URL` weiterhin ohne Crash (Test-Modus). Abh.: WP0.5. Agent: `backend-architect`, sonnet.

**WP1.3 Video-Zustandsautomat**: Ziel: `video-state.ts` mit Übergangstabelle + `video_event`. Akzeptanz: unzulässige Übergänge werfen, Property-/Tabellentests aller Übergänge. Abh.: WP0.3. Agent: `backend-architect`, sonnet.

**WP1.4 CostGuard**: Ziel: Reservierung, Tages-/Monatsfenster in Projektzeitzone, Pausieren, Wiederaufnahme. Akzeptanz: Tests für Grenzfälle (exakt am Limit, parallele Reservierungen, Monatswechsel, Retry zählt Kosten mit, `estimated` vs. Ist). Abh.: WP0.3. Agent: `backend-architect`, sonnet (Review `quality-engineer`).

**WP1.5 Themen-Service + Deepseek-Provider**: Ziel: Batch-Vorschlag (N Themen, Ausschlussliste aus bestehenden `topic`), Normalisierung + Fingerprint, Dopplungsfilter, Annehmen/Ablehnen. Provider spricht Deepseek per OpenAI-kompatibler Chat-API (Base-URL/Modell konfigurierbar, JSON-Ausgabe validiert, z. B. mit `zod`), Token-Kosten aus `usage`. Akzeptanz: Contract-Test mit aufgezeichneten Antworten, Duplikate werden verworfen, ungültiges JSON -> Retry. Abh.: WP1.1, WP1.2, WP1.4. Agent: `backend-architect`, sonnet.

**WP1.6 Skript-Service**: Ziel: aus freigegebenem Thema Skript + Titel + Beschreibung + Hashtags in Projektsprache und Stil-Prompt, Längenprüfung gegen Zielsekunden. Akzeptanz: Fake-LLM-Tests, Sprach-/Längenregeln. Abh.: WP1.5. Agent: `backend-architect`, sonnet.

**WP1.7 HeyGen-Provider + Render-Job**: Ziel: `createVideo` (Prompt mit wörtlichem Skript, `orientation: portrait`, Avatar/Voice aus Projekt), Polling-Job (2-stufig) plus optionaler Webhook-Endpoint mit Signatur-/Secret-Prüfung, Download in Medienspeicher, Kostenerfassung. Akzeptanz: Contract-Tests gegen gemockte HeyGen-Antworten (Erfolg, `failed`, Timeout, 429/5xx -> Retry, 4xx -> fatal), kein Doppel-Render bei Job-Retry (Idempotenz über `heygen_session_id`). Abh.: WP0.1, WP1.1-1.4. Agent: `backend-architect`, sonnet.

**WP1.8 Orchestrierung Produktionsschleife**: Ziel: Cron/Trigger, der pro Projekt genehmigte Themen in Skript- und Render-Jobs überführt, solange Budget und Puffer (z. B. max. N Videos in `awaiting_review`) es erlauben. Akzeptanz: Integrationstest mit Fakes: Thema -> `awaiting_review`; Budget voll -> pausiert; Retry-Limit -> `failed`. Abh.: WP1.5-1.7. Agent: `backend-architect`, sonnet.

### Phase 2: Panel-UI Kern (M2: Bedienbares Panel ohne Upload)

Parallel zu Phase 1 ab Vorliegen der API-Verträge (WP2.0).

**WP2.0 API-Verträge**: Ziel: Zod-Schemas/Typen für alle Panel-Endpunkte (Projekte, Themen, Videos, Settings) in `server/api/**` + geteilte Typen in `shared/`. Akzeptanz: Typecheck, Verträge reviewt. Abh.: WP0.3. Agent: `system-architect`, sonnet.

**WP2.1 Projekt-CRUD + Einstellungen (API+UI)**: Seiten `projects/*`, `settings` (globale Keys, maskiert, editierbar, Test-Verbindung-Knopf), Projekt-Overrides, Sprachauswahl, Budget, Wochenplan-Editor. Akzeptanz: Secrets nie im Response, Validierung, Komponententests (happy-dom). Abh.: WP0.2, WP2.0. Agent: `frontend-architect` (UI) + `backend-architect` (API), sonnet.

**WP2.2 Themen-UI**: Batch erzeugen, Liste mit Annehmen/Ablehnen (Mehrfachauswahl), Verlauf. Abh.: WP1.5, WP2.0. Agent: `frontend-architect`, sonnet.

**WP2.3 Videoliste + Review-Ansicht**: Pipeline-Statusübersicht (Filter), Player (Range-Stream), Skript/Titel/Beschreibung editierbar, Freigeben/Ablehnen (mit Grund; optional Neu-Rendern, kostenpflichtig mit Bestätigung), `publish_at`-Override. Akzeptanz: nur `awaiting_review` freigebbar; Freigabe -> `scheduled`. Abh.: WP1.3, WP1.7, WP2.0. Agent: `frontend-architect`, sonnet.

**WP2.4 Kosten-Ansicht**: Kosten pro Video/Projekt, Tages-/Monatsverbrauch gegen Limit, Pausen-Banner mit Fortsetzen. Abh.: WP1.4. Agent: `frontend-architect`, haiku/sonnet.

### Phase 3: Veröffentlichung (M3: Freigegebenes Video landet auf YouTube)

**WP3.1 OAuth-Framework + Kanalverbindung**: Ziel: generischer OAuth-Flow (State + PKCE, Callback-Routen `/api/oauth/{youtube,tiktok}/callback`), Tokens verschlüsselt, Refresh-Service mit Sperre gegen parallele Refreshs, Status `expired` -> UI-Hinweis. Akzeptanz: State-Manipulation wird abgewiesen, Tokens nie im Log/Response, Refresh-Tests (abgelaufen, widerrufen). Abh.: WP0.2, WP0.4, WP1.1. Agent: `security-engineer`, Modell opus (kritisch), Impl. sonnet.

**WP3.2 YouTube-Publisher**: Ziel: Resumable Upload aus Datei, Titel/Beschreibung/Tags, Shorts-Konventionen, `containsSyntheticMedia` falls verfügbar, Kind-Einstellung ("made for kids" = nein). Solange das Projekt nicht auditiert ist, ist Sichtbarkeit `private`; Schalter pro Kanal. Akzeptanz: Mock-Contract-Tests (Resumable-Ablauf, 401 -> Refresh, quotaExceeded -> verschieben statt Retry-Sturm). Abh.: WP3.1, WP0.1. Agent: `backend-architect`, sonnet.

**WP3.3 Slot-Scheduler + Upload-Job**: Ziel: `scheduler.tick`, Slotvergabe aus `schedule_rule` (DST-sicher) mit Override, Upload-Job je Kanal (Retries begrenzt, Teil-Erfolg: ein Kanal ok, anderer fehlgeschlagen -> getrennt wiederholbar). Akzeptanz: Zeitzonen-/DST-Tests, kein Doppel-Upload (Idempotenz via `publication`), Fehlerstatus sichtbar. Abh.: WP1.2, WP3.2. Agent: `backend-architect`, sonnet.

**WP3.4 Planungs-UI + Publikationsstatus**: Wochenplan-Ansicht, Kalender der Slots, Fehler/Wiederholen-Aktionen. Abh.: WP3.3. Agent: `frontend-architect`, sonnet.

### Phase 4: TikTok (M4: TikTok-Entwurf; später Direct Post)

**WP4.1 TikTok-Publisher Inbox-Modus**: Ziel: Upload als Entwurf (`video.upload`), Statusabfrage, Entwurfs-Limit beachten (Warnung im Panel: Nutzer muss Entwurf in der App veröffentlichen). Akzeptanz: Mock-Contract-Tests inkl. Chunk-Upload, Token-Refresh, Limit-Fehler. Abh.: WP3.1, WP3.3. Agent: `backend-architect`, sonnet.

**WP4.2 Öffentliche Rechtsseiten (Audit-Vorbereitung)**: Ziel: `/legal/privacy`, `/legal/terms` (öffentlich, ohne Login, in Auth-Guard ausgenommen), Impressum-Hinweis, Daten-Löschung/Token-Widerruf-Beschreibung, Produkt-Landingpage `index.vue` mit Zweck der App. Akzeptanz: ohne Login erreichbar, Inhalte entsprechen dem tatsächlichen Datenfluss (Texte vom Nutzer final freizugeben, keine Rechtsberatung). Abh.: keine (kann ab Phase 0 laufen). Agent: `technical-writer` + `frontend-architect`, haiku/sonnet.

**WP4.3 Direct-Post-Modus + Audit-UX**: Ziel (nach bestandenem Audit): `creator_info` abfragen, Privacy-Auswahl, Disclosure-Toggles (u. a. KI-generiert kennzeichnen), vorherige Nutzerzustimmung je Post im Review. Umschalter `tiktok_mode` pro Kanal. Akzeptanz: Checkliste gegen TikTok-UX-Richtlinien abgehakt; Mock-Tests beider Modi. Abh.: WP4.1, WP4.2, externer Auditentscheid. Agent: `frontend-architect` + `backend-architect`, sonnet.

### Phase 5: Kennzahlen (M5: Dashboard mit Views/Likes)

**WP5.1 Metrics-Sync**: Täglicher Job je `publication` (YouTube `videos.list`, TikTok soweit API verfügbar), Snapshots, Fehlertoleranz (ein Anbieter down -> andere laufen). Akzeptanz: Mock-Tests, Idempotenz je Tag, Quota-schonend (Batch bis 50 IDs). Abh.: WP3.2, WP4.1, WP0.1. Agent: `backend-architect`, sonnet.

**WP5.2 Kennzahlen-UI**: Tabellen/Verläufe pro Video und Projekt, Summen, Zeitraumfilter. Abh.: WP5.1. Agent: `frontend-architect`, sonnet.

### Phase 6: Härtung und Abnahme (M6: Betriebsbereit)

**WP6.1 Security-Review**: Secrets-Handling, OAuth, Webhook-Authentizität, Pfad-/Range-Zugriff auf Videos, SSRF bei Download-URLs, Log-Hygiene, Rate Limit auf Login. Agent: `security-engineer`, opus.

**WP6.2 Betrieb**: Compose (`ENCRYPTION_KEY`, Volume `/data/videos`, Healthcheck-Route), Backup-Hinweis (Schlüsselverlust = Secrets unwiederbringlich), Coolify-Doku, Logging, Admin-Seite "Jobs" (Queue-Stand, fehlgeschlagene Jobs). Agent: `devops-architect`, sonnet.

**WP6.3 E2E-Abnahme + Doku**: Gesamtlauf mit Fakes, danach Live-Smoke mit Testkonto (1 Video, privat). README/Betriebsdoku auf Deutsch. Agent: `quality-engineer` + `technical-writer`, sonnet.

## 7. Abhängigkeitsgraph und Wellen

Wellen sind parallel ausführbar; Pakete einer Welle dürfen nicht dieselben Dateien ändern (Schema-Ordner: nur ein Paket pro Welle schreibt in dieselbe Tabellendatei, sonst Migrationskonflikte).

| Welle | Pakete (parallel) | Voraussetzung |
|---|---|---|
| W1 | WP0.1, WP0.3, WP0.4, WP4.2 | keine |
| W2 | WP0.2, WP0.5, WP2.0 | WP0.3 |
| W3 | WP1.1, WP1.2, WP1.3, WP1.4, WP2.1 | W2 |
| W4 | WP1.5, WP1.7, WP3.1, WP2.4 | W3 (WP1.7 braucht WP0.1) |
| W5 | WP1.6, WP2.2, WP2.3, WP3.2 | W4 |
| W6 | WP1.8, WP3.3, WP5.1 (YouTube-Teil) | W5 |
| W7 | WP3.4, WP4.1, WP5.2 | W6 |
| W8 | WP4.3 (nach Audit), WP6.1, WP6.2 | W7 |
| W9 | WP6.3 | W8 |

Meilensteine: M0 nach W2, M1 nach W6 (Fakes-E2E), M2 nach W5 (UI), M3 nach W6/W7 (YouTube live, privat), M4 nach W7 (TikTok-Entwurf), M5 nach W7, M6 nach W9. Kritischer Pfad: WP0.3 -> WP1.1 -> WP1.7 -> WP1.8 -> WP3.3 -> WP4.1. Extern lange laufend (früh starten): TikTok-Audit und YouTube-Audit, Developer-Konten/App-Registrierung.

Orchestrierung durch die Hauptsession: pro Welle alle Pakete in einer Nachricht als Subagents starten (je Paket `/sc:implement`-Stil-Prompt mit Ziel, Dateien, Akzeptanz; QA-Paket nach jeder Welle `quality-engineer` mit `/sc:test`), Ergebnisse zusammenführen, bei Konflikten Welle serialisieren. Nach jeder Aufgabe: graphify aktualisieren, committen, pushen (Nutzerregel).

## 8. Teststrategie

- **Unit**: Crypto, Zustandsautomat, CostGuard, Themen-Fingerprint, Zeitplanlogik (DST), Secret-Auflösung.
- **Provider-Contract-Tests**: HTTP-Mocks mit aufgezeichneten/handgeschriebenen Antworten je Anbieter (Erfolg, 4xx, 429, 5xx, Timeout, kaputtes JSON); gleiche Testsuite läuft gegen die Fakes, damit Interface-Verträge einheitlich bleiben. Keine echten API-Calls in CI.
- **Integration**: echte Postgres + pg-boss + Fake-Provider: Pipeline von Thema bis `uploaded`, Retries, Budget-Pause, Idempotenz bei Doppelzustellung.
- **API/Security**: Auth-Guard (401), Secrets nie in Responses/Logs, OAuth-State.
- **UI**: Komponententests (happy-dom) für Review, Settings, Themenliste; manueller Smoke im Browser pro Phase.
- **Live-Smoke (manuell, optional)**: je Anbieter 1 Call mit Testkonto, Kostenobergrenze per Projektlimit.

## 9. Risiken und Gegenmaßnahmen

| Risiko | Auswirkung | Gegenmaßnahme |
|---|---|---|
| TikTok-Audit dauert/scheitert | Nur Entwürfe bzw. nur privat posten | Inbox-Modus von Anfang an; Rechtsseiten früh (WP4.2); Audit-UX in WP4.3 vorab bauen; Fallback: manuelles Veröffentlichen aus Entwurf |
| YouTube-Audit/Privatzwang | Uploads bleiben privat | Audit-Antrag früh stellen; bis dahin Sichtbarkeit manuell in Studio umstellen (Panel zeigt Hinweis) |
| HeyGen-Details unklar (Länge, Skripttreue, Kosten, URL-Ablauf, Limits) | Falsche Videos, Kostenabweichung | WP0.1-Spike, wörtliches Skript im Prompt, Dauer-/Transkript-Plausibilisierung, Kosten als `estimated` markieren und gegen Guthaben abgleichen, Video sofort speichern |
| Plattformregeln für KI-Content | Reichweitenverlust/Sperre | KI-Kennzeichnung (YouTube-Synthetic-Flag, TikTok AIGC-Label) standardmäßig an; menschliche Freigabe bleibt; keine Täuschung über reale Personen; Richtlinien (Spam/"inauthentic content", Wiederholungsinhalte) vor Start prüfen und Varianz in Prompts erzwingen |
| Kostenexplosion (Retry-Schleifen, Neu-Rendern) | Unerwartete Rechnung | Vorab-Reservierung, harte Tages-/Monatslimits, Retry-Limit, kein automatisches Neu-Rendern, Puffergrenze `awaiting_review`, Alarm bei 80 % |
| Token-/Secret-Leck | Kontoübernahme | AES-GCM, Maskierung, Log-Filter, kein Secret im Client, Security-Review (WP6.1) |
| Verlust von `ENCRYPTION_KEY` | Alle Secrets unbrauchbar | Dokumentierte Sicherung außerhalb der DB; Re-Eingabe-Flow in UI |
| pg-boss im App-Prozess | Jobs stoppen beim Deploy | Graceful Shutdown, idempotente Handler, Single-Replika; bei Wachstum separater Worker-Prozess (gleiche Codebasis) |
| API-Änderungen (Quota, Preise) | Brüche | Provider-Interfaces, Contract-Tests, Konfig statt Hardcode |

## 10. Offene Punkte

1. Domain/Hosting-URL für OAuth-Redirects und TikTok-Audit (öffentliche Rechtsseiten brauchen stabile URL).
2. Rechtliche Texte (Datenschutz, Nutzungsbedingungen, Impressum): Wer liefert sie? Kein Code-Thema.
3. HeyGen: Avatar-/Voice-Strategie pro Sprache; wörtliche Skriptübernahme und Videolänge verifizieren; Webhook vs. Polling.
4. TikTok: Metrik-Zugriff (Views/Likes) für eigene Posts per API tatsächlich verfügbar? Sonst nur YouTube-Zahlen oder manuelle Erfassung.
5. Wie viele Videos/Tag/Projekt und welches Standardbudget (Vorschlag Start: 3 USD/Tag, 60 USD/Monat je Projekt)?
6. Deepseek-Modellname/Endpoint und Kosten pro Token (konfigurierbar halten).
7. Medien-Retention (wie lange MP4 nach Upload behalten) und Speicherplatz auf dem Coolify-Host.
8. Benachrichtigungen (E-Mail/Webhook bei Fehlern, Budgetpause, abgelaufenem Token)? Vorerst nur im Panel.
9. Mehrere Kanalpaare pro Projekt später? Datenmodell erlaubt mehrere `channel`, UI zunächst 1+1.

## 11. Definition of Done

- Alle Pakete der Phasen 0-6 erfüllen ihre Akzeptanzkriterien; `pnpm test` und `pnpm build` grün; Migrationen laufen auf leerer DB und beim Containerstart.
- Ein Projekt durchläuft mit echten Konten den Weg Thema wählen -> Skript -> HeyGen-Video -> Review/Freigabe -> Upload (YouTube; TikTok mindestens als Entwurf) -> Kennzahlen sichtbar.
- Budgetlimit pausiert nachweislich die Produktion; Retries sind begrenzt; Fehler sind im Panel sichtbar und wiederholbar.
- Alle Secrets verschlüsselt in der DB, nirgends im Log oder Client-Response; Security-Review ohne offene kritische Funde.
- Öffentliche Rechtsseiten erreichbar; TikTok-/YouTube-Audit beantragt (Bestehen ist keine DoD-Bedingung, aber Modus-Umschalter vorhanden).
- Compose/Coolify-Deployment dokumentiert (Env-Variablen inkl. `ENCRYPTION_KEY`, Volumes, Backup).
- Deutsche Betriebsdoku und aktualisierter graphify-Graph sind committet und gepusht.
