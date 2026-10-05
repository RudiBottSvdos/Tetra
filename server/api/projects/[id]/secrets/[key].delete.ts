import { defineEventHandler, getRouterParam } from 'h3'
import { panelService } from '../../../../utils/panel-service'
import { parseSecretKey, requireUuid, unwrap } from '../../../../utils/validation'

// Entfernt den Projekt-Override; danach gilt wieder der globale Standard.
export default defineEventHandler(async (event) => {
  const id = requireUuid(getRouterParam(event, 'id'))
  const key = unwrap(parseSecretKey(getRouterParam(event, 'key'), 'project'))
  await panelService().deleteSecret(key, id)
  return { secrets: await panelService().projectSecrets(id) }
})
