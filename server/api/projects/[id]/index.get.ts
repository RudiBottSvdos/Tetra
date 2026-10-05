import { defineEventHandler, getRouterParam } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { requireUuid } from '../../../utils/validation'

export default defineEventHandler(event => panelService().getProject(requireUuid(getRouterParam(event, 'id'))))
