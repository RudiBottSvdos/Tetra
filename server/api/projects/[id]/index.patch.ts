import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { parseProjectInput, requireUuid, unwrap } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireUuid(getRouterParam(event, 'id'))
  const data = unwrap(parseProjectInput(await readBody(event), 'update'))
  return panelService().updateProject(id, data)
})
