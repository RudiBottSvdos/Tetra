# WP0.1 API-Spikes: Ergebnisse (Stand 2026-10-05)

Methode: Web-Recherche gegen die offizielle Doku der Anbieter (Seiten per Abruf gelesen, Kurzfassung durch ein Hilfsmodell). Es existieren noch keine Konten oder Keys, daher ist **nichts live getestet**. Jede Aussage ist unten als **verifiziert (Doku)**, **Drittquelle** oder **unklar** markiert. Die Skripte unter `scripts/spikes/` schließen die Lücken, sobald Keys vorliegen.

## 0. Zusammenfassung und Entscheidung

| Frage | Ergebnis |
|---|---|
| HeyGen avatarlos (Voiceover + B-Roll + Untertitel)? | **Teilweise / wahrscheinlich ja, aber unverifiziert.** Die Doku sagt nur: ohne `avatar_id` wählt der Agent selbst einen Avatar. Einen Parameter "kein Avatar" gibt es nicht. HeyGen bewirbt faceless-Videos (Voiceover, generiertes B-Roll, Untertitel) mit dem Video Agent, aber nur als Marketing, nicht als API-Garantie. |
| Wörtliches Skript, Länge steuerbar? | **Nein per Parameter.** Es gibt kein Längenfeld, Länge und Wörtlichkeit nur über den Prompt. Abweichungen sind möglich und müssen geprüft werden. |
| Kosten | Drittquellen: 0,0333 USD/s (ca. 2 USD/min), Pay-as-you-go ab 5 USD. 40 s ca. 1,33 USD. Passt zum Plan (1-1,5 USD/Video). Nicht aus der offiziellen API-Doku bestätigt. |
| Fallback-Provider (WP1.11) nötig? | **Empfehlung: WP1.11 nicht sofort bauen, aber als bedingtes Paket behalten (Gate).** Zuerst Live-Spike mit `scripts/spikes/heygen-faceless.mjs` (3 Testvideos, ca. 4-6 USD). Fällt der Spike negativ aus (Avatar taucht auf, Skript wird umgeschrieben, Untertitel fehlen, Länge streut > ±25 %), wird WP1.11 Pflicht. Das `VideoProvider`-Interface bleibt unabhängig davon von Anfang an provider-neutral. |

Begründung: Die Entscheidung "avatarlos ja/nein" lässt sich ohne Key nicht belastbar treffen. Das Risiko ist begrenzt und billig prüfbar (wenige USD). Den Fallback blind vorab zu bauen wäre Aufwand mit hoher Wahrscheinlichkeit unnötig. Der Plan (Abhängigkeiten WP1.7 -> WP0.1) sollte um die Bedingung "Spike-Ergebnis vor WP1.7-Live-Smoke" ergänzt werden.

### Abweichungen vom Plan (Abschnitt 2)

1. **HeyGen**: `style_id`, `mode` (`generate`|`chat`), `files`, `incognito_mode`, `visibility` existieren zusätzlich. `orientation` ist nur `landscape|portrait` (portrait setzen). Webhook-Events heißen `video_agent.success` / `video_agent.fail`, Signaturprüfung mit Signing-Secret des Endpoints (nicht nur `callback_url`).
2. **YouTube**: `videos.insert` hat laut Doku einen **eigenen Bucket von 100 Uploads/Tag** (kein Einheitenpreis wie früher 1600). Für 1-2 Videos/Tag reicht das. Shorts: bis 3 Minuten, quadratisch oder hochkant, Erkennung am Format (nicht am `#Shorts`-Tag; Tag schadet nicht).
3. **TikTok**: Der AIGC-Parameter `is_aigc` existiert **nur im Direct-Post-Init**. Die Inbox-Doku erwähnt kein AIGC-Feld. Annahme im Plan "unklar" -> **bestätigt: im Inbox-Modus nicht per API setzbar, Hinweis im Panel nötig**. Unauditierte Clients: max. 5 Nutzer/24 h, nur `SELF_ONLY`. Metriken über `video.list` nur für **öffentliche** Videos.
4. **Microsoft**: Max. 60 MiB pro Chunk-Request, Empfehlung 5-10 MiB (Vielfache von 320 KiB). Refresh-Token wird bei jeder Nutzung ersetzt (rotiert), 90 Tage Lebensdauer. Für persönliche Konten ist die Token-Lebensdauer nicht per Policy änderbar.
5. **Deepseek**: Modellnamen haben sich geändert (siehe Abschnitt 5), Preise in Spannen mit Peak/Off-Peak. Planannahme "Modell konfigurierbar" war richtig.

---

## 1. HeyGen Video Agent

Quellen:
- https://developers.heygen.com/docs/video-agent
- https://developers.heygen.com/reference/create-video-agent-session
- https://developers.heygen.com/docs/webhook-events
- Preise (Drittquellen, Suchergebnisse): https://help.heygen.com/en/articles/15126059-how-to-use-credits-on-heygen, https://diyai.io/ai-tools/video-generation/heygen-pricing/
- Faceless-Marketing: https://www.heygen.com/blog/best-ai-video-generator-faceless-youtube, https://www.heygen.com/tool/faceless-video

Verifiziert (Doku):
- Endpoint `POST /v3/video-agents`, Auth Header `X-Api-Key` (Fehlermeldung nennt `x-api-key`; Header-Namen sind case-insensitive).
- Body: `prompt` (Pflicht, 1-10.000 Zeichen); optional `mode` (`generate` Standard, `chat`), `avatar_id` (null = Agent wählt automatisch), `voice_id`, `style_id` (Liste via `GET /v3/video-agents/styles`), `brand_kit_id`, `brand_glossary_id`, `orientation` (`landscape|portrait`, sonst automatisch), `files` (max. 20), `callback_url`, `callback_id`, `visibility`, `members`, `incognito_mode`.
- Response: `session_id`, `status` (`generating|thinking|completed|failed`), `video_id` (null bis verfügbar), `created_at`.
- Polling: `GET /v3/video-agents/{session_id}` bis `video_id` vorhanden, dann `GET /v3/videos/{video_id}` bis `completed|failed`; empfohlenes Intervall 10-30 s; Dauer ca. 5-10x Videolänge (40 s Video = ca. 3-7 Minuten).
- Ergebnis enthält `video_url` (vorsigniert), optional `subtitle_url`, `captioned_video_url`, `gif_url`.
- Webhooks: `callback_url` pro Request oder registrierte Endpoints; Events `video_agent.success` / `video_agent.fail`; Signaturprüfung mit Signing-Secret des Endpoints; sofort 2xx antworten; bei Fehlern Zustand per API nachladen.
- 429 liefert `Retry-After` (Sekunden). Fehler: 400, 401, 429.
- Download-URLs sind **temporär**; bei Ablauf liefert der Video-Detail-Endpoint eine frische URL. Konkrete Dauer nicht dokumentiert.

Drittquelle:
- API-Preis 0,0333 USD/s (Prompt-to-Video), Pay-as-you-go ab 5 USD, getrennt vom Web-Guthaben, keine Gratis-API-Credits seit Feb. 2026. Widersprüchliche Credit-Angaben (20 vs. 40 Credits/min) betreffen das Web-Produkt.

Unklar (Spike nötig):
- Avatarlos zuverlässig? (Auto-Auswahl kann trotzdem einen Sprecher einblenden. Prompt-Anweisung "no presenter, voiceover only" wirkt vermutlich, ist aber nicht garantiert.)
- Wörtliche Skriptübernahme; Längenstreuung; eingebrannte Untertitel (`captioned_video_url` deutet darauf hin, ob sie im Hauptvideo stecken, ist offen).
- Rate Limits und Parallelität (nicht dokumentiert, nur 429 + `Retry-After`).
- Ablaufdauer `video_url`; Kosten-Rückmeldung pro Video (vermutlich nur Dauer x Tarif, `duration` aus Video-Detail nutzen).
- Ob Seedance-/Premium-Modi (120 Credits/min im Web) per API aktiv werden: im Prompt keine Premium-Stile erzwingen, `style_id` nur bewusst setzen.

Empfehlung für WP1.7:
- Prompt: Skript in Anführungszeichen, "Read this script word for word, do not add, remove or rephrase. No on-screen presenter or avatar. Use B-roll footage. Burned-in captions. Portrait 9:16. Target duration 40 seconds."
- `orientation: portrait`, `mode: generate`, `incognito_mode: true`, `visibility: private`.
- Nach Abschluss sofort herunterladen (nie die URL speichern); Dauer aus Video-Detail für Kostenerfassung.
- Kosten reservieren mit Dauer x 0,0333 USD plus 25 % Puffer.
- Webhook optional, Polling bleibt Primärweg.

## 2. YouTube Data API v3 (`videos.insert`)

Quellen:
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/youtube/v3/revision_history
- Shorts-Länge: https://blog.youtube/news-and-events/tall-updates-coming-to-shorts/ (Sekundärquellen: 3 Minuten ab 15.10.2024)

Verifiziert (Doku):
- Scopes: `youtube.upload` (reicht für Upload), alternativ `youtube`, `youtube.force-ssl`, `youtubepartner`. Statistiken per `videos.list` brauchen `youtube.readonly`.
- Default-Quota je Projekt: **100 `videos.insert`-Aufrufe/Tag (eigener Bucket)**, 100 `search.list`, 10.000 Einheiten/Tag für alle übrigen Endpunkte (`videos.list` = 1 Einheit). Reicht für Startlast, Quota-Erweiterung nur über Audit-Formular.
- **Privatzwang**: Uploads aus nicht verifizierten API-Projekten, erstellt nach 28.07.2020, sind auf `private` beschränkt, bis das Projekt den **YouTube API Services Audit** besteht. Formular: "YouTube API Services - Audit and Quota Extension Form" (Quelle oben).
- `status.containsSyntheticMedia` existiert seit 30.10.2024, setzbar bei `videos.insert` und `videos.update`. Setzen: `true`. (Pflicht laut YouTube-Richtlinie für realistische KI-Inhalte; wir setzen immer `true`.)
- `status.publishAt` (nur mit `privacyStatus=private`) für Zeitplanung, `notifySubscribers` Standard true. Dateigröße bis 256 GB.
- Shorts: Dauer bis 3 Minuten, quadratisch oder hochkant. Unsere 30-45 s sind unkritisch.
- OAuth-Consent-Screen im Status **Testing**: Refresh-Token verfällt nach 7 Tagen (Ausnahme nur Basis-Scopes). Weitere Ablaufgründe: Widerruf, 6 Monate ungenutzt, max. 100 Refresh-Tokens je Konto und Client.

Unklar:
- Ob eine **Google-App-Verifizierung** (sensibler Scope `youtube.upload`) für einen Einzelbetreiber nötig ist, damit "In production" ohne Warnseite läuft: Doku-Aussage nicht abgerufen. Plan-Annahme (Warnseite, Nutzerlimit 100, für Einzelbetreiber akzeptabel) ist plausibel, aber unbestätigt. Beim Einrichten im Consent-Screen-Assistenten prüfen.
- Quota-Kosten einer **fehlgeschlagenen** Upload-Session; Dauer des Audits (nicht dokumentiert, bei Drittquellen Wochen).
- Ob `containsSyntheticMedia` bei privaten Uploads gespeichert wird (sollte; per `videos.list?part=status` im Spike prüfen).

Empfehlung: `youtube_visibility=private` Standard, `containsSyntheticMedia=true`, `selfDeclaredMadeForKids=false`. Consent-Screen sofort auf "In production" stellen, sonst täglicher Re-Login nach 7 Tagen. Audit-Antrag nach WP0.6/WP4.2 stellen. `quotaExceeded` -> Slot verschieben, nicht Retry-Sturm.

## 3. TikTok Content Posting API

Quellen:
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.tiktok.com/doc/content-posting-api-reference-upload-video
- https://developers.tiktok.com/doc/content-posting-api-get-started
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- https://developers.tiktok.com/doc/content-sharing-guidelines
- https://developers.tiktok.com/doc/tiktok-api-v2-video-list

Verifiziert (Doku):
- **Inbox/Entwurf**: `POST /v2/post/publish/inbox/video/init/`, Scope `video.upload`. Max. **5 offene Entwürfe pro 24 h**. Doku enthält **keinen** AIGC-Parameter, Label muss der Nutzer in der App setzen.
- **Direct Post**: `POST /v2/post/publish/video/init/`, Scope `video.publish`; Ablauf: `creator_info/query/` (`/v2/post/publish/creator_info/query/`) -> `video/init/` -> Upload -> `status/fetch/` (`/v2/post/publish/status/fetch/`). Feld `is_aigc` (bool) setzt das Label "Creator labeled as AI-generated". `privacy_level` muss aus den Optionen der Creator-Info stammen.
- **Unauditierte Clients**: Inhalte nur `SELF_ONLY`; max. 5 Nutzer/24 h; Fehler bei öffentlichem Konto (`unaudited_client_can_only_post_to_private_accounts`).
- Rate Limit: 6 Init-Requests/Minute je Access Token.
- `FILE_UPLOAD`: Chunks 5-64 MB (letzter bis 128 MB), 1-1000 Chunks, Dateien < 5 MB als ein Chunk, `Content-Range: bytes a-b/total` (Fehler 416 bei Fehlern), Upload-URL **1 Stunde** gültig. `PULL_FROM_URL` braucht verifizierte Domain. Dateien bis 4 GB; Dauer über API bis 10 Minuten; MP4/WebM/MOV, H.264 u. a., 360-4096 px, 23-60 FPS. Unsere 40-s-MP4 passt in einen Chunk.
- Audit-UX-Pflichten (Sharing Guidelines): Creator-Nickname und aktuelle Creator-Info anzeigen, Titel und **Privacy ohne Default** vom Nutzer wählen, Interaktions-Toggles (Kommentare/Duett/Stitch), optionaler Commercial-Disclosure-Toggle, Vorschau und ausdrückliche Zustimmung vor Upload, Hinweis auf Verarbeitungsdauer, Zustimmung zur Music Usage Confirmation (und Branded Content Policy bei Marken). Kein Wasserzeichen/Branding der App im Video.
- Metriken: `POST /v2/video/list/`, Scope `video.list`, liefert **öffentliche** Videos (20 je Seite), Felder u. a. `view_count`, `like_count`, `comment_count`, `share_count` (Felder-Liste nur teilweise aus der Seite bestätigt).

Drittquelle / unklar:
- Audit-Dauer und Erfolgsquote, Anforderung eines Demo-Videos und Sandbox-Nutzbarkeit für das Demo-Video (Drittquellen: Sandbox zum Testen von OAuth/Upload möglich; Demo für Audit darf vermutlich dort aufgenommen werden). Beim Antrag prüfen.
- Ob Inbox-Entwürfe nach Veröffentlichung in `video.list` auftauchen (ja, sobald öffentlich; Zuordnung Entwurf -> Video-ID nur über `publish_id`/Status-Endpoint, nicht bestätigt). Metriken für TikTok daher "best effort", Fallback manuelle Eingabe (WP5.3) wie im Plan.
- Token-Lebensdauer: Plan nimmt ca. 24 h Access, längeres Refresh an; nicht in dieser Runde erneut geprüft.

Empfehlung: Inbox zuerst (kein Audit). Panel-Hinweis "KI-Label beim Veröffentlichen in der TikTok-App setzen" ist verbindlich (Plan WP4.1 bestätigt). Direct Post mit `is_aigc=true` immer, sobald auditiert. Auditantrag mit Audit-UX (WP4.3) vorbereiten.

## 4. Microsoft Graph / OneDrive (persönliches Konto)

Quellen:
- https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession
- https://learn.microsoft.com/en-us/graph/auth-v2-user
- https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens

Verifiziert (Doku):
- OAuth: `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` und `/token`, Code-Flow mit `client_secret` (Web-App), Scopes `Files.ReadWrite offline_access` (Delegated, persönliches Konto, `Files.ReadWrite` genügt für `createUploadSession`). Auth-Code ca. 10 min gültig.
- Refresh: `grant_type=refresh_token`; die Antwort enthält ein **neues Refresh-Token, das das alte ersetzen muss** (Rotation -> atomar speichern). Lebensdauer 90 Tage (Drittseite zur Inaktivität: wird bei Nutzung erneuert; Token-Policies für persönliche Konten nicht konfigurierbar). Bei täglicher Nutzung unkritisch, aber Notification bei `invalid_grant`.
- Upload-Session: `POST /me/drive/root:/{pfad}/{datei}:/createUploadSession` (Body optional: `item.@microsoft.graph.conflictBehavior` = `fail|replace|rename`, `fileSize` nur Personal -> bei zu wenig Quota `507` vor dem Upload). Antwort: `uploadUrl`, `expirationDateTime`.
- Chunks: sequenziell, `PUT` auf `uploadUrl` mit `Content-Range: bytes a-b/total`; je Request **< 60 MiB**, Größe **Vielfaches von 320 KiB (327.680)**; empfohlen 5-10 MiB; Resumable ab > 10 MiB empfohlen. Antwort `202` + `nextExpectedRanges`; letzter Chunk `200/201` + driveItem (`id`, `size`). `Authorization`-Header **nicht** an den `uploadUrl`-PUT hängen (401).
- Fortsetzen: `GET uploadUrl` liefert fehlende Bereiche; `404` -> Session neu starten; 5xx -> exponentielles Backoff. `409 nameAlreadyExists` bei Namenskonflikt am Ende. Abbrechen mit `DELETE uploadUrl`. Session verfällt, wenn nichts mehr ankommt (jeder Chunk verlängert).
- Dateien unter 4 MB könnten per einfachem `PUT /content` laufen, wir nutzen immer die Upload-Session (Videos sind größer oder gleich).

Unklar (Spike):
- Genaue Throttling-Limits (nicht in dieser Doku; 429 mit `Retry-After` behandeln wie im Plan).
- Maximale Dateigröße für OneDrive Personal (Doku-Seite nennt nur "maximum file size"; praktisch bis 250 GB, Videos ca. 10-50 MB, irrelevant).
- Integritätsprüfung: Graph liefert `file.hashes` (`quickXorHash` bzw. `sha1Hash`/`sha256Hash` bei Personal) im driveItem. Plan "Hash-Prüfung" kann `sha1Hash`/`sha256Hash` aus der Antwort nutzen (nicht durch diese Recherche belegt, im Spike prüfen); Größenprüfung (`size`) ist belegt.

## 5. Deepseek API

Quellen:
- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/guides/json_mode
- https://api-docs.deepseek.com/quick_start/rate_limit

Verifiziert (Doku):
- Base URL `https://api.deepseek.com` (OpenAI-kompatibel, auch Anthropic-API-kompatibel). Aktuelle Modelle laut Preisseite: **`deepseek-flash`** (1M Kontext, bis 384K Output, Vision, JSON, Tools) und **`deepseek-v4-pro`** (1M Kontext, ohne Vision, JSON, Tools). Beide mit Thinking-Modus. Ältere Aliasse (`deepseek-chat`, `deepseek-reasoner`) wurden nicht bestätigt, in der Konfiguration nicht festverdrahten.
- Preise pro 1M Tokens (Spannen = Peak/Off-Peak, Off-Peak halber Preis; Peak 01-04 und 06-10 UTC, Mo-Fr außer chinesische Feiertage): `deepseek-flash` Input Cache-Miss 0,15-0,30 USD, Output 0,60-1,20 USD; `deepseek-v4-pro` Input Cache-Miss 0,66-1,32 USD, Output 1,98-3,96 USD. Kosten pro Skript/Themen-Batch liegen bei Bruchteilen eines Cents; `CostGuard` mit Obergrenze rechnen (höhere Spanne).
- JSON-Output: `response_format: {"type":"json_object"}`; das Wort "json" und ein Beispielschema müssen im Prompt stehen; `max_tokens` großzügig setzen (sonst abgeschnittenes JSON). **Gelegentlich leere Antworten** -> Retry einplanen (passt zu Plan "ungültiges JSON -> Retry"). Kein striktes Schema (nur gültiges JSON), daher zod-Validierung wie geplant.
- Limits: Concurrency-basiert (2500 gleichzeitige Verbindungen `deepseek-flash`, 500 `deepseek-v4-pro`), 429 bei Überschreitung, Optional `user_id` zur Isolation. Für unsere Last irrelevant.

Unklar: ob JSON-Modus mit Thinking-Modus kombinierbar ist (im Spike: ohne Thinking nutzen); Preis-Spanne der Seite wirkt als Peak/Off-Peak-Darstellung (Interpretation, nicht explizit pro Zahl bestätigt); Token-Rückgabe (`usage`) gehört zum OpenAI-Standardformat und wird im Spike geprüft.

Empfehlung: Standard `deepseek-flash` für Themen, Skripte und Metadaten; Modellname als Setting. Kosten aus `usage` x Tarif (obere Spanne).

---

## 6. Offene Punkte / Folgeaufgaben

1. **Live-Spike HeyGen** (Gate für WP1.7 und WP1.11): `scripts/spikes/heygen-faceless.mjs` mit 3 Skripten (30, 40, 45 s) ausführen; Checkliste im Skript-Kopf.
2. Consent-Screen-Verifizierung für `youtube.upload` beim Einrichten prüfen (WP0.0).
3. TikTok: Sandbox-Nutzung für Audit-Demo und Verfügbarkeit von Metriken für Inbox-Posts beim ersten echten Test klären.
4. Graph: `file.hashes` des Personal-Drives im Spike prüfen (`onedrive-upload.mjs` gibt sie aus).
5. Plan-Aktualisierung: Abschnitt 2 (Quota-Bucket 100/Tag, AIGC nur Direct Post, Deepseek-Modellnamen, 60-MiB-Chunk-Grenze), Entscheidung WP1.11 = bedingt.
