// Dynamische Signup-Sperre: erlaubt nur, solange keine Nutzer existieren (oder ALLOW_SIGNUP=true).
// Ein Claim im Prozess verhindert, dass zwei parallele Erst-Registrierungen beide durchkommen.
const CLAIM_TTL_MS = 30_000
let claimedAt = 0
let queue: Promise<unknown> = Promise.resolve()

export function signupForced(): boolean {
  return process.env.ALLOW_SIGNUP === 'true'
}

export async function userCount(): Promise<number> {
  const { useDb, schema } = await import('../db')
  const { count } = await import('drizzle-orm')
  const rows = await useDb().select({ n: count() }).from(schema.user)
  return Number(rows[0]?.n ?? 0)
}

export async function isSignupOpen(countUsers: () => Promise<number> = userCount): Promise<boolean> {
  if (signupForced()) return true
  if (Date.now() - claimedAt < CLAIM_TTL_MS) return false
  return (await countUsers()) === 0
}

// Serialisiert Pruefung + Claim. true = Registrierung erlaubt.
export function claimSignup(countUsers: () => Promise<number> = userCount): Promise<boolean> {
  const run = async () => {
    if (signupForced()) return true
    if (Date.now() - claimedAt < CLAIM_TTL_MS) return false
    if ((await countUsers()) > 0) return false
    claimedAt = Date.now()
    return true
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

export function _resetSignupClaim() {
  claimedAt = 0
  queue = Promise.resolve()
}
