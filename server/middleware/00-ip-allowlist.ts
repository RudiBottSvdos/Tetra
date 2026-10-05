import { decideIpAccess } from '../utils/ip-allowlist'

// Laeuft vor 01-security. Nicht erlaubte IPs: schlichtes 403, keine Hinweise.
export default defineEventHandler((event) => {
  const verdict = decideIpAccess({
    path: event.path,
    socketIp: event.node.req.socket?.remoteAddress,
    xForwardedFor: event.node.req.headers['x-forwarded-for'],
    allowedIps: process.env.ALLOWED_IPS,
    trustedProxyHops: process.env.TRUSTED_PROXY_HOPS
  })
  if (verdict === 'allow') return
  setResponseStatus(event, 403)
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return 'Forbidden'
})
