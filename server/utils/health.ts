// Health-Check-Logik (ohne Nitro-Abhaengigkeiten, testbar). Gibt bewusst nichts Sensibles preis:
// nur Status und ob die DB erreichbar ist, keine Fehlertexte, Versionen oder Konfiguration.
export interface HealthResult {
  statusCode: 200 | 503
  body: { status: 'ok' | 'degraded', db?: 'up' | 'down' }
}

const DB_TIMEOUT_MS = 3000

export async function checkHealth(options: { deep: boolean, pingDb: () => Promise<unknown> }): Promise<HealthResult> {
  if (!options.deep) return { statusCode: 200, body: { status: 'ok' } }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      options.pingDb(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS) })
    ])
    return { statusCode: 200, body: { status: 'ok', db: 'up' } }
  } catch {
    return { statusCode: 503, body: { status: 'degraded', db: 'down' } }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
