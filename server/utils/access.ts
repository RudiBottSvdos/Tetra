// Zentrale Allowlist (deny-by-default). WP4.2 erweitert PUBLIC_PAGE_PATTERNS / PUBLIC_API_PATTERNS.
// Muster: '*' = ein Segment, '**' am Ende = beliebiger Rest.
export const PUBLIC_API_PATTERNS: readonly string[] = [
  '/api/auth/**',
  '/api/webhooks/**',
  '/api/oauth/*/callback',
  '/api/health'
]

export const PUBLIC_PAGE_PATTERNS: readonly string[] = ['/', '/login', '/legal/**']

function normalize(path: string): string {
  const p = (path.split('?')[0] ?? '').split('#')[0] ?? ''
  const trimmed = p.length > 1 ? p.replace(/\/+$/, '') : p
  return trimmed || '/'
}

export function matchesPattern(pattern: string, rawPath: string): boolean {
  const path = normalize(rawPath)
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3)
    return path === base || path.startsWith(base + '/')
  }
  const pp = pattern.split('/')
  const sp = path.split('/')
  if (pp.length !== sp.length) return false
  return pp.every((seg, i) => seg === '*' ? !!sp[i] : seg === sp[i])
}

export function isPublicApi(path: string): boolean {
  return PUBLIC_API_PATTERNS.some(p => matchesPattern(p, path))
}

export function isPublicPage(path: string): boolean {
  return PUBLIC_PAGE_PATTERNS.some(p => matchesPattern(p, path))
}

export function isApiPath(path: string): boolean {
  const p = normalize(path)
  return p === '/api' || p.startsWith('/api/')
}

// Entscheidung fuer /api-Routen.
export function decideApiAccess(path: string, hasSession: boolean): 'allow' | 'unauthorized' {
  if (isPublicApi(path)) return 'allow'
  return hasSession ? 'allow' : 'unauthorized'
}
