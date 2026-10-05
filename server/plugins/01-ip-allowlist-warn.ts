import { parseAllowlist } from '../utils/ip-allowlist'

export default defineNitroPlugin(() => {
  const env = process.env.ALLOWED_IPS
  if (!env || env.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[ip-allowlist] WARNUNG: ALLOWED_IPS ist leer, das Panel ist fuer jede IP erreichbar.')
    }
    return
  }
  const { rules, invalid } = parseAllowlist(env)
  if (invalid.length) console.warn(`[ip-allowlist] ungueltige Eintraege ignoriert: ${invalid.join(', ')}`)
  if (!rules.length) console.warn('[ip-allowlist] KEIN gueltiger Eintrag: alle Panel-Zugriffe werden mit 403 abgewiesen.')
})
