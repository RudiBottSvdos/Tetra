import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { useDb, schema } from '../db'
import { claimSignup } from './signup-guard'

let _auth: ReturnType<typeof createAuth> | undefined

function createAuth() {
  const baseURL = process.env.BETTER_AUTH_URL
  const extraOrigins = (process.env.TRUSTED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const production = process.env.NODE_ENV === 'production'
  return betterAuth({
    database: drizzleAdapter(useDb(), { provider: 'pg', schema }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [...(baseURL ? [baseURL] : []), ...extraOrigins],
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    advanced: {
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production }
    },
    // Zusaetzlich zu server/middleware/01-security.ts (IP-Limit auf Auth-Routen).
    rateLimit: { enabled: true, window: 60, max: 30 },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!(await claimSignup())) {
              throw new APIError('FORBIDDEN', { message: 'Registrierung ist gesperrt.' })
            }
          }
        }
      }
    }
  })
}

// Lazy Better Auth instance (needs DATABASE_URL at first use).
export function useAuth() {
  return (_auth ??= createAuth())
}
