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

const mockNotifications: PanelNotification[] = [
  {
    id: 'mock-1',
    type: 'cost_alert',
    title: 'Kostenalarm',
    message: '80 % des Tagesbudgets sind verbraucht (Beispieldaten).',
    createdAt: '2026-10-05T08:00:00.000Z',
    actionLabel: 'Kosten ansehen',
    actionTo: '/costs'
  },
  {
    id: 'mock-2',
    type: 'token_expired',
    title: 'Token abgelaufen',
    message: 'Der YouTube-Zugang muss erneuert werden (Beispieldaten).',
    createdAt: '2026-10-05T07:30:00.000Z',
    actionLabel: 'Einstellungen',
    actionTo: '/settings'
  }
]

/**
 * Liefert Benachrichtigungen fürs Panel. Aktuell Mock-Daten;
 * später durch GET /api/notifications ersetzen.
 */
export function usePanelNotifications() {
  const notifications = useState<PanelNotification[]>('panel-notifications', () => [...mockNotifications])
  const dismiss = (id: string) => {
    notifications.value = notifications.value.filter(n => n.id !== id)
  }
  return { notifications, dismiss }
}
