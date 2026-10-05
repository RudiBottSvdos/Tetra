<script setup lang="ts">
import { PROJECT_LANGUAGES } from '#shared/panel-constants'

definePageMeta({ middleware: 'auth', layout: 'panel' })

interface ProjectListItem { id: string, name: string, niche: string, language: string, productionPaused: boolean, scriptApprovalRequired: boolean, monthlyBudgetCents: number }

const { data: projects, status, error, refresh } = await useFetch<ProjectListItem[]>('/api/projects', { default: () => [] })
const langLabel = (v: string) => PROJECT_LANGUAGES.find(l => l.value === v)?.label ?? v
</script>

<template>
  <div class="space-y-6">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-bold">Projekte</h1>
        <p class="text-muted">Verwalte deine Faceless-Kanäle und Projekte.</p>
      </div>
      <UButton to="/projects/new" icon="i-lucide-plus">Projekt anlegen</UButton>
    </header>

    <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Projekte konnten nicht geladen werden">
      <template #actions><UButton color="neutral" variant="outline" size="sm" @click="refresh()">Erneut versuchen</UButton></template>
    </UAlert>

    <p v-else-if="status === 'pending'" class="text-muted" role="status">Projekte werden geladen …</p>

    <UEmpty
      v-else-if="!projects.length"
      icon="i-lucide-folder-kanban"
      title="Noch keine Projekte"
      description="Lege dein erstes Projekt an, um Themen, Skripte und Videos zu planen."
      variant="outline"
    >
      <UButton to="/projects/new" icon="i-lucide-plus">Projekt anlegen</UButton>
    </UEmpty>

    <ul v-else class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Projektliste">
      <li v-for="p in projects" :key="p.id">
        <UCard class="h-full">
          <div class="space-y-2">
            <div class="flex items-start justify-between gap-2">
              <h2 class="font-semibold">
                <NuxtLink :to="`/projects/${p.id}`" class="hover:underline focus-visible:underline">{{ p.name }}</NuxtLink>
              </h2>
              <UBadge v-if="p.productionPaused" color="warning" variant="subtle">Pausiert</UBadge>
            </div>
            <p class="text-sm text-muted">{{ p.niche || 'Keine Nische angegeben' }}</p>
            <div class="flex flex-wrap gap-2 text-xs">
              <UBadge color="neutral" variant="outline">{{ langLabel(p.language) }}</UBadge>
              <UBadge color="neutral" variant="outline">Monatsbudget {{ formatEuro(p.monthlyBudgetCents) }}</UBadge>
              <UBadge color="neutral" variant="outline">{{ p.scriptApprovalRequired ? 'Skriptfreigabe an' : 'Skriptfreigabe aus' }}</UBadge>
            </div>
            <UButton :to="`/projects/${p.id}`" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil">Bearbeiten</UButton>
          </div>
        </UCard>
      </li>
    </ul>
  </div>
</template>
