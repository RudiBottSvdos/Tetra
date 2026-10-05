<script setup lang="ts">
definePageMeta({ layout: 'legal' })
useSeoMeta({ title: 'Impressum - Tetra' })
</script>

<template>
  <div class="space-y-6">
    <LegalNotice />
    <h1 class="text-3xl font-bold">Impressum</h1>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Angaben zum Betreiber</h2>
      <p>[NAME]<br>[ANSCHRIFT]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Kontakt</h2>
      <p>E-Mail: [E-MAIL]<br>Telefon: [TELEFON, falls erforderlich]</p>
    </section>

    <section class="space-y-2">
      <h2 class="text-xl font-semibold">Weitere Pflichtangaben</h2>
      <p>[PRÜFEN: Umsatzsteuer-ID, Verantwortlicher für Inhalte, sonstige Angaben je nach Einordnung des Angebots - vom Betreiber zu klären]</p>
    </section>
  </div>
</template>
