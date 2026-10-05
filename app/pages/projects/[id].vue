<script setup lang="ts">
import type { ProjectFormValues } from '~/components/projects/ProjectForm.vue'
import { WEEKDAY_LABELS } from '#shared/panel-constants'

definePageMeta({ middleware: 'auth', layout: 'panel' })

interface SecretStatus { key: string, label: string, description: string, configured: boolean, masked: string, source: 'project' | 'global' | null }
interface Rule { weekday: number, timeLocal: string, videosPerDay: number, enabled: boolean }

const route = useRoute()
const id = route.params.id as string
const toast = useToast()

const { data: project, error: loadError } = await useFetch<ProjectFormValues & { id: string }>(`/api/projects/${id}`)
const { data: secretsData, refresh: refreshSecrets } = await useFetch<{ secrets: SecretStatus[] }>(`/api/projects/${id}/secrets`)
const { data: scheduleData } = await useFetch<{ rules: Rule[] }>(`/api/projects/${id}/schedule`)

const saving = ref(false)
const errors = ref<Record<string, string>>({})

async function save(values: ProjectFormValues) {
  saving.value = true
  errors.value = {}
  try {
    await $fetch(`/api/projects/${id}`, { method: 'PATCH', body: values })
    toast.add({ title: 'Projekt gespeichert', color: 'success' })
  } catch (e) {
    const { message, fields } = parseApiError(e)
    errors.value = Object.keys(fields).length ? fields : { _: message }
  } finally {
    saving.value = false
  }
}

// Wochenplan
const rules = ref<Rule[]>((scheduleData.value?.rules ?? []).map(r => ({ ...r, timeLocal: r.timeLocal.slice(0, 5) })))
const scheduleSaving = ref(false)
const scheduleError = ref('')
const weekdayItems = WEEKDAY_LABELS.map((label, value) => ({ label, value }))
const addRule = () => rules.value.push({ weekday: 1, timeLocal: '12:00', videosPerDay: 1, enabled: true })
const removeRule = (i: number) => rules.value.splice(i, 1)
async function saveSchedule() {
  scheduleSaving.value = true
  scheduleError.value = ''
  try {
    await $fetch(`/api/projects/${id}/schedule`, { method: 'PUT', body: { rules: rules.value } })
    toast.add({ title: 'Wochenplan gespeichert', color: 'success' })
  } catch (e) {
    const { message, fields } = parseApiError(e)
    scheduleError.value = Object.values(fields)[0] ?? message
  } finally {
    scheduleSaving.value = false
  }
}

// Projekt-Overrides für Schlüssel
const secretInputs = reactive<Record<string, string>>({})
const secretError = ref('')
async function saveOverride(key: string) {
  secretError.value = ''
  try {
    await $fetch(`/api/projects/${id}/secrets/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: secretInputs[key] } })
    secretInputs[key] = ''
    await refreshSecrets()
    toast.add({ title: 'Override gespeichert', color: 'success' })
  } catch (e) {
    const { message, fields } = parseApiError(e)
    secretError.value = Object.values(fields)[0] ?? message
  }
}
async function removeOverride(key: string) {
  secretError.value = ''
  try {
    await $fetch(`/api/projects/${id}/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' })
    await refreshSecrets()
    toast.add({ title: 'Override entfernt', color: 'success' })
  } catch (e) {
    secretError.value = parseApiError(e).message
  }
}

// Löschen
const deleteOpen = ref(false)
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await $fetch(`/api/projects/${id}`, { method: 'DELETE' })
    await navigateTo('/projects')
  } catch (e) {
    toast.add({ title: 'Löschen fehlgeschlagen', description: parseApiError(e).message, color: 'error' })
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-8">
    <UAlert v-if="loadError || !project" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Projekt nicht gefunden">
      <template #actions><UButton to="/projects" color="neutral" variant="outline" size="sm">Zur Projektliste</UButton></template>
    </UAlert>

    <template v-else>
      <header class="space-y-1">
        <h1 class="text-2xl font-bold">{{ project.name }}</h1>
        <p class="text-muted">Projekt bearbeiten.</p>
      </header>

      <ProjectsProjectForm :initial="project" :errors="errors" :saving="saving" @submit="save" />

      <UCard>
        <template #header><h2 class="font-semibold">Wochenplan</h2></template>
        <div class="space-y-4">
          <p class="text-sm text-muted">Zeiten gelten in der Zeitzone des Projekts ({{ project.timezone }}).</p>
          <UAlert v-if="scheduleError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="scheduleError" />
          <p v-if="!rules.length" class="text-sm text-muted">Noch keine Zeitfenster festgelegt.</p>
          <ul class="space-y-3">
            <li v-for="(r, i) in rules" :key="i" class="flex flex-wrap items-end gap-3">
              <UFormField label="Wochentag"><USelect v-model="r.weekday" :items="weekdayItems" class="w-40" /></UFormField>
              <UFormField label="Uhrzeit"><UInput v-model="r.timeLocal" type="time" class="w-32" /></UFormField>
              <UFormField label="Videos pro Tag"><UInputNumber v-model="r.videosPerDay" :min="1" :max="10" /></UFormField>
              <USwitch v-model="r.enabled" label="Aktiv" />
              <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="`Zeitfenster ${i + 1} entfernen`" @click="removeRule(i)" />
            </li>
          </ul>
          <div class="flex flex-wrap gap-2">
            <UButton color="neutral" variant="outline" icon="i-lucide-plus" @click="addRule">Zeitfenster hinzufügen</UButton>
            <UButton :loading="scheduleSaving" icon="i-lucide-save" @click="saveSchedule">Wochenplan speichern</UButton>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-semibold">Schlüssel für dieses Projekt</h2></template>
        <div class="space-y-4">
          <p class="text-sm text-muted">Ohne Override gilt der globale Standard aus den Einstellungen. Gespeicherte Werte werden nie angezeigt, nur die letzten vier Zeichen.</p>
          <UAlert v-if="secretError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="secretError" />
          <div v-for="s in secretsData?.secrets ?? []" :key="s.key" class="space-y-2 border-t border-default pt-4 first:border-t-0 first:pt-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ s.label }}</span>
              <UBadge v-if="s.source === 'project'" color="primary" variant="subtle">Projekt-Override {{ s.masked }}</UBadge>
              <UBadge v-else-if="s.source === 'global'" color="neutral" variant="subtle">Globaler Standard {{ s.masked }}</UBadge>
              <UBadge v-else color="warning" variant="subtle">Nicht gesetzt</UBadge>
            </div>
            <form class="flex flex-wrap gap-2" @submit.prevent="saveOverride(s.key)">
              <UInput v-model="secretInputs[s.key]" type="password" autocomplete="off" :placeholder="`Neuer Override für ${s.label}`" :aria-label="`Override für ${s.label}`" class="w-full sm:w-80" />
              <UButton type="submit" size="sm" :disabled="!secretInputs[s.key]">Override setzen</UButton>
              <UButton v-if="s.source === 'project'" size="sm" color="neutral" variant="outline" @click="removeOverride(s.key)">Override entfernen</UButton>
            </form>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-semibold text-error">Projekt löschen</h2></template>
        <p class="mb-3 text-sm text-muted">Entfernt das Projekt samt Zeitplan und Overrides dauerhaft.</p>
        <UButton color="error" variant="outline" icon="i-lucide-trash-2" @click="deleteOpen = true">Projekt löschen</UButton>
        <UModal v-model:open="deleteOpen" title="Projekt wirklich löschen?" description="Diese Aktion kann nicht rückgängig gemacht werden.">
          <template #footer>
            <UButton color="neutral" variant="outline" @click="deleteOpen = false">Abbrechen</UButton>
            <UButton color="error" :loading="deleting" @click="remove">Endgültig löschen</UButton>
          </template>
        </UModal>
      </UCard>
    </template>
  </div>
</template>
