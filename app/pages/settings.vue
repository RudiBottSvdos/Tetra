<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Einstellungen"
    description="Konten, Schlüssel, Limits und Verbindungen."
    icon="i-lucide-settings"
    empty-title="Noch keine Einstellungen verfügbar"
    empty-description="Verbindungen und Limits lassen sich hier später konfigurieren."
  />
</template>
