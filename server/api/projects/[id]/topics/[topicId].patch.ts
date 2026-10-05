import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { topicService } from '../../../../domain/topics'
import { requireUuid } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const projectId = requireUuid(getRouterParam(event, 'id'))
  const topicId = requireUuid(getRouterParam(event, 'topicId'))
  const body = await readBody(event).catch(() => undefined)
  const status = body && typeof body === 'object' ? (body as { status?: unknown }).status : undefined
  return topicService().setStatus(projectId, topicId, String(status))
})
