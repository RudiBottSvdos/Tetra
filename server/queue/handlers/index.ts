import { registerHandler, getRegistrations } from '../registry'
import { QUEUES } from '../names'

/**
 * Handler-Registrierung. Spaetere Pakete legen `server/queue/handlers/<name>.ts` an, exportieren
 * eine `register()`-Funktion und tragen sie in REGISTRARS ein (explizit, kein Glob: reihenfolge- und
 * bundle-sicher). Die Platzhalter unten werden dann durch den echten Eintrag ersetzt.
 */
const placeholder = (queue: string) => async () => {
  console.debug(`[queue] ${queue}: Platzhalter-Handler (noch nicht implementiert)`)
}

const REGISTRARS: Array<() => void> = [
  () => registerHandler(QUEUES.schedulerTick, placeholder(QUEUES.schedulerTick)),
  () => registerHandler(QUEUES.metricsSync, placeholder(QUEUES.metricsSync)),
  () => registerHandler(QUEUES.reservationReap, placeholder(QUEUES.reservationReap))
]

let done = false

/** Idempotent (Dev-HMR). */
export function registerAllHandlers(): void {
  if (done || getRegistrations().length > 0) return
  done = true
  for (const register of REGISTRARS) register()
}
