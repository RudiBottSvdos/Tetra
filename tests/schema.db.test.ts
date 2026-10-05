// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as s from '../server/db/schema'

const url = process.env.TEST_DATABASE_URL
if (!url) console.warn('[schema.db.test] TEST_DATABASE_URL nicht gesetzt: DB-Tests uebersprungen')

describe.skipIf(!url)('schema constraints (Postgres)', () => {
  let client: ReturnType<typeof postgres>
  let db: ReturnType<typeof drizzle>
  const schemaName = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`

  beforeAll(async () => {
    const admin = postgres(url!, { max: 1 })
    await admin.unsafe(`create schema ${schemaName}`)
    await admin.end()
    client = postgres(url!, { max: 1, connection: { search_path: schemaName } })
    db = drizzle(client)
    await migrate(db, { migrationsFolder: join(__dirname, '..', 'drizzle'), migrationsSchema: schemaName })
  })

  afterAll(async () => {
    await client?.end()
    const admin = postgres(url!, { max: 1 })
    await admin.unsafe(`drop schema if exists ${schemaName} cascade`)
    await admin.end()
  })

  async function newProject() {
    const [p] = await db.insert(s.project).values({ name: 'p' }).returning()
    return p!
  }

  it('rejects ai_label = false and duplicate publication per channel', async () => {
    const p = await newProject()
    const [ch] = await db.insert(s.channel).values({ projectId: p.id, platform: 'youtube', displayName: 'c' }).returning()
    const [v] = await db.insert(s.video).values({ projectId: p.id }).returning()
    await expect(db.insert(s.publication).values({ videoId: v!.id, channelId: ch!.id, platform: 'youtube', aiLabel: false })).rejects.toThrow()
    const [ok] = await db.insert(s.publication).values({ videoId: v!.id, channelId: ch!.id, platform: 'youtube' }).returning()
    expect(ok!.aiLabel).toBe(true)
    await expect(db.insert(s.publication).values({ videoId: v!.id, channelId: ch!.id, platform: 'youtube' })).rejects.toThrow()
  })

  it('enforces unique topic fingerprint, video status values and length range', async () => {
    const p = await newProject()
    await db.insert(s.topic).values({ projectId: p.id, title: 'a', fingerprint: 'a' })
    await expect(db.insert(s.topic).values({ projectId: p.id, title: 'A', fingerprint: 'a' })).rejects.toThrow()
    await expect(db.insert(s.video).values({ projectId: p.id, status: 'bogus' })).rejects.toThrow()
    await expect(db.insert(s.project).values({ name: 'x', targetVideoLengthS: 60 })).rejects.toThrow()
  })

  it('cascades project deletion', async () => {
    const p = await newProject()
    await db.insert(s.video).values({ projectId: p.id })
    await client.unsafe(`delete from project where id = '${p.id}'`)
    const rows = await client.unsafe(`select 1 from video where project_id = '${p.id}'`)
    expect(rows.length).toBe(0)
  })
})
