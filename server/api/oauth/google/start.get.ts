import { defineEventHandler, getQuery, sendRedirect, setCookie, createError } from 'h3'
import { GOOGLE_STATE_COOKIE, STATE_TTL_MS, useGoogleOAuth } from '../../../oauth/google'
import { requireUuid } from '../../../utils/validation'
import { PermanentError } from '../../../providers/errors'

// Geschuetzt (Session via Middleware). Query: projectId (Pflicht), channelId (optional, Reconnect).
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const projectId = requireUuid(q.projectId)
  const channelId = q.channelId === undefined ? undefined : requireUuid(q.channelId)
  const userId = (event.context.session as { user?: { id?: string } } | null | undefined)?.user?.id
  if (!userId) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  try {
    const { url, nonce } = await useGoogleOAuth().createAuthorization({ projectId, userId, channelId })
    setCookie(event, GOOGLE_STATE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/oauth/google',
      maxAge: Math.floor(STATE_TTL_MS / 1000)
    })
    return sendRedirect(event, url, 302)
  } catch (err) {
    if (err instanceof PermanentError) {
      throw createError({ statusCode: err.code === 'project_not_found' ? 404 : 409, statusMessage: err.message })
    }
    throw err
  }
})
