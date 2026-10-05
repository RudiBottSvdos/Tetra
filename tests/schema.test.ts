// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { user, session, account, verification } from '../server/db/schema'

describe('db schema', () => {
  it('defines the Better Auth tables', () => {
    expect([user, session, account, verification].map(t => getTableName(t))).toEqual([
      'user', 'session', 'account', 'verification'
    ])
  })
})
