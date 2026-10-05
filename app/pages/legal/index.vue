<script setup lang="ts">
definePageMeta({ layout: 'legal' })
useSeoMeta({ title: 'Tetra - Über diesen Dienst' })
</script>

<template>
  <div class="space-y-6">
    <LegalNotice />
    <h1 class="text-3xl font-bold">Tetra - Über diesen Dienst</h1>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Zweck</h2>
      <p>
        Tetra ist ein privates Panel zur Verwaltung und Veröffentlichung eigener, KI-generierter
        Kurzvideos auf YouTube und TikTok. Der Dienst wird von einer einzelnen Privatperson
        ([NAME]) für eigene Kanäle betrieben. Er ist kein öffentliches Angebot, es gibt keine
        Registrierung für Dritte, und alle Funktionen sind nur nach Anmeldung des Betreibers erreichbar.
      </p>
      <p>
        Alle veröffentlichten Videos werden als KI-generiert gekennzeichnet (YouTube-Kennzeichnung für
        synthetische Medien, TikTok-AIGC-Label). Vor jeder Veröffentlichung gibt der Betreiber Thema und
        Video manuell frei.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Ablauf</h2>
      <ol class="list-decimal pl-6 space-y-1">
        <li>Themenvorschläge und Skripte werden mit einem Sprachmodell (Deepseek) erzeugt.</li>
        <li>Das Video wird bei HeyGen erzeugt und vorübergehend auf dem Server zwischengespeichert.</li>
        <li>Der Betreiber prüft das Video und gibt es frei.</li>
        <li>Das Video wird über die offiziellen Schnittstellen zu YouTube bzw. TikTok hochgeladen.</li>
        <li>Nach erfolgreichem Upload wird die Datei in den privaten Microsoft-OneDrive-Speicher des Betreibers verschoben und lokal gelöscht.</li>
      </ol>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Genutzte Berechtigungen (Scopes)</h2>
      <p>Der Betreiber verbindet ausschließlich seine eigenen Konten. Geplant sind folgende Berechtigungen, die vor Einreichung eines Audits mit dem tatsächlichen Stand abzugleichen sind:</p>
      <ul class="list-disc pl-6 space-y-1">
        <li><strong>Google / YouTube:</strong> <code>https://www.googleapis.com/auth/youtube.upload</code> (Videos hochladen); [WEITERE SCOPES, z. B. youtube.readonly für Kennzahlen, falls verwendet]</li>
        <li><strong>TikTok:</strong> <code>user.info.basic</code> (Konto zuordnen), <code>video.upload</code> (Entwurf in die TikTok-Inbox), später ggf. <code>video.publish</code> (Direct Post nach bestandenem Audit); [FINALE SCOPE-LISTE PRÜFEN]</li>
        <li><strong>Microsoft OneDrive:</strong> <code>Files.ReadWrite</code>, <code>offline_access</code> (Videos im eigenen OneDrive ablegen)</li>
      </ul>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Weitere Informationen</h2>
      <ul class="list-disc pl-6 space-y-1">
        <li><NuxtLink to="/legal/datenschutz">Datenschutzerklärung</NuxtLink></li>
        <li><NuxtLink to="/legal/nutzungsbedingungen">Nutzungsbedingungen</NuxtLink></li>
        <li><NuxtLink to="/legal/impressum">Impressum</NuxtLink></li>
      </ul>
      <p>Kontakt: [E-MAIL]</p>
    </section>
  </div>
</template>
