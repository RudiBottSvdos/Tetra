<script setup lang="ts">
import { PROJECT_LANGUAGES, VIDEO_PROVIDER_OPTIONS } from '#shared/panel-constants'

export interface ProjectFormValues {
  name: string
  niche: string
  language: string
  stylePrompt: string
  visualStylePrompt: string
  heygenAvatarId: string | null
  heygenVoiceId: string | null
  videoProvider: string
  scriptApprovalRequired: boolean
  dailyBudgetCents: number
  monthlyBudgetCents: number
  targetVideoLengthS: number
  timezone: string
}

const props = defineProps<{
  initial?: Partial<ProjectFormValues>
  errors?: Record<string, string>
  saving?: boolean
  submitLabel?: string
}>()
const emit = defineEmits<{ submit: [values: ProjectFormValues] }>()

const form = reactive({
  name: props.initial?.name ?? '',
  niche: props.initial?.niche ?? '',
  language: props.initial?.language ?? 'de',
  stylePrompt: props.initial?.stylePrompt ?? '',
  visualStylePrompt: props.initial?.visualStylePrompt ?? '',
  heygenAvatarId: props.initial?.heygenAvatarId ?? '',
  heygenVoiceId: props.initial?.heygenVoiceId ?? '',
  videoProvider: props.initial?.videoProvider ?? 'heygen',
  scriptApprovalRequired: props.initial?.scriptApprovalRequired ?? true,
  dailyBudgetEuro: centsToEuro(props.initial?.dailyBudgetCents ?? 300),
  monthlyBudgetEuro: centsToEuro(props.initial?.monthlyBudgetCents ?? 6000),
  targetVideoLengthS: props.initial?.targetVideoLengthS ?? 40,
  timezone: props.initial?.timezone ?? 'Europe/Berlin'
})

const languageItems = PROJECT_LANGUAGES.map(l => ({ label: l.label, value: l.value }))
const providerItems = VIDEO_PROVIDER_OPTIONS.map(l => ({ label: l.label, value: l.value }))
const err = (k: string) => props.errors?.[k]

function onSubmit() {
  emit('submit', {
    name: form.name,
    niche: form.niche,
    language: form.language,
    stylePrompt: form.stylePrompt,
    visualStylePrompt: form.visualStylePrompt,
    heygenAvatarId: form.heygenAvatarId?.trim() ? form.heygenAvatarId.trim() : null,
    heygenVoiceId: form.heygenVoiceId?.trim() ? form.heygenVoiceId.trim() : null,
    videoProvider: form.videoProvider,
    scriptApprovalRequired: form.scriptApprovalRequired,
    dailyBudgetCents: euroToCents(form.dailyBudgetEuro),
    monthlyBudgetCents: euroToCents(form.monthlyBudgetEuro),
    targetVideoLengthS: form.targetVideoLengthS,
    timezone: form.timezone
  })
}
</script>

<template>
  <form class="space-y-6" novalidate @submit.prevent="onSubmit">
    <UAlert v-if="err('_')" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="err('_')" />

    <UCard>
      <template #header><h2 class="font-semibold">Grunddaten</h2></template>
      <div class="space-y-4">
        <UFormField label="Name" required :error="err('name')">
          <UInput v-model="form.name" class="w-full" maxlength="120" name="name" />
        </UFormField>
        <UFormField label="Nische" description="Freitext, z. B. Finanzbildung für Einsteiger." :error="err('niche')">
          <UInput v-model="form.niche" class="w-full" maxlength="500" name="niche" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Sprache" :error="err('language')">
            <USelect v-model="form.language" :items="languageItems" class="w-full" name="language" />
          </UFormField>
          <UFormField label="Zeitzone" description="IANA-Name, z. B. Europe/Berlin." :error="err('timezone')">
            <UInput v-model="form.timezone" class="w-full" name="timezone" />
          </UFormField>
        </div>
        <UFormField label="Stil-Prompt" description="Tonalität und Aufbau der Skripte." :error="err('stylePrompt')">
          <UTextarea v-model="form.stylePrompt" class="w-full" :rows="4" :maxlength="4000" name="stylePrompt" />
        </UFormField>
        <UFormField label="Visueller Stil" description="B-Roll- und Untertitelstil." :error="err('visualStylePrompt')">
          <UTextarea v-model="form.visualStylePrompt" class="w-full" :rows="3" :maxlength="4000" name="visualStylePrompt" />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header><h2 class="font-semibold">Video</h2></template>
      <div class="space-y-4">
        <UFormField label="Ziellänge (Sekunden)" description="Zwischen 30 und 45 Sekunden." :error="err('targetVideoLengthS')">
          <UInputNumber v-model="form.targetVideoLengthS" :min="30" :max="45" :step="1" name="targetVideoLengthS" />
        </UFormField>
        <UFormField label="Video-Anbieter" :error="err('videoProvider')">
          <USelect v-model="form.videoProvider" :items="providerItems" class="w-full sm:w-64" name="videoProvider" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="HeyGen-Avatar-ID" description="Leer lassen für ein avatarloses Video." :error="err('heygenAvatarId')">
            <UInput v-model="form.heygenAvatarId" class="w-full" name="heygenAvatarId" />
          </UFormField>
          <UFormField label="HeyGen-Stimmen-ID" description="Optional." :error="err('heygenVoiceId')">
            <UInput v-model="form.heygenVoiceId" class="w-full" name="heygenVoiceId" />
          </UFormField>
        </div>
        <UFormField :error="err('scriptApprovalRequired')">
          <USwitch
            v-model="form.scriptApprovalRequired"
            label="Skriptfreigabe erforderlich"
            description="Skripte müssen vor der Videoerstellung von dir freigegeben werden (empfohlen)."
          />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header><h2 class="font-semibold">Budget</h2></template>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Tagesbudget (€)" :error="err('dailyBudgetCents')">
          <UInputNumber v-model="form.dailyBudgetEuro" :min="0" :step="0.5" :format-options="{ minimumFractionDigits: 2 }" name="dailyBudget" />
        </UFormField>
        <UFormField label="Monatsbudget (€)" :error="err('monthlyBudgetCents')">
          <UInputNumber v-model="form.monthlyBudgetEuro" :min="0" :step="1" :format-options="{ minimumFractionDigits: 2 }" name="monthlyBudget" />
        </UFormField>
      </div>
    </UCard>

    <div class="flex gap-2">
      <UButton type="submit" :loading="saving" icon="i-lucide-save">{{ submitLabel ?? 'Speichern' }}</UButton>
      <UButton to="/projects" color="neutral" variant="outline">Abbrechen</UButton>
    </div>
  </form>
</template>
