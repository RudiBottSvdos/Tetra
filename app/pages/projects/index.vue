<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Projekte"
    description="Verwalte deine Faceless-Kanäle und Projekte."
    icon="i-lucide-folder-kanban"
    empty-title="Noch keine Projekte"
    empty-description="Lege dein erstes Projekt an, sobald die Projektverwaltung verfügbar ist."
  />
</template>
