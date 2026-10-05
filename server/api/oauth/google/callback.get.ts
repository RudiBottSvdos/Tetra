import { defineEventHandler, deleteCookie, getCookie, getQuery, sendRedirect, setResponseHeader } from 'h3'
import { GOOGLE_STATE_COOKIE, OAuthStateError, useGoogleOAuth } from '../../../oauth/google'
import { ProviderError } from '../../../providers/errors'
import { useAuth } from '../../../utils/auth'

// Oeffentlich laut access.ts (/api/oauth/*/callback): state wird hier selbst validiert
// (verschluesselt+authentifiziert, 10 min, an Cookie-Nonce und Session-User gebunden).
// Antworten enthalten nie Tokens oder Provider-Bodies, nur kurze Fehlercodes.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  const q = getQuery(event)
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const cookieNonce = getCookie(event, GOOGLE_STATE_COOKIE)
  deleteCookie(event, GOOGLE_STATE_COOKIE, { path: '/api/oauth/google' }) // einmalig verwendbar
  const fail = (reason: string) => sendRedirect(event, `/projects?youtube=error&reason=${encodeURIComponent(reason)}`, 302)

  const session = await useAuth().api.getSession({ headers: event.headers }).catch(() => null)
  const userId = session?.user?.id
  if (!userId) return sendRedirect(event, '/login', 302)
  if (str(q.error)) return fail('denied')

  try {
    const r = await useGoogleOAuth().handleCallback({
      code: str(q.code), state: str(q.state), cookieNonce, sessionUserId: userId
    })
    return sendRedirect(event, `/projects/${r.projectId}?youtube=connected`, 302)
  } catch (err) {
    if (err instanceof OAuthStateError) return fail(`state_${err.code}`)
    if (err instanceof ProviderError) return fail(err.code ?? 'provider_error')
    return fail('internal_error')
  }
})
