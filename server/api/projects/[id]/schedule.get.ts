import { defineEventHandler, getRouterParam } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { requireUuid } from '../../../utils/validation'

export default defineEventHandler(async (event) => ({
  rules: await panelService().getSchedule(requireUuid(getRouterParam(event, 'id')))
}))
