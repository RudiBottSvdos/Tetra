<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Themen"
    description="Themenvorschläge erzeugen, annehmen oder ablehnen."
    icon="i-lucide-lightbulb"
    empty-title="Noch keine Themen"
    empty-description="Hier erscheinen Themenvorschläge, sobald ein Batch erzeugt wurde."
  />
</template>
