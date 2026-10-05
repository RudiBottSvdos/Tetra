<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })

interface SecretStatus { key: string, label: string, description: string, projectOverride: boolean, configured: boolean, masked: string }

const toast = useToast()
const { data, error, refresh } = await useFetch<{ secrets: SecretStatus[], globalMonthlyBudgetCents: number }>('/api/settings')

const inputs = reactive<Record<string, string>>({})
const secretError = ref('')
const budgetEuro = ref(centsToEuro(data.value?.globalMonthlyBudgetCents ?? 15000))
const budgetError = ref('')
const budgetSaving = ref(false)

async function saveSecret(key: string) {
  secretError.value = ''
  try {
    await $fetch(`/api/settings/secrets/${encodeURIComponent(key)}`, { method: 'PUT', body: { value: inputs[key] } })
    inputs[key] = ''
    await refresh()
    toast.add({ title: 'Schlüssel gespeichert', color: 'success' })
  } catch (e) {
    const { message, fields } = parseApiError(e)
    secretError.value = Object.values(fields)[0] ?? message
  }
}
async function removeSecret(key: string) {
  secretError.value = ''
  try {
    await $fetch(`/api/settings/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Schlüssel gelöscht', color: 'success' })
  } catch (e) {
    secretError.value = parseApiError(e).message
  }
}
async function saveBudget() {
  budgetSaving.value = true
  budgetError.value = ''
  try {
    await $fetch('/api/settings/budget', { method: 'PUT', body: { globalMonthlyBudgetCents: euroToCents(budgetEuro.value) } })
    toast.add({ title: 'Monatslimit gespeichert', color: 'success' })
  } catch (e) {
    const { message, fields } = parseApiError(e)
    budgetError.value = Object.values(fields)[0] ?? message
  } finally {
    budgetSaving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold">Einstellungen</h1>
      <p class="text-muted">Globale Schlüssel und Limits. Einzelne Projekte können Schlüssel überschreiben.</p>
    </header>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Einstellungen konnten nicht geladen werden">
      <template #actions><UButton color="neutral" variant="outline" size="sm" @click="refresh()">Erneut versuchen</UButton></template>
    </UAlert>

    <template v-else-if="data">
      <UCard>
        <template #header><h2 class="font-semibold">API-Schlüssel (global)</h2></template>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Gespeicherte Schlüssel werden verschlüsselt abgelegt und nie vollständig angezeigt, nur die letzten vier Zeichen.
            Ein neuer Wert ersetzt den bisherigen. Schlüssel mit dem Hinweis „Projekt-Override möglich“ können in jedem Projekt abweichend gesetzt werden und gelten dort statt des globalen Standards.
          </p>
          <UAlert v-if="secretError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="secretError" />
          <div v-for="s in data.secrets" :key="s.key" :data-secret-key="s.key" class="space-y-2 border-t border-default pt-4 first:border-t-0 first:pt-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ s.label }}</span>
              <UBadge v-if="s.configured" color="success" variant="subtle">Gesetzt {{ s.masked }}</UBadge>
              <UBadge v-else color="warning" variant="subtle">Nicht gesetzt</UBadge>
              <UBadge v-if="s.projectOverride" color="neutral" variant="outline">Projekt-Override möglich</UBadge>
            </div>
            <p class="text-sm text-muted">{{ s.description }}</p>
            <form class="flex flex-wrap gap-2" @submit.prevent="saveSecret(s.key)">
              <UInput v-model="inputs[s.key]" type="password" autocomplete="off" :placeholder="s.configured ? 'Neuen Wert eingeben' : 'Wert eingeben'" :aria-label="s.label" class="w-full sm:w-80" />
              <UButton type="submit" size="sm" :disabled="!inputs[s.key]">Speichern</UButton>
              <UButton v-if="s.configured" size="sm" color="error" variant="outline" @click="removeSecret(s.key)">Löschen</UButton>
            </form>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-semibold">Globales Monatslimit</h2></template>
        <form class="space-y-3" @submit.prevent="saveBudget">
          <UFormField label="Monatslimit über alle Projekte (€)" description="Bei Erreichen wird die Produktion pausiert." :error="budgetError">
            <UInputNumber v-model="budgetEuro" :min="0" :step="5" :format-options="{ minimumFractionDigits: 2 }" />
          </UFormField>
          <UButton type="submit" :loading="budgetSaving" icon="i-lucide-save">Limit speichern</UButton>
        </form>
      </UCard>
    </template>
  </div>
</template>
