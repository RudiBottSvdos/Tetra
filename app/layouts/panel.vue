<script setup lang="ts">
const route = useRoute()
const session = authClient.useSession()
const { notifications, dismiss } = usePanelNotifications()
const mobileOpen = ref(false)

const items = computed(() =>
  panelNavItems.map(i => ({
    ...i,
    active: route.path === i.to || route.path.startsWith(i.to + '/'),
    onSelect: () => { mobileOpen.value = false }
  }))
)

async function logout() {
  await authClient.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="min-h-screen bg-default text-default lg:flex">
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-default focus:p-2">Zum Inhalt springen</a>

    <header class="flex items-center justify-between border-b border-default p-3 lg:hidden">
      <span class="font-bold">Tetra</span>
      <div class="flex items-center gap-1">
        <UColorModeButton />
        <UButton
          :icon="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'"
          color="neutral"
          variant="ghost"
          aria-label="Navigation umschalten"
          :aria-expanded="mobileOpen"
          aria-controls="panel-sidebar"
          @click="mobileOpen = !mobileOpen"
        />
      </div>
    </header>

    <aside
      id="panel-sidebar"
      :class="[mobileOpen ? 'flex' : 'hidden', 'lg:flex']"
      class="w-full flex-col gap-4 border-b border-default p-4 lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      <NuxtLink to="/dashboard" class="hidden text-xl font-bold lg:block">Tetra</NuxtLink>
      <UNavigationMenu :items="items" orientation="vertical" aria-label="Hauptnavigation" class="flex-1" />
      <div class="space-y-2 border-t border-default pt-3">
        <p class="truncate text-sm text-muted">{{ session.data?.user.email }}</p>
        <div class="flex items-center gap-2">
          <UButton variant="outline" color="neutral" size="sm" icon="i-lucide-log-out" @click="logout">Abmelden</UButton>
          <UColorModeButton class="hidden lg:inline-flex" />
        </div>
      </div>
    </aside>

    <main id="main" class="min-w-0 flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
      <PanelNotificationBanner :notifications="notifications" @dismiss="dismiss" />
      <slot />
    </main>
  </div>
</template>
