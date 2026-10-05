import { SECURITY_HEADERS, HSTS } from '../utils/security-headers'
import { decideApiAccess, isApiPath } from '../utils/access'
import { authLimiter } from '../utils/rate-limit'
import { useAuth } from '../utils/auth'

export default defineEventHandler(async (event) => {
  const path = event.path

  for (const [k, v] of Object.entries(SECURITY_HEADERS)) setResponseHeader(event, k, v)
  if (process.env.NODE_ENV === 'production') setResponseHeader(event, 'Strict-Transport-Security', HSTS)

  if (!isApiPath(path)) return

  // Rate Limit auf Auth-Routen (pro IP), nur zustandsveraendernde Requests.
  if (path.startsWith('/api/auth') && event.method !== 'GET' && event.method !== 'HEAD') {
    const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
    const r = authLimiter.hit(ip)
    if (!r.allowed) {
      setResponseHeader(event, 'Retry-After', r.retryAfter)
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    }
  }

  // Deny-by-default: alles unter /api ausser Allowlist braucht eine Session.
  if (decideApiAccess(path, false) === 'allow') return
  const session = await useAuth().api.getSession({ headers: event.headers }).catch(() => null)
  if (decideApiAccess(path, !!session) === 'unauthorized') {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
  event.context.session = session
})
