import { describe, it, expect } from 'vitest'
import { decideIpAccess, parseIp, resolveClientIp } from '../server/utils/ip-allowlist'

const VPN = '178.105.17.179'
type In = Parameters<typeof decideIpAccess>[0]
const d = (o: Partial<In>) =>
  decideIpAccess({ path: '/', allowedIps: VPN, trustedProxyHops: '1', ...o })

describe('ip-allowlist', () => {
  it('erlaubte IP (via XFF, 1 Hop)', () => {
    expect(d({ socketIp: '10.0.0.2', xForwardedFor: VPN })).toBe('allow')
    expect(d({ path: '/api/projects', socketIp: '10.0.0.2', xForwardedFor: VPN })).toBe('allow')
  })
  it('fremde IP wird abgewiesen, auch Login und Auth-API', () => {
    for (const path of ['/', '/login', '/api/auth/sign-in/email', '/api/oauth/google/callback', '/api/webhooks/x']) {
      expect(d({ path, socketIp: '10.0.0.2', xForwardedFor: '8.8.8.8' })).toBe('forbidden')
    }
  })
  it('CIDR', () => {
    const o = { allowedIps: '10.1.0.0/16, 192.168.5.0/24', socketIp: '172.18.0.2' }
    expect(d({ ...o, xForwardedFor: '10.1.200.3' })).toBe('allow')
    expect(d({ ...o, xForwardedFor: '10.2.0.1' })).toBe('forbidden')
    expect(d({ ...o, xForwardedFor: '192.168.5.255' })).toBe('allow')
    expect(d({ ...o, xForwardedFor: '192.168.6.1' })).toBe('forbidden')
  })
  it('IPv6 inkl. CIDR, Port, mapped IPv4', () => {
    const o = { allowedIps: '2001:db8::/32, ::1', socketIp: '172.18.0.2' }
    expect(d({ ...o, xForwardedFor: '2001:db8:abcd::1' })).toBe('allow')
    expect(d({ ...o, xForwardedFor: '2001:db9::1' })).toBe('forbidden')
    expect(d({ ...o, xForwardedFor: '[::1]:5555' })).toBe('allow')
    expect(d({ xForwardedFor: '::ffff:178.105.17.179', socketIp: 'x' })).toBe('allow')
    expect(d({ xForwardedFor: `${VPN}:4711`, socketIp: 'x' })).toBe('allow')
  })
  it('XFF-Spoofing: gefaelschter linker Eintrag hilft nicht', () => {
    expect(d({ socketIp: '10.0.0.2', xForwardedFor: `${VPN}, 8.8.8.8` })).toBe('forbidden')
    expect(d({ socketIp: '10.0.0.2', xForwardedFor: `${VPN}, ${VPN}, 8.8.8.8` })).toBe('forbidden')
    expect(d({ trustedProxyHops: '2', socketIp: 'x', xForwardedFor: `1.1.1.1, ${VPN}, 10.0.0.9` })).toBe('allow')
    expect(d({ trustedProxyHops: '2', socketIp: 'x', xForwardedFor: `${VPN}, 8.8.8.8, 10.0.0.9` })).toBe('forbidden')
  })
  it('Hops=0 ignoriert XFF und nutzt Socket-IP', () => {
    expect(d({ trustedProxyHops: '0', socketIp: '8.8.8.8', xForwardedFor: VPN })).toBe('forbidden')
    expect(d({ trustedProxyHops: '0', socketIp: VPN, xForwardedFor: '8.8.8.8' })).toBe('allow')
  })
  it('fail-closed: nicht ermittelbar oder ungueltig', () => {
    expect(d({})).toBe('forbidden')
    expect(d({ trustedProxyHops: '3', socketIp: 'x', xForwardedFor: VPN })).toBe('forbidden')
    expect(d({ socketIp: 'x', xForwardedFor: 'garbage' })).toBe('forbidden')
    expect(d({ allowedIps: 'nonsense', socketIp: 'x', xForwardedFor: VPN })).toBe('forbidden')
  })
  it('ohne XFF gilt Socket-IP (Proxy-IP ist nicht erlaubt)', () => {
    expect(d({ socketIp: '172.18.0.2' })).toBe('forbidden')
  })
  it('oeffentliche Pfade ohne erlaubte IP', () => {
    const o = { socketIp: '10.0.0.2', xForwardedFor: '8.8.8.8' }
    for (const path of ['/legal/impressum', '/legal', '/api/health', '/api/health?deep=1', '/_nuxt/entry.abc.js', '/favicon.ico']) {
      expect(d({ ...o, path })).toBe('allow')
    }
  })
  it('oeffentliche Pfade nicht per Traversal missbrauchbar', () => {
    const o = { socketIp: '10.0.0.2', xForwardedFor: '8.8.8.8' }
    for (const path of ['/legal/../api/projects', '/legal/%2e%2e/api/x', '/legalx', '/api/health/x', '/api/healthz']) {
      expect(d({ ...o, path })).toBe('forbidden')
    }
  })
  it('ALLOWED_IPS leer = Funktion aus', () => {
    expect(d({ allowedIps: '', socketIp: '8.8.8.8' })).toBe('allow')
    expect(d({ allowedIps: undefined, socketIp: '8.8.8.8' })).toBe('allow')
    expect(d({ allowedIps: '  ', socketIp: '8.8.8.8' })).toBe('allow')
  })
  it('Hilfsfunktionen', () => {
    expect(parseIp('999.1.1.1')).toBeNull()
    expect(parseIp('1.2.3')).toBeNull()
    expect(resolveClientIp('1.2.3.4', undefined, 0)).toBe('1.2.3.4')
  })
})
