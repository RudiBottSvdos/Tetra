import { checkHealth } from '../utils/health'

// Oeffentlich (siehe server/utils/access.ts). Standard = Liveness ohne DB-Zugriff;
// `?deep=1` prueft zusaetzlich die DB-Erreichbarkeit (SELECT 1) und liefert 503, wenn sie fehlt.
export default defineEventHandler(async (event) => {
  const deep = ['1', 'true'].includes(String(getQuery(event).deep ?? ''))
  const result = await checkHealth({
    deep,
    pingDb: async () => {
      const { useDb } = await import('../db')
      const { sql } = await import('drizzle-orm')
      await useDb().execute(sql`select 1`)
    }
  })
  setResponseStatus(event, result.statusCode)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result.body
})
