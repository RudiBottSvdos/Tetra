import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { requireUuid } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  await panelService().deleteProject(requireUuid(getRouterParam(event, 'id')))
  setResponseStatus(event, 204)
  return null
})
