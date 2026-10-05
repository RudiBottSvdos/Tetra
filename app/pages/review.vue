<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
</script>

<template>
  <PanelPageStub
    title="Review"
    description="Videos prüfen und zur Veröffentlichung freigeben."
    icon="i-lucide-clipboard-check"
    empty-title="Nichts zu prüfen"
    empty-description="Videos, die auf Freigabe warten, erscheinen hier."
  />
</template>
