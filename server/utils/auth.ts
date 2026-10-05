import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { useDb, schema } from '../db'

let _auth: ReturnType<typeof createAuth> | undefined

function createAuth() {
  return betterAuth({
    database: drizzleAdapter(useDb(), { provider: 'pg', schema }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true }
  })
}

// Lazy Better Auth instance (needs DATABASE_URL at first use).
export function useAuth() {
  return (_auth ??= createAuth())
}
