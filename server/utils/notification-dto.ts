import type { NotificationRecord, NotificationType } from '../domain/notifications'

const META: Record<NotificationType, { title: string, actionLabel?: string, actionTo?: string }> = {
  cost_alert: { title: 'Kostenalarm', actionLabel: 'Kosten ansehen', actionTo: '/costs' },
  budget_pause: { title: 'Produktion pausiert', actionLabel: 'Kosten ansehen', actionTo: '/costs' },
  token_expired: { title: 'Token abgelaufen', actionLabel: 'Einstellungen', actionTo: '/settings' },
  error: { title: 'Fehler' },
  info: { title: 'Hinweis' }
}

/** Form, die das Panel-Banner erwartet (unbekannte Typen fallen auf info zurueck). */
export function toPanelNotification(n: NotificationRecord) {
  const type = (n.type in META ? n.type : 'info') as NotificationType
  const m = META[type]
  return {
    id: n.id, type, title: m.title, message: n.message,
    createdAt: n.createdAt.toISOString(),
    ...(m.actionLabel && { actionLabel: m.actionLabel, actionTo: m.actionTo })
  }
}
