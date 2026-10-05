<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'panel' })
const session = authClient.useSession()

const cards = [
  { title: 'Aktive Projekte', icon: 'i-lucide-folder-kanban', to: '/projects', hint: 'Noch keine Projekte angelegt.' },
  { title: 'Offene Reviews', icon: 'i-lucide-clipboard-check', to: '/review', hint: 'Nichts zu prüfen.' },
  { title: 'Nächste Veröffentlichung', icon: 'i-lucide-calendar-clock', to: '/schedule', hint: 'Keine Veröffentlichung geplant.' },
  { title: 'Kosten heute', icon: 'i-lucide-wallet', to: '/costs', hint: 'Noch keine Kosten erfasst.' },
  { title: 'Kennzahlen', icon: 'i-lucide-chart-column', to: '/metrics', hint: 'Noch keine Daten vorhanden.' },
  { title: 'Neue Themen', icon: 'i-lucide-lightbulb', to: '/topics', hint: 'Noch keine Themenvorschläge.' }
]
</script>

<template>
  <div class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-2xl font-bold">Dashboard</h1>
      <p class="text-muted">Angemeldet als {{ session.data?.user.email }}</p>
    </header>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <NuxtLink v-for="c in cards" :key="c.title" :to="c.to" class="block rounded-lg focus-visible:outline-2 focus-visible:outline-primary">
        <UCard class="h-full transition hover:bg-elevated">
          <div class="flex items-center gap-2 font-semibold">
            <UIcon :name="c.icon" class="size-5" aria-hidden="true" />
            {{ c.title }}
          </div>
          <p class="mt-2 text-sm text-muted">{{ c.hint }}</p>
        </UCard>
      </NuxtLink>
    </div>
  </div>
</template>
