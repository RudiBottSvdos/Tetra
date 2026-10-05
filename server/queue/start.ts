import { getBoss } from './boss'

/** Startet pg-boss nur, wenn DATABASE_URL gesetzt ist; sonst Warnung und kein Crash. */
export async function startBossIfConfigured(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn('[queue] DATABASE_URL not set, pg-boss not started')
    return false
  }
  await getBoss()
  console.log('[queue] pg-boss started')
  return true
}
