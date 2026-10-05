<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Zeitplan"
    description="Geplante Veröffentlichungen im Überblick."
    icon="i-lucide-calendar-clock"
    empty-title="Keine Veröffentlichungen geplant"
    empty-description="Sobald ein Video eingeplant ist, siehst du es hier."
  />
</template>
