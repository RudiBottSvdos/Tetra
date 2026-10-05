<script setup lang="ts">
defineProps<{
  title: string
  description: string
  icon: string
  emptyTitle: string
  emptyDescription: string
}>()
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold">{{ title }}</h1>
      <p class="text-muted">{{ description }}</p>
    </header>
    <UEmpty :icon="icon" :title="emptyTitle" :description="emptyDescription" variant="outline">
      <slot />
    </UEmpty>
  </div>
</template>
