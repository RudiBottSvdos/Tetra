<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Kosten"
    description="Verbrauch pro Video, Projekt und Zeitraum gegen deine Limits."
    icon="i-lucide-wallet"
    empty-title="Noch keine Kosten erfasst"
    empty-description="Kosten werden angezeigt, sobald Videos erzeugt wurden."
  />
</template>
