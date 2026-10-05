<script setup lang="ts">
definePageMeta({ layout: 'legal' })
useSeoMeta({ title: 'Datenschutzerklärung - Tetra' })
</script>

<template>
  <div class="space-y-6">
    <LegalNotice />
    <h1 class="text-3xl font-bold">Datenschutzerklärung</h1>
    <p class="text-muted">Stand: [DATUM]</p>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">1. Verantwortlicher</h2>
      <p>[NAME]<br>[ANSCHRIFT]<br>E-Mail: [E-MAIL]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">2. Beschreibung des Dienstes</h2>
      <p>
        Tetra ist ein privates Panel zur Verwaltung und Veröffentlichung eigener KI-generierter
        Kurzvideos auf YouTube und TikTok. Es wird nur vom Betreiber selbst genutzt. [PRÜFEN: Gibt es
        weitere Nutzer oder Besucher, deren Daten verarbeitet werden?]
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">3. Verarbeitete Daten</h2>
      <ul class="list-disc pl-6 space-y-1">
        <li><strong>Zugangsdaten des Betreibers:</strong> E-Mail-Adresse und Passwort-Hash für die Anmeldung, Sitzungsdaten. [PRÜFEN: Cookies, Speicherdauer]</li>
        <li><strong>OAuth-Tokens:</strong> Zugriffs- und Refresh-Tokens für Google/YouTube, TikTok und Microsoft OneDrive. Sie werden verschlüsselt in der Datenbank gespeichert und nicht an Dritte weitergegeben.</li>
        <li><strong>Videodaten:</strong> Themen, Skripte, Titel, Beschreibungen, Hashtags, erzeugte Videodateien, Veröffentlichungsstatus und Kennzahlen (z. B. Aufrufe, Likes) der eigenen Videos.</li>
        <li><strong>Technische Daten:</strong> Server-Logdaten (z. B. IP-Adresse, Zeitpunkt, aufgerufene URL). [PRÜFEN: Umfang und Speicherdauer]</li>
        <li><strong>Kostendaten:</strong> Verbrauchs- und Kostenangaben zu API-Aufrufen.</li>
      </ul>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">4. Zwecke und Rechtsgrundlagen</h2>
      <p>[ZWECKE UND RECHTSGRUNDLAGEN (Art. 6 DSGVO) VOM BETREIBER ERGÄNZEN]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">5. Drittanbieter und Empfänger</h2>
      <p>Zur Erbringung des Dienstes werden folgende Anbieter eingebunden. Welche Daten übermittelt werden, ist jeweils angegeben. [PRÜFEN: Sitz, Drittlandübermittlung, Verträge zur Auftragsverarbeitung, Links zu den Datenschutzerklärungen]</p>
      <ul class="list-disc pl-6 space-y-1">
        <li><strong>YouTube / Google:</strong> Upload der Videos samt Metadaten, Abruf von Kennzahlen über die YouTube Data API. Es gelten zusätzlich die YouTube-Nutzungsbedingungen und die Google-Datenschutzerklärung. [LINKS EINFÜGEN]</li>
        <li><strong>TikTok:</strong> Übertragung von Videos und Metadaten über die Content Posting API. [LINK ZUR TIKTOK-DATENSCHUTZERKLÄRUNG EINFÜGEN]</li>
        <li><strong>HeyGen:</strong> Übermittlung des Skripts und von Darstellungsvorgaben zur Videoerzeugung; Rückgabe des Videos.</li>
        <li><strong>Deepseek:</strong> Übermittlung von Themen- und Skriptanfragen (Prompts) zur Texterzeugung. Es werden keine Zugangsdaten übermittelt.</li>
        <li><strong>Microsoft OneDrive:</strong> Ablage der fertigen Videodateien im privaten Konto des Betreibers.</li>
        <li><strong>Hosting:</strong> [HOSTING-ANBIETER / SERVERSTANDORT EINTRAGEN]</li>
      </ul>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">6. Speicherdauer und Löschung</h2>
      <p>
        Videodateien werden lokal nur zwischengespeichert und nach erfolgreichem Upload in OneDrive
        verschoben und lokal gelöscht. Weitere Fristen: [SPEICHERDAUER ERGÄNZEN].
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">7. Widerruf von Zugriffen</h2>
      <p>Verbundene Konten können jederzeit im Panel getrennt werden. Zusätzlich lässt sich der Zugriff direkt beim jeweiligen Anbieter widerrufen:</p>
      <ul class="list-disc pl-6 space-y-1">
        <li>Google: [LINK ZU DEN GOOGLE-KONTOBERECHTIGUNGEN EINTRAGEN]</li>
        <li>TikTok: [ANLEITUNG / LINK EINTRAGEN]</li>
        <li>Microsoft: [LINK ZU DEN MICROSOFT-APP-BERECHTIGUNGEN EINTRAGEN]</li>
      </ul>
      <p>[PRÜFEN: Beschreibung, wie gespeicherte Tokens und Daten nach Trennung gelöscht werden]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">8. Rechte der betroffenen Personen</h2>
      <p>[AUSKUNFT, BERICHTIGUNG, LÖSCHUNG, EINSCHRÄNKUNG, WIDERSPRUCH, DATENÜBERTRAGBARKEIT, BESCHWERDERECHT BEI DER AUFSICHTSBEHÖRDE - TEXT VOM BETREIBER ERGÄNZEN]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">9. Kontakt</h2>
      <p>[E-MAIL]</p>
    </section>
  </div>
</template>
