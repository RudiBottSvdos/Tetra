import { createError, defineEventHandler, getQuery, getRouterParam } from 'h3'
import { topicService } from '../../../../domain/topics'
import { TOPIC_STATUSES } from '../../../../db/schema/topic'
import { requireUuid } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const projectId = requireUuid(getRouterParam(event, 'id'))
  const status = getQuery(event).status
  if (status !== undefined && !(TOPIC_STATUSES as readonly string[]).includes(String(status))) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültiger Status' })
  }
  return { topics: await topicService().list(projectId, status as (typeof TOPIC_STATUSES)[number] | undefined) }
})
