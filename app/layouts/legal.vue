<template>
  <div class="min-h-screen bg-default text-default">
    <header class="border-b border-default">
      <UContainer class="py-4 flex flex-wrap items-center justify-between gap-2">
        <NuxtLink to="/legal" class="font-semibold">Tetra</NuxtLink>
        <nav aria-label="Rechtliche Informationen" class="flex flex-wrap gap-4 text-sm">
          <NuxtLink to="/legal/datenschutz">Datenschutz</NuxtLink>
          <NuxtLink to="/legal/nutzungsbedingungen">Nutzungsbedingungen</NuxtLink>
          <NuxtLink to="/legal/impressum">Impressum</NuxtLink>
        </nav>
      </UContainer>
    </header>
    <main>
      <UContainer class="py-10 max-w-3xl space-y-6">
        <slot />
      </UContainer>
    </main>
    <footer class="border-t border-default">
      <UContainer class="py-4 text-sm text-muted">Tetra - privates Panel eines Einzelbetreibers</UContainer>
    </footer>
  </div>
</template>
