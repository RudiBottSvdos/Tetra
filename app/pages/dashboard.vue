<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const session = authClient.useSession()

async function logout() {
  await authClient.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <UContainer class="py-16 space-y-4">
    <h1 class="text-2xl font-bold">Dashboard</h1>
    <p>Angemeldet als {{ session.data?.user.email }}</p>
    <UButton variant="outline" @click="logout">Abmelden</UButton>
  </UContainer>
</template>
