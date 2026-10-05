<script setup lang="ts">
const mode = ref<'login' | 'register'>('login')
const state = reactive({ name: '', email: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    const res = mode.value === 'login'
      ? await authClient.signIn.email({ email: state.email, password: state.password })
      : await authClient.signUp.email({ name: state.name, email: state.email, password: state.password })
    if (res.error) error.value = res.error.message ?? 'Fehler'
    else await navigateTo('/dashboard')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UContainer class="py-16 max-w-md">
    <UCard>
      <template #header>
        <h1 class="text-xl font-semibold">{{ mode === 'login' ? 'Anmelden' : 'Registrieren' }}</h1>
      </template>
      <UForm :state="state" class="space-y-4" @submit="submit">
        <UFormField v-if="mode === 'register'" label="Name" name="name">
          <UInput v-model="state.name" required class="w-full" />
        </UFormField>
        <UFormField label="E-Mail" name="email">
          <UInput v-model="state.email" type="email" required class="w-full" />
        </UFormField>
        <UFormField label="Passwort" name="password">
          <UInput v-model="state.password" type="password" required class="w-full" />
        </UFormField>
        <UAlert v-if="error" color="error" :title="error" />
        <UButton type="submit" :loading="loading" block>
          {{ mode === 'login' ? 'Anmelden' : 'Konto erstellen' }}
        </UButton>
      </UForm>
      <template #footer>
        <UButton variant="link" @click="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon ein Konto? Anmelden' }}
        </UButton>
      </template>
    </UCard>
  </UContainer>
</template>
