/** CostGuard-Klammer um kostenpflichtige Provider-Aufrufe: reserve -> Call -> commit, bei Fehler release. */
import type { CostGuard } from './cost-guard'

export interface GuardedCallInput {
  projectId: string | null
  videoId?: string | null
  provider: string
  operation: string
  estimateCents: number
}

/** USD -> Cent, aufgerundet (konservativ; 0 bleibt 0). */
export function usdToCents(usd: number): number {
  return usd > 0 ? Math.ceil(usd * 100 - 1e-9) : 0
}

export async function guardedCall<T>(
  guard: CostGuard,
  input: GuardedCallInput,
  fn: () => Promise<{ value: T, costUsd: number }>
): Promise<{ result: T, reservationId: string, costCents: number }> {
  // BudgetExceededError propagiert unverändert; es wurde nichts reserviert.
  const reservation = await guard.reserve(input)
  let out: { value: T, costUsd: number }
  try {
    out = await fn()
  } catch (e) {
    await guard.release(reservation.id).catch(() => { /* Reaper räumt ab */ })
    throw e
  }
  const costCents = usdToCents(out.costUsd)
  await guard.commit(reservation.id, costCents)
  return { result: out.value, reservationId: reservation.id, costCents }
}
