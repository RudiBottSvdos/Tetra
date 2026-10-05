export type PanelNotificationType = 'cost_alert' | 'budget_pause' | 'token_expired' | 'error' | 'info'

export interface PanelNotification {
  id: string
  type: PanelNotificationType
  title: string
  message: string
  createdAt: string
  actionLabel?: string
  actionTo?: string
}

/**
 * Benachrichtigungen fürs Panel über GET /api/notifications und PATCH /api/notifications/:id.
 * Fehler (offline, 401, 5xx) werden toleriert: das Banner bleibt dann einfach leer.
 */
export function usePanelNotifications() {
  const notifications = useState<PanelNotification[]>('panel-notifications', () => [])

  const refresh = async () => {
    try {
      const res = await $fetch<{ notifications: PanelNotification[] }>('/api/notifications')
      notifications.value = Array.isArray(res?.notifications) ? res.notifications : []
    } catch {
      // tolerant: bestehende Liste behalten
    }
  }

  const dismiss = async (id: string) => {
    const previous = notifications.value
    notifications.value = previous.filter(n => n.id !== id)
    try {
      await $fetch(`/api/notifications/${id}`, { method: 'PATCH' })
    } catch {
      // Dismiss lokal beibehalten; beim nächsten Refresh erscheint sie ggf. erneut
    }
  }

  if (import.meta.client && !notifications.value.length) void refresh()

  return { notifications, dismiss, refresh }
}
