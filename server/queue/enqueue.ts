import type { SendOptions } from 'pg-boss'
import { getBoss } from './boss'
import type { PayloadOf, QueueName } from './names'

export interface EnqueueOptions extends Omit<SendOptions, 'singletonKey'> {
  /** Idempotenzschluessel (z. B. `${videoId}:${step}`): doppeltes Einreihen wird verworfen. */
  idempotencyKey?: string
}

function toSendOptions({ idempotencyKey, ...rest }: EnqueueOptions): SendOptions {
  return idempotencyKey ? { ...rest, singletonKey: idempotencyKey } : rest
}

/** Liefert die Job-ID, oder null wenn ein Job mit gleichem Idempotenzschluessel schon existiert. */
export async function enqueue<Q extends QueueName>(queue: Q, data: PayloadOf<Q>, options: EnqueueOptions = {}): Promise<string | null> {
  const boss = await getBoss()
  return boss.send(queue, data, toSendOptions(options))
}

/** Verzoegerter Job: zu einem Zeitpunkt (Date) oder nach N Sekunden. */
export async function enqueueAt<Q extends QueueName>(queue: Q, data: PayloadOf<Q>, when: Date | number, options: EnqueueOptions = {}): Promise<string | null> {
  const boss = await getBoss()
  return boss.sendAfter(queue, data, toSendOptions(options), when as number)
}
