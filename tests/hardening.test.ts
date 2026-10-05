import { describe, it, expect, beforeEach } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { decideApiAccess, isApiPath, isPublicApi, isPublicPage } from '../server/utils/access'
import { createRateLimiter } from '../server/utils/rate-limit'
import { claimSignup, isSignupOpen, _resetSignupClaim } from '../server/utils/signup-guard'
import { SECURITY_HEADERS } from '../server/utils/security-headers'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

// Dateiname -> Route (Nitro-Konvention), Parameter durch konkrete Werte ersetzt.
function toRoute(file: string): string {
  const rel = relative(join(process.cwd(), 'server', 'api'), file).split(sep).join('/')
  const noExt = rel.replace(/\.(get|post|put|patch|delete)\.ts$/, '').replace(/\.ts$/, '').replace(/\/index$/, '')
  return '/api/' + noExt.replace(/\[\.\.\.[^\]]+\]/g, 'x/y').replace(/\[[^\]]+\]/g, 'x')
}

describe('Route-Enumeration (deny-by-default)', () => {
  const routes = walk(join(process.cwd(), 'server', 'api')).map(toRoute)

  it('findet Routen', () => expect(routes.length).toBeGreaterThan(0))

  it('jede Route ausserhalb der Allowlist liefert ohne Session 401', () => {
    for (const r of routes) {
      const expected = isPublicApi(r) ? 'allow' : 'unauthorized'
      expect(decideApiAccess(r, false), r).toBe(expected)
    }
  })

  it('unbekannte /api-Pfade sind gesperrt', () => {
    for (const p of ['/api/projects', '/api/secret/x', '/api/authx', '/api/auth-evil', '/api/oauth/youtube', '/api/oauth/x/callback/extra', '/api/healthz', '/api/webhooksfoo'])
      expect(decideApiAccess(p, false), p).toBe('unauthorized')
    expect(decideApiAccess('/api/projects', true)).toBe('allow')
  })

  it('Allowlist enthaelt erwartete oeffentliche Pfade', () => {
    for (const p of ['/api/auth/sign-in/email', '/api/webhooks/heygen', '/api/oauth/youtube/callback', '/api/health', '/api/health/'])
      expect(isPublicApi(p), p).toBe(true)
    expect(isApiPath('/api/x')).toBe(true)
    expect(isApiPath('/login')).toBe(false)
  })

  it('oeffentliche Seiten', () => {
    for (const p of ['/', '/login', '/legal/privacy', '/legal/imprint']) expect(isPublicPage(p), p).toBe(true)
    for (const p of ['/dashboard', '/projects/1', '/settings', '/legalx']) expect(isPublicPage(p), p).toBe(false)
  })
})

describe('Rate Limit', () => {
  it('sperrt nach Limit und gibt nach Fensterablauf frei', () => {
    const l = createRateLimiter(3, 1000)
    for (let i = 0; i < 3; i++) expect(l.hit('ip', 0).allowed).toBe(true)
    const blocked = l.hit('ip', 10)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
    expect(l.hit('other', 10).allowed).toBe(true)
    expect(l.hit('ip', 1001).allowed).toBe(true)
  })
})

describe('Signup-Sperre', () => {
  beforeEach(() => {
    _resetSignupClaim()
    delete process.env.ALLOW_SIGNUP
  })

  it('erster Nutzer darf, zweiter nicht (ohne Neustart)', async () => {
    let users = 0
    const count = async () => users
    expect(await claimSignup(count)).toBe(true)
    users = 1
    _resetSignupClaim() // simuliert Ablauf des Claims; jetzt greift der Count
    expect(await claimSignup(count)).toBe(false)
    expect(await isSignupOpen(count)).toBe(false)
  })

  it('zwei parallele Erst-Registrierungen: nur eine gewinnt', async () => {
    const count = async () => { await new Promise(r => setTimeout(r, 5)); return 0 }
    const res = await Promise.all([claimSignup(count), claimSignup(count)])
    expect(res.filter(Boolean)).toHaveLength(1)
  })

  it('ALLOW_SIGNUP=true erlaubt immer', async () => {
    process.env.ALLOW_SIGNUP = 'true'
    expect(await claimSignup(async () => 5)).toBe(true)
    expect(await isSignupOpen(async () => 5)).toBe(true)
  })
})

describe('Security-Header', () => {
  it('enthaelt die wichtigen Header', () => {
    for (const h of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Content-Security-Policy'])
      expect(SECURITY_HEADERS[h]).toBeTruthy()
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("frame-ancestors 'none'")
  })
})
