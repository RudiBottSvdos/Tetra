import { isIP } from 'node:net'
import { matchesPattern } from './access'

// IP-Sperre (Ebene 2, App). Ebene 1 ist die Traefik-IPAllowList, siehe docs/deployment-coolify.md.
// Bewusst NICHT identisch mit PUBLIC_PAGE_PATTERNS/PUBLIC_API_PATTERNS aus access.ts:
// Login, /api/auth/**, Webhooks und OAuth-Callbacks sind hinter der IP-Sperre.
// /_nuxt/** (gehashte Client-Bundles, enthalten keine Secrets; Legal-Seiten brauchen dieselben
// Entry-Chunks, eine Trennung ist nicht moeglich) sowie favicon/robots bleiben oeffentlich.
export const IP_PUBLIC_PATTERNS: readonly string[] = [
  '/legal/**',
  '/api/health',
  '/_nuxt/**',
  '/__nuxt_error',
  '/favicon.ico',
  '/robots.txt'
]

export interface IpRule { v6: boolean, net: bigint, bits: number }

function parseV4(s: string): bigint | null {
  const p = s.split('.')
  if (p.length !== 4) return null
  let n = 0n
  for (const seg of p) {
    if (!/^\d{1,3}$/.test(seg) || Number(seg) > 255) return null
    n = (n << 8n) | BigInt(seg)
  }
  return n
}

function parseV6(raw: string): bigint | null {
  let s = raw
  const zone = s.indexOf('%')
  if (zone >= 0) s = s.slice(0, zone)
  if (isIP(s) !== 6) return null
  // eingebettetes IPv4 am Ende (::ffff:1.2.3.4) in zwei Hextets umwandeln
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseV4(tail)
    if (v4 === null) return null
    s = `${s.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  if (groups.length !== 8) return null
  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    n = (n << 16n) | BigInt(`0x${g}`)
  }
  return n
}

// Normalisiert eine IP (IPv4-mapped IPv6 wird zu IPv4). Null bei ungueltiger Eingabe.
export function parseIp(raw: string): { v6: boolean, value: bigint } | null {
  const s = raw.trim()
  if (!s) return null
  const kind = isIP(s.split('%')[0] ?? '')
  if (kind === 4) {
    const v = parseV4(s)
    return v === null ? null : { v6: false, value: v }
  }
  if (kind === 6) {
    const v = parseV6(s)
    if (v === null) return null
    if ((v >> 32n) === 0xffffn) return { v6: false, value: v & 0xffffffffn }
    return { v6: true, value: v }
  }
  return null
}

export function parseRule(entry: string): IpRule | null {
  const [addr, len, ...extra] = entry.trim().split('/')
  if (extra.length || !addr) return null
  const ip = parseIp(addr)
  if (!ip) return null
  // ::ffff:a.b.c.d/N: Praefix bezieht sich auf die 128 Bit der v6-Schreibweise.
  const mappedFromV6 = !ip.v6 && addr.includes(':')
  const max = ip.v6 ? 128 : 32
  let bits = max
  if (len !== undefined) {
    if (!/^\d{1,3}$/.test(len)) return null
    bits = Number(len)
    if (mappedFromV6) bits -= 96
    if (bits < 0 || bits > max) return null
  }
  const shift = BigInt(max - bits)
  return { v6: ip.v6, net: (ip.value >> shift) << shift, bits }
}

export interface ParsedAllowlist { rules: IpRule[], invalid: string[] }

let cache: { key: string, value: ParsedAllowlist } | null = null

export function parseAllowlist(env: string | undefined): ParsedAllowlist {
  const key = env ?? ''
  if (cache && cache.key === key) return cache.value
  const rules: IpRule[] = []
  const invalid: string[] = []
  for (const part of key.split(',').map(s => s.trim()).filter(Boolean)) {
    const r = parseRule(part)
    if (r) rules.push(r)
    else invalid.push(part)
  }
  cache = { key, value: { rules, invalid } }
  return cache.value
}

export function isIpAllowed(ip: string, rules: readonly IpRule[]): boolean {
  const p = parseIp(ip)
  if (!p) return false
  const max = p.v6 ? 128 : 32
  return rules.some((r) => {
    if (r.v6 !== p.v6) return false
    const shift = BigInt(max - r.bits)
    return (p.value >> shift) << shift === r.net
  })
}

// "1.2.3.4", "1.2.3.4:5678", "[::1]:80", "::1" -> reine IP.
function stripPort(raw: string): string {
  const s = raw.trim()
  if (s.startsWith('[')) {
    const end = s.indexOf(']')
    return end > 0 ? s.slice(1, end) : s
  }
  if (/^[^:]+:\d+$/.test(s)) return s.slice(0, s.lastIndexOf(':'))
  return s
}

export function parseTrustedHops(env: string | undefined): number {
  if (env === undefined || env.trim() === '') return 1
  const n = Number(env)
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1
}

// Ermittelt die Client-IP. Mit hops > 0 wird der hops-te Eintrag VON RECHTS aus X-Forwarded-For
// genommen (jeder vertrauenswuerdige Proxy haengt die ihm bekannte Peer-IP rechts an; links stehende
// Eintraege sind vom Client faelschbar). Fehlt der Header komplett, gilt die Socket-IP (die dann
// i. d. R. die Proxy-IP ist und nicht erlaubt wird). Zu kurze/ungueltige Kette -> null (fail-closed).
export function resolveClientIp(socketIp: string | undefined, xff: string | string[] | undefined, hops: number): string | null {
  const socket = socketIp && parseIp(stripPort(socketIp)) ? stripPort(socketIp) : null
  const header = Array.isArray(xff) ? xff.join(',') : xff
  if (hops <= 0 || header === undefined || header.trim() === '') return socket
  const chain = header.split(',').map(s => s.trim())
  const entry = chain[chain.length - hops]
  if (entry === undefined) return null
  const ip = stripPort(entry)
  return parseIp(ip) ? ip : null
}

function isPublicPath(path: string): boolean {
  const bare = path.split('?')[0] ?? ''
  if (/\.\.|%2e|%2f|%5c|\\/i.test(bare)) return false
  return IP_PUBLIC_PATTERNS.some(p => matchesPattern(p, bare))
}

export interface IpDecisionInput {
  path: string
  socketIp?: string
  xForwardedFor?: string | string[]
  allowedIps?: string
  trustedProxyHops?: string
}

export function decideIpAccess(i: IpDecisionInput): 'allow' | 'forbidden' {
  if (!i.allowedIps || i.allowedIps.trim() === '') return 'allow' // Funktion aus
  if (isPublicPath(i.path)) return 'allow'
  const { rules } = parseAllowlist(i.allowedIps)
  const ip = resolveClientIp(i.socketIp, i.xForwardedFor, parseTrustedHops(i.trustedProxyHops))
  if (!ip) return 'forbidden'
  return isIpAllowed(ip, rules) ? 'allow' : 'forbidden'
}
