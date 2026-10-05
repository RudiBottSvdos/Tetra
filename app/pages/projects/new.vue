<script setup lang="ts">
import type { ProjectFormValues } from '~/components/projects/ProjectForm.vue'

definePageMeta({ middleware: 'auth', layout: 'panel' })

const saving = ref(false)
const errors = ref<Record<string, string>>({})

async function create(values: ProjectFormValues) {
  saving.value = true
  errors.value = {}
  try {
    const p = await $fetch<{ id: string }>('/api/projects', { method: 'POST', body: values })
    await navigateTo(`/projects/${p.id}`)
  } catch (e) {
    const { message, fields } = parseApiError(e)
    errors.value = Object.keys(fields).length ? fields : { _: message }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold">Projekt anlegen</h1>
      <p class="text-muted">Nach dem Anlegen kannst du Wochenplan und Schlüssel-Overrides festlegen.</p>
    </header>
    <ProjectsProjectForm :errors="errors" :saving="saving" submit-label="Projekt anlegen" @submit="create" />
  </div>
</template>
