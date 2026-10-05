<script setup lang="ts">
import type { PanelNotification, PanelNotificationType } from '~/composables/usePanelNotifications'

defineProps<{ notifications: PanelNotification[] }>()
const emit = defineEmits<{ dismiss: [id: string] }>()

const styles: Record<PanelNotificationType, { color: 'warning' | 'error' | 'info', icon: string }> = {
  cost_alert: { color: 'warning', icon: 'i-lucide-triangle-alert' },
  budget_pause: { color: 'error', icon: 'i-lucide-circle-pause' },
  token_expired: { color: 'warning', icon: 'i-lucide-key-round' },
  error: { color: 'error', icon: 'i-lucide-circle-x' },
  info: { color: 'info', icon: 'i-lucide-info' }
}
</script>

<template>
  <div v-if="notifications.length" class="space-y-2" role="region" aria-label="Benachrichtigungen">
    <UAlert
      v-for="n in notifications"
      :key="n.id"
      :color="styles[n.type].color"
      variant="subtle"
      :icon="styles[n.type].icon"
      :title="n.title"
      :description="n.message"
      :actions="n.actionLabel && n.actionTo ? [{ label: n.actionLabel, to: n.actionTo, color: 'neutral', variant: 'outline', size: 'xs' }] : undefined"
      :close="{ 'aria-label': 'Hinweis schließen' }"
      :data-notification-type="n.type"
      @update:open="(open: boolean) => !open && emit('dismiss', n.id)"
    />
  </div>
</template>
