import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { panelService } from '../../utils/panel-service'
import { parseProjectInput, unwrap } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const data = unwrap(parseProjectInput(await readBody(event), 'create'))
  const project = await panelService().createProject(data)
  setResponseStatus(event, 201)
  return project
})
