import { defineEventHandler, getRouterParam } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { parseSecretKey, unwrap } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const key = unwrap(parseSecretKey(getRouterParam(event, 'key'), 'global'))
  await panelService().deleteSecret(key)
  return { secrets: await panelService().globalSecrets() }
})
