# Zugangs-Checkliste: Tetra Faceless Panel – Schritt-für-Schritt-Anleitung

Stand: 2026-10-05. Diese Anleitung führt Sie durch alle notwendigen Konten, Zugänge und Anträge zum Starten von Tetra.

---

## 1. Domain + DNS + Coolify-Hosting

**Wofür:** Tetra läuft unter einer eigenen Domain mit HTTPS und OAuth-Redirects von den Plattformen. Dies ist die Grundvoraussetzung für alle API-Verbindungen.

**Wo einrichten:**
1. Domain bei einem Registrar kaufen (z. B. Namecheap, Bluehost, ionos).
2. Coolify-Host (VPS/Server) bereitstellen mit Let's Encrypt für HTTPS.
3. DNS-Records (A oder CNAME) auf die Coolify-IP zeigen lassen.
4. In Tetra `docs/superpowers/plans/2026-10-05-faceless-panel-plan.md` unter `runtimeConfig`/`betterAuthUrl` die Domain eintragen.

**Wichtig:** Alle OAuth-Flows (Google, TikTok, OneDrive) sind auf diese Domain angewiesen. Ohne HTTPS sind OAuth-Redirects nicht möglich.

**Im Panel eintragen:**
- Domain als `betterAuthUrl` in `nuxt.config.ts` / Umgebungsvariablen (z. B. `BETTER_AUTH_URL=https://example.com`).

**Fälligkeit:** **Welle 3 (W3)**, konkret vor **WP0.6 Erst-Deployment**.  
*Grund:* Blockiert alle OAuth-Audits und API-Verbindungen.

---

## 2. Google Cloud Projekt + YouTube Data API v3

**Wofür:** Upload von Videos auf YouTube Shorts und Abruf von Video-Statistiken.

**Wo einrichten:**
1. Zur [Google Cloud Console](https://console.cloud.google.com/) gehen, ggf. mit Google-Account anmelden.
2. **Neues Projekt erstellen** (Name: z. B. "Tetra" oder "Faceless Panel").
3. **APIs aktivieren:**
   - "YouTube Data API v3" suchen und aktivieren.
4. **OAuth 2.0 Credentials erstellen:**
   - Gehe zu "Credentials" → "Create Credentials" → "OAuth 2.0 Client IDs".
   - **Anwendungstyp:** Web application.
   - **Authorized redirect URIs hinzufügen:**
     ```
     https://<domain>/api/oauth/youtube/callback
     ```
   - Client-ID und Client-Secret kopieren.

**Wichtig – Consent Screen (Kritisch!):**
5. Gehe zu "OAuth consent screen" → "User Type: External".
6. **Scopes hinzufügen:** `youtube.upload` (sensibel), `youtube.readonly`.
7. **Testbenutzer hinzufügen:** Dein Google-Account (damit Token nicht nach 7 Tagen verfällt).
8. **Status auf "In production" setzen** – sonst werden Refresh-Tokens nach 7 Tagen ungültig!
   - Dazu: "Publishing status" → "Move to production" (oder "In production" direkt einstellen).

**Scopes im Detail:**
- `youtube.upload` – zum Hochladen von Videos (sensibel, erfordert App-Verifizierung).
- `youtube.readonly` – zum Abrufen von Statistiken.

**Im Panel eintragen (in den Google-Cloud-Einstellungen):**
- **Client-ID:** aus Credentials kopieren.
- **Client-Secret:** aus Credentials kopieren.

**Fälligkeit:** **Welle 4 (W4)**, konkret vor **WP3.1 OAuth-Framework**.  
*Grund:* OAuth-Flow für YouTube-Kanäle konfigurieren.

**Hinweis zu Google-App-Verifizierung:**
- Google verlangt eine separate "App-Verifizierung" für den sensiblen Scope `youtube.upload`.
- Dies ist **getrennt vom YouTube-API-Compliance-Audit** (s. u.) und wird von Google automatisch angefordert, wenn Sie versuchen, Videos hochzuladen.
- Sie erhalten einen Link zur Verifizierung; füllen Sie ein Formular zu Zweck und Sicherheit aus.

---

## 3. YouTube-Brand-Accounts und Kanäle

**Wofür:** Ein YouTube-Kanal pro Tetra-Projekt, auf dem Videos veröffentlicht werden.

**Wo einrichten:**
1. Mit dem YouTube-Konto anmelden (oder einen eigenen Account erstellen).
2. Zur [YouTube Studio](https://studio.youtube.com/) gehen.
3. **Brand-Account erstellen** (optional, aber empfohlen für mehrere Kanäle):
   - Profil-Symbol → "Einen neuen Kanal erstellen".
   - Name des Brand-Accounts (z. B. "Mein Faceless Niche").
4. **Kanal-Verifizierung:**
   - YouTube verlangt evtl. eine Verifizierung per Telefon (SMS-Code).
   - Gehe zu "Channel Settings" → "Verifizierung" und folge den Anweisungen.

**Im Panel eintragen:**
- **Channel-Display-Name:** Angezeigter Name (z. B. "Crypto News Daily").
- **Channel-ID:** Zu finden in "Channel Settings" → "Channel ID".
- Der Zugriff auf den Kanal läuft über OAuth (Welle 4), die Channel-ID wird dann automatisch über die API abgerufen.

**Fälligkeit:** **Welle 5 (W5)**, konkret vor **WP3.2 Live-Test**.  
*Grund:* Erst nach OAuth-Setup und vor Live-Uploads nötig.

---

## 4. YouTube-API-Compliance-Audit

**Wofür:** Freigabe von "Public" Videos (statt nur "Private"). Ohne Audit sind alle Uploads automatisch privat.

**Wo beantragen:**
1. Nach WP0.6 (Domain online) + WP4.2 (Rechtsseiten online) zur [YouTube API Services Compliance](https://console.developers.google.com/apis/manage/quotas) gehen.
2. Sie erhalten automatisch einen Link oder müssen ein Formular ausfüllen, das nach folgenden Informationen fragt:
   - **App-Name und Beschreibung:** z. B. "Tetra – Automatische KI-Video-Generierung für YouTube".
   - **Website:** Link zu Ihrer Domain.
   - **Datenschutzerklärung:** Link zu `https://<domain>/legal/privacy`.
   - **Nutzungsbedingungen:** Link zu `https://<domain>/legal/terms`.
   - **Begründung für `youtube.upload` und Zugriff auf Videos:** z. B. "Automatisiertes Hochladen von generierten Kurzvideos auf den Kanal des Nutzers, mit Speicherung in privatem OneDrive zur Archivierung".
   - **Sicherheitsmassnahmen:** Tokens verschlüsselt in der Datenbank, keine Speicherung im Speicher, Rate-Limiting.

3. **Submit und warten:** Google prüft Ihren Antrag (kann 5–14 Tage dauern).

**Im Panel / während Setup:**
- Solange das Audit läuft: YouTube-Videos bleiben `private`.
- Nach Genehmigung: Kanal-Einstellung `youtube_visibility` auf `public` setzen (sofern gewünscht).

**Fälligkeit:** **Antrag sofort nach WP0.6 + WP4.2**, Genehmigung erwartet vor **WP3.2**.  
*Grund:* Audit kann mehrere Wochen dauern; je früher beantragen, desto besser.

---

## 5. TikTok-Developer-Konto und App (Inbox-Modus)

**Wofür:** Upload von Videos als Entwürfe auf TikTok (Inbox-Modus). Der Nutzer veröffentlicht dann in der App.

**Wo einrichten:**
1. Zur [TikTok Developer Platform](https://developers.tiktok.com/) gehen.
2. **Account erstellen** oder anmelden.
3. **App erstellen:**
   - "My Apps" → "Create an app".
   - **App-Name:** z. B. "Tetra Faceless".
   - **Use Case:** "Automated Video Distribution" oder "Content Publishing".
4. **Scopes konfigurieren (Inbox-Modus):**
   - `video.upload` – Hochladen als Entwurf (kein Audit nötig).
   - `user.info.basic` – Benutzerinformationen abrufen.
5. **Redirect-URI:**
   ```
   https://<domain>/api/oauth/tiktok/callback
   ```
6. **Domain verifizieren:**
   - TikTok verlangt Domain- und URL-Verifizierung. Folgen Sie den Anweisungen (Meta-Tag in Website oder DNS-Record).
7. **Client-ID und Client-Secret** kopieren.

**Hinweis zu Scopes:**
- **Jetzt:** `video.upload` (Inbox, kein Audit).
- **Später (WP4.3):** `video.publish` (direktes Posten, benötigt Audit).

**Zielkonto als Tester eintragen:**
- App-Settings → "Testers".
- TikTok-Username des Accounts, auf den Videos hochgeladen werden sollen, hinzufügen.

**Im Panel eintragen:**
- **Client-ID:** aus App-Settings kopieren.
- **Client-Secret:** aus App-Settings kopieren.
- **Modus:** Zunächst `inbox`.

**Fälligkeit:** **Welle 4 (W4)**, konkret vor **WP3.1 OAuth-Framework**.  
*Grund:* OAuth-Setup für TikTok Inbox-Uploads.

---

## 6. TikTok-Audit (Direct-Post-Modus) – Vorbereitung

**Wofür:** Später (Phase 4) direkte Veröffentlichung ohne Inbox-Schritt. Setzt umfangreiches Audit voraus.

**Audit-Anforderungen (TikTok):**
- Öffentliche Website (✓ vorhanden ab WP0.6).
- Datenschutzerklärung (✓ vorhanden ab WP4.2, `https://<domain>/legal/privacy`).
- Nutzungsbedingungen (✓ vorhanden ab WP4.2, `https://<domain>/legal/terms`).
- **Demo-Video:** Aufzeichnung des Flows (Nutzer wählt Video, Tool lädt hoch, Video erscheint im Kanal). Wird in WP4.3 aufgenommen.
- **UX-Anforderungen (müssen im Panel implementiert sein):**
  - Creator-Info-Abfrage.
  - Privacy-Optionen auswählen.
  - KI-Disclosure-Toggles (immer an, nicht abschaltbar).
  - Hinweis "Posted by [App]".

**Wo beantragen:**
- Antrag über TikTok Developer Platform, sobald Audit-UX (WP4.3) demonstrierbar.

**Fälligkeit:** **Vorbereitung ab WP4.2**, **Einreichung ab WP4.3**, **Genehmigung vor WP4.3**.  
*Grund:* Audit läuft ca. 2–4 Wochen; Demo-Video wird für Audit benötigt.

---

## 7. HeyGen-API-Plan und Guthaben

**Wofür:** Video-Generierung. API-Key für HeyGen Video Agent (mit optionalen Avataren, Standard: avatarlos).

**Wo einrichten:**
1. Zur [HeyGen Console](https://app.heygen.com/) gehen (Anmeldung erforderlich).
2. **API-Key generieren:**
   - "Settings" oder "Account" → "API Keys".
   - Neuen Key erstellen und kopieren.
3. **Guthaben aufladen:**
   - "Billing" oder "Plans".
   - Prepaid-Plan kaufen (Kosten ca. 0,0333 USD/Sekunde).
   - **Kosten pro Video:** ca. 1–2 USD für ein 30–60-Sekunden-Video.

**Wichtig (WP0.1 Spike):**
- Prüfen, ob HeyGen **avatarlos** Voiceover + B-Roll + eingebrannte Untertitel erzeugt (Standard für Tetra).
- Falls nein: Fallback-Provider (TTS + Stock-Footage) in Erwägung ziehen.

**Im Panel eintragen:**
- **API-Key:** Aus HeyGen Console kopieren (in `settings_secret.heygen.apiKey` verschlüsselt speichern).
- **Avatar-ID (optional):** Leer lassen für avatarlos (Standard).
- **Voice-ID:** Aus HeyGen Console wählen.

**Fälligkeit:** **Welle 1 (W1)**, konkret vor **WP0.1 (Spike)** für Verifizierung, dann **Welle 4 (W4)** vor **WP1.7** für Live-Smoke-Tests.  
*Grund:* Erst prüfen, ob Lösung passt, dann mit ausreichend Guthaben starten.

---

## 8. Deepseek-Guthaben

**Wofür:** LLM für Thema → Skript → Plattform-Metadaten (Titel, Beschreibung, Hashtags).

**Wo einrichten:**
1. Zur [Deepseek Platform](https://platform.deepseek.com/) gehen.
2. **Account erstellen** und anmelden.
3. **API-Key generieren:**
   - "API Keys" oder "Account Settings".
   - Neuen Key erstellen und kopieren.
4. **Guthaben aufladen:**
   - "Billing".
   - Prepaid-Guthaben kaufen (Costs ca. 0,14 USD pro 1 Mio. Input-Tokens für Deepseek-V3).

**Im Panel eintragen:**
- **API-Key:** Aus Deepseek Platform kopieren (in `settings_secret.deepseek.apiKey` verschlüsselt speichern).

**Fälligkeit:** **Welle 4 (W4)**, konkret vor **WP1.5** für Live-Smoke-Tests.  
*Grund:* Erst andere APIs in Betrieb nehmen, dann LLM einbinden.

---

## 9. Azure-App-Registrierung für OneDrive (privates Konto)

**Wofür:** Archivierung von Videos in Ihrem privaten Microsoft OneDrive nach erfolgreichem Upload zu YouTube/TikTok.

**Wo einrichten:**
1. Zur [Azure Portal](https://portal.azure.com/) gehen, ggf. mit Microsoft-Account anmelden.
2. **App registrieren:**
   - "Azure Active Directory" → "App registrations" → "New registration".
   - **Name:** z. B. "Tetra OneDrive".
   - **Supported account types:** "Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)".
     - **Wichtig:** Dies ist der Tenant `consumers` (private Accounts).
   - "Register" klicken.
3. **Application ID (Client-ID) kopieren** (auf der Übersichtsseite).
4. **Client-Secret erstellen:**
   - "Certificates & secrets" → "New client secret".
   - Description z. B. "Tetra refresh".
   - "Add" klicken.
   - **Value kopieren** (nur jetzt sichtbar!).
5. **API-Berechtigungen (Delegated Permissions):**
   - "API permissions" → "Add a permission" → "Microsoft Graph".
   - "Delegated permissions" → folgende Scopes suchen und anhaken:
     - `Files.ReadWrite` – Dateien lesen/schreiben in OneDrive.
     - `offline_access` – Refresh-Token erhalten.
   - "Add permissions".
6. **Redirect-URI konfigurieren:**
   - "Authentication" → "Add a platform" → "Web".
   - **Redirect URI:**
     ```
     https://<domain>/api/oauth/onedrive/callback
     ```
   - "Configure" klicken.
7. Im Abschnitt "Front-channel logout URL" kann leer gelassen werden.

**Im Panel eintragen (in Settings):**
- **Client-ID:** Aus Azure Portal kopieren.
- **Client-Secret:** Aus Azure Portal kopieren (sicher speichern!).
- **Refresh-Token:** Wird beim ersten OAuth-Flow automatisch gespeichert (verschlüsselt in der Datenbank).

**Wichtig – Datenspeicherung:**
- Refresh-Token wird verschlüsselt in der Datenbank gespeichert (`settings_secret.onedrive.refreshToken`).
- Jeder Refresh rotiert den Token und speichert den neuen Wert atomar.

**OneDrive-Ordnerstruktur:**
- Videos werden automatisch in `/<Projektname>/<Jahr-Monat>/` abgelegt (z. B. `/crypto-news/2026-10/video_123.mp4`).

**Fälligkeit:** **Welle 5 (W5)**, konkret vor **WP3.5 OneDrive-Storage**.  
*Grund:* Erst Uploads funktionieren, dann Archivierung einrichten.

---

## 10. Optionale Zugänge (je nach Situation)

### TTS / Stock-Footage APIs (nur falls nötig)

**Wofür:** Falls WP0.1 feststellt, dass HeyGen nicht avatarlos genug liefert.

**Falls erforderlich:**
- **TTS-API:** Google Cloud Text-to-Speech, Amazon Polly, oder ähnlich.
- **Stock-Footage-Dienst:** Pexels, Pixabay, oder ähnlich (kostenlos oder kostenpflichtig).

**Fälligkeit:** Nur **vor WP1.11**, falls Fallback-Provider nötig.

---

### E-Mail-SMTP oder n8n-Webhook-URL

**Wofür:** Externe Benachrichtigungen (Budgetalarme, Token abgelaufen, Upload-Fehler).

**Wo einrichten:**
1. **E-Mail (SMTP):**
   - SMTP-Server (z. B. SendGrid, AWS SES, Ihr ISP).
   - Host, Port (meist 587 oder 465).
   - Benutzername, Passwort.
   - Von-Adresse.

2. **n8n-Webhook:**
   - n8n-Instanz starten (self-hosted oder cloud).
   - Workflow mit Webhook-Trigger erstellen.
   - Webhook-URL kopieren.

**Im Panel eintragen:**
- Unter "Settings" → "Notifications" → SMTP-Details oder Webhook-URL.

**Fälligkeit:** **Welle 8 (W8)**, konkret vor **WP6.4**.  
*Grund:* Benachrichtigungen sind erst nach grundlegender Funktionalität sinnvoll.

---

## Zusammenfassung: Fälligkeits-Matrix

| Zugang | Fälligkeit | Notwendig bis |
|--------|-----------|------------------|
| Domain + Coolify | **W3** | WP0.6 (Erst-Deployment) |
| Google Cloud + YouTube API | **W4** | WP3.1 (OAuth) |
| YouTube-Brand-Accounts | **W5** | WP3.2 (Live) |
| YouTube-Audit | Antrag: sofort nach W3; Genehmigung: W5+ | WP3.2 |
| TikTok-App (Inbox) | **W4** | WP3.1 (OAuth) |
| TikTok-Audit (Direct) | Antrag: nach WP4.2; Demo: WP4.3 | WP4.3 |
| HeyGen-API + Guthaben | **W1 (Spike)**, dann **W4** | WP0.1 (Test), WP1.7 (Produktion) |
| Deepseek-API + Guthaben | **W4** | WP1.5 (Live) |
| Azure-App + OneDrive | **W5** | WP3.5 (Speicher) |
| E-Mail/n8n (optional) | **W8** | WP6.4 (Benachrichtigungen) |

---

## Checkliste für Nutzer

Drucken oder abhaken, während Sie die Einrichtung durchlaufen:

- [ ] Domain kaufen + DNS konfigurieren + Coolify-Host online
- [ ] Google Cloud Projekt + YouTube API aktiviert + OAuth-Client erstellt
- [ ] Google Consent Screen auf "In production" + Testbenutzer hinzugefügt
- [ ] YouTube-Brand-Account + Kanal erstellt + verifiziert
- [ ] YouTube-Audit beantragt
- [ ] TikTok-Developer-App erstellt + Inbox-Scopes konfiguriert + Tester hinzugefügt
- [ ] HeyGen-API-Key + Guthaben (Prüfung avatarlos in WP0.1)
- [ ] Deepseek-API-Key + Guthaben
- [ ] Azure-App registriert + OneDrive-Scopes + Client-Secret generiert
- [ ] Alle Keys/IDs im Panel eingetragen und Tests erfolgreich
- [ ] Optional: SMTP/n8n konfiguriert

---

## Tipps zur Sicherheit

1. **API-Keys:** Speichern Sie sie lokal in einer verschlüsselten Datei (z. B. KeePass, 1Password) oder Passwort-Manager.
2. **Client-Secrets:** Teilen Sie sie nicht öffentlich. Im Panel werden sie verschlüsselt in der Datenbank gespeichert.
3. **Refresh-Tokens:** Werden von Tetra automatisch rotiert (Microsoft, Google, TikTok) und jeder neue Token wird sofort gespeichert.
4. **Rate Limits:** Tetra respektiert Provider-Rate-Limits (z. B. HeyGen, YouTube) und wartet bei 429-Fehlern.

---

## Fehlerbehebung häufiger Probleme

### Google OAuth: "Refresh token has expired"
- **Ursache:** Consent Screen nicht auf "In production" gestellt.
- **Lösung:** In Google Cloud Console → "OAuth consent screen" → "Publishing status" → "Move to production".

### YouTube Upload fehlgeschlagen: "quotaExceeded"
- **Ursache:** Daily quota erschöpft.
- **Lösung:** Warten bis zum nächsten Tag oder YouTube-Audit beantragen (erhöht Quota).

### TikTok Entwurf wird nicht hochgeladen
- **Ursache:** Zielkonto nicht als Tester in der App registriert.
- **Lösung:** In TikTok Developer Platform → App-Settings → "Testers" → Benutzernamen hinzufügen.

### OneDrive Upload fehlgeschlagen
- **Ursache:** Refresh-Token ungültig oder abgelaufen.
- **Lösung:** Im Panel "Test-Verbindung" für OneDrive klicken → erneut autorisieren (OAuth-Flow).

---

**Fragen oder Probleme?** Konsultieren Sie die Plan-Dokumentation (`docs/superpowers/plans/2026-10-05-faceless-panel-plan.md`) oder kontaktieren Sie den Support.
