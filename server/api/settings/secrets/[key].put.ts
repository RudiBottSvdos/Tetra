import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { parseSecretKey, parseSecretValue, unwrap } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const key = unwrap(parseSecretKey(getRouterParam(event, 'key'), 'global'))
  const value = unwrap(parseSecretValue(await readBody(event)))
  await panelService().setSecret(key, value)
  return { secrets: await panelService().globalSecrets() }
})
