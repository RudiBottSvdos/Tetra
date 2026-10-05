// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../server/db/schema'
import { VIDEO_STATUSES } from '../server/db/schema'

const tables = Object.values(schema).filter((v): v is PgTable => is(v, PgTable))
const byName = Object.fromEntries(tables.map(t => [getTableName(t), getTableConfig(t)]))

describe('db schema', () => {
  it('keeps the Better Auth tables', () => {
    for (const name of ['user', 'session', 'account', 'verification']) expect(byName).toHaveProperty(name)
  })

  it('defines the complete data model (plan section 4)', () => {
    expect(Object.keys(byName).sort()).toEqual([
      'account', 'app_setting', 'channel', 'cost_entry', 'metric_snapshot', 'notification',
      'project', 'project_secret', 'publication', 'schedule_rule', 'session', 'settings_secret',
      'topic', 'user', 'verification', 'video', 'video_event'
    ])
  })

  it('has CHECK constraints for enums, ai_label and the video state machine', () => {
    const checks = (t: string) => byName[t]!.checks.map(c => c.name)
    expect(checks('publication')).toContain('publication_ai_label_check')
    expect(checks('video')).toEqual(expect.arrayContaining(['video_status_check', 'video_resume_status_check']))
    expect(checks('project')).toContain('project_target_length_check')
    expect(VIDEO_STATUSES).toContain('awaiting_script_approval')
    expect(VIDEO_STATUSES).toContain('paused_budget')
    expect(VIDEO_STATUSES).toContain('partially_uploaded')
  })

  it('has the unique indexes (topic fingerprint, publication per channel, metric per day)', () => {
    const uniques = (t: string) => byName[t]!.indexes.filter(i => i.config.unique).map(i => i.config.name)
    expect(uniques('topic')).toContain('topic_project_fingerprint_uq')
    expect(uniques('publication')).toContain('publication_video_channel_uq')
    expect(uniques('metric_snapshot')).toContain('metric_snapshot_publication_date_uq')
  })

  it('cascades project-owned tables on delete', () => {
    for (const t of ['channel', 'topic', 'video', 'project_secret', 'schedule_rule']) {
      expect(byName[t]!.foreignKeys.some(fk => fk.reference().foreignTable && fk.onDelete === 'cascade'), t).toBe(true)
    }
  })

  it('migrations are valid DDL (no bind params) and never touch the pgboss schema', () => {
    const dir = join(__dirname, '..', 'drizzle')
    const files = readdirSync(dir).filter(f => f.endsWith('.sql'))
    expect(files.length).toBeGreaterThanOrEqual(2)
    const sql = files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
    expect(sql).not.toMatch(/\$\d+/)
    expect(sql.toLowerCase()).not.toContain('pgboss')
    expect(sql).toContain('CHECK ("publication"."ai_label" = true)')
  })
})
