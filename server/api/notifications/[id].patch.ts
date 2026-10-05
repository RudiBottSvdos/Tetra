import { createError, defineEventHandler, getRouterParam } from 'h3'
import { useNotifications } from '../../domain/notifications'
import { requireUuid } from '../../utils/validation'

// Dismiss: markiert die Notification als gelesen (idempotent).
export default defineEventHandler(async (event) => {
  const row = await useNotifications().dismiss(requireUuid(getRouterParam(event, 'id')))
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Benachrichtigung nicht gefunden' })
  return { id: row.id, readAt: row.readAt }
})
