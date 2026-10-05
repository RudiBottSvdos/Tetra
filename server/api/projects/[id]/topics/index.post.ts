import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { MAX_TOPIC_COUNT, topicService } from '../../../../domain/topics'
import { requireUuid } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const projectId = requireUuid(getRouterParam(event, 'id'))
  const body = await readBody(event).catch(() => undefined)
  let count: number | undefined
  if (body && typeof body === 'object' && 'count' in body && body.count !== undefined) {
    const c = (body as { count: unknown }).count
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > MAX_TOPIC_COUNT) {
      throw createError({ statusCode: 400, statusMessage: 'Ungültige Eingabe', data: { errors: { count: `Ganze Zahl von 1 bis ${MAX_TOPIC_COUNT}.` } } })
    }
    count = c
  }
  const r = await topicService().generate(projectId, { count })
  return { batchId: r.batchId, requested: r.requested, duplicates: r.duplicates, topics: r.created }
})
