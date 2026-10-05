import type { Job, WorkOptions } from 'pg-boss'
import type { PayloadOf, QueueName } from './names'

export type JobHandler<Q extends QueueName> = (job: Job<PayloadOf<Q>>) => Promise<unknown>

export interface HandlerRegistration {
  queue: QueueName
  handler: (job: Job<any>) => Promise<unknown>
  options: WorkOptions
}

const registrations = new Map<QueueName, HandlerRegistration>()

/**
 * Worker-Registry: Pakete registrieren hier ihre Handler (aus `server/queue/handlers/*.ts`).
 * Pro Queue genau ein Handler. Handler muessen idempotent sein (Zustellung ist at-least-once).
 * Standard: ein Job pro Aufruf (batchSize 1); Fehler (throw) loesen Retry/Backoff aus.
 */
export function registerHandler<Q extends QueueName>(queue: Q, handler: JobHandler<Q>, options: WorkOptions = {}): void {
  if (registrations.has(queue)) throw new Error(`[queue] Handler fuer "${queue}" ist bereits registriert`)
  registrations.set(queue, { queue, handler: handler as HandlerRegistration['handler'], options: { batchSize: 1, ...options } })
}

export function getRegistrations(): HandlerRegistration[] {
  return [...registrations.values()]
}

export function resetRegistry(): void {
  registrations.clear()
}
