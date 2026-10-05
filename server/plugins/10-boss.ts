import { registerAllHandlers } from '../queue/handlers'
import { startBossIfConfigured } from '../queue/start'
import { stopBoss } from '../queue/boss'

// Laeuft nach 00-migrate.ts (Nitro laedt Plugins alphabetisch) und nur mit DATABASE_URL.
export default defineNitroPlugin(async (nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    await stopBoss()
  })
  registerAllHandlers()
  await startBossIfConfigured()
})
