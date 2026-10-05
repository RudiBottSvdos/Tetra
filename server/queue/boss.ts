import { PgBoss } from 'pg-boss'
import { ALL_QUEUES, CRON_SCHEDULES, DEAD_LETTER_QUEUE, PGBOSS_SCHEMA, queueConfig } from './names'
import { getRegistrations } from './registry'

let instance: PgBoss | null = null
let starting: Promise<PgBoss> | null = null

export function bossOptions(connectionString: string) {
  return { connectionString, schema: PGBOSS_SCHEMA, max: 5 }
}

/** Lazy: erzeugt (und startet) pg-boss erst beim ersten Aufruf. Wirft ohne DATABASE_URL. */
export async function getBoss(): Promise<PgBoss> {
  if (instance) return instance
  starting ??= (async () => {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('[queue] DATABASE_URL nicht gesetzt, pg-boss nicht verfuegbar')
    const boss = new PgBoss(bossOptions(url))
    boss.on('error', error => console.error('[queue] pg-boss error', error))
    await boss.start()
    await setupQueues(boss)
    instance = boss
    return boss
  })().catch((error) => {
    starting = null
    throw error
  })
  return starting
}

/** Queues anlegen (Dead-Letter zuerst), Cron registrieren, Handler aus der Registry anmelden. */
export async function setupQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE, { retentionSeconds: 30 * 24 * 3600 })
  for (const name of ALL_QUEUES) await boss.createQueue(name, queueConfig(name))
  for (const { queue, cron, key } of CRON_SCHEDULES) await boss.schedule(queue, cron, null, { key, tz: 'UTC' })
  for (const { queue, handler, options } of getRegistrations()) {
    await boss.work(queue, options, async (jobs) => {
      for (const job of jobs) await handler(job)
    })
  }
}

export function isBossRunning(): boolean {
  return instance !== null
}

/** Sauberes Herunterfahren: laufende Jobs duerfen kurz zu Ende laufen. */
export async function stopBoss(timeoutMs = 20_000): Promise<void> {
  const pending = starting
  starting = null
  const boss = instance ?? (pending ? await pending.catch(() => null) : null)
  instance = null
  if (!boss) return
  await boss.stop({ graceful: true, timeout: timeoutMs })
}
