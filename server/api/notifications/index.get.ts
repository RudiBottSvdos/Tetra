import { defineEventHandler } from 'h3'
import { useNotifications } from '../../domain/notifications'
import { toPanelNotification } from '../../utils/notification-dto'

// Geschuetzt durch die Deny-by-default-Middleware (nicht in der Allowlist).
export default defineEventHandler(async () => {
  const rows = await useNotifications().listUnread(50)
  return { notifications: rows.map(toPanelNotification) }
})
