<script setup lang="ts">
definePageMeta({ layout: 'legal' })
useSeoMeta({ title: 'Nutzungsbedingungen - Tetra' })
</script>

<template>
  <div class="space-y-6">
    <LegalNotice />
    <h1 class="text-3xl font-bold">Nutzungsbedingungen</h1>
    <p class="text-muted">Stand: [DATUM]</p>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">1. Geltungsbereich und Anbieter</h2>
      <p>
        Diese Bedingungen betreffen das Panel Tetra, betrieben von [NAME], [ANSCHRIFT], E-Mail: [E-MAIL].
        [PRÜFEN: Für wen gelten die Bedingungen, wenn der Dienst nur vom Betreiber selbst genutzt wird?]
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">2. Leistungsbeschreibung</h2>
      <p>
        Tetra ist ein privates Panel zur Verwaltung und Veröffentlichung eigener KI-generierter
        Kurzvideos auf YouTube und TikTok. Es erzeugt Themen und Skripte (Deepseek), lässt Videos
        erstellen (HeyGen), legt Dateien in OneDrive ab und veröffentlicht über die offiziellen
        Schnittstellen von YouTube und TikTok.
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">3. Zugang</h2>
      <p>Der Zugang ist auf den Betreiber beschränkt. Eine Registrierung weiterer Personen ist nicht vorgesehen. [PRÜFEN]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">4. KI-Kennzeichnung und Inhalte</h2>
      <p>
        Veröffentlichte Videos werden als KI-generiert gekennzeichnet. Der Betreiber gibt Themen und
        Videos vor der Veröffentlichung frei. [PRÜFEN: Verantwortung für Inhalte, Urheberrechte, Inhaltsrichtlinien der Plattformen]
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">5. Drittanbieter</h2>
      <p>
        Die Nutzung von YouTube/Google, TikTok, HeyGen, Deepseek und Microsoft OneDrive unterliegt
        zusätzlich deren jeweiligen Bedingungen. [LINKS EINFÜGEN]
      </p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">6. Verfügbarkeit, Haftung, Änderungen</h2>
      <p>[REGELUNGEN ZU VERFÜGBARKEIT, HAFTUNG UND ÄNDERUNGEN VOM BETREIBER FESTLEGEN BZW. RECHTLICH PRÜFEN LASSEN]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">7. Schlussbestimmungen</h2>
      <p>[ANWENDBARES RECHT, GERICHTSSTAND, SALVATORISCHE KLAUSEL - VOM BETREIBER ERGÄNZEN]</p>
    </section>
  </div>
</template>
