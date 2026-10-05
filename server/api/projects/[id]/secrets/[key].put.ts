import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { panelService } from '../../../../utils/panel-service'
import { parseSecretKey, parseSecretValue, requireUuid, unwrap } from '../../../../utils/validation'

export default defineEventHandler(async (event) => {
  const id = requireUuid(getRouterParam(event, 'id'))
  const key = unwrap(parseSecretKey(getRouterParam(event, 'key'), 'project'))
  const value = unwrap(parseSecretValue(await readBody(event)))
  await panelService().setSecret(key, value, id)
  return { secrets: await panelService().projectSecrets(id) }
})
