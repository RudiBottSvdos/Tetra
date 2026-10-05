<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Kennzahlen"
    description="Leistung deiner veröffentlichten Videos."
    icon="i-lucide-chart-column"
    empty-title="Noch keine Kennzahlen"
    empty-description="Kennzahlen erscheinen nach den ersten Veröffentlichungen."
  />
</template>
