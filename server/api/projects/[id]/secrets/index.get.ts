import { defineEventHandler, getRouterParam } from 'h3'
import { panelService } from '../../../../utils/panel-service'
import { requireUuid } from '../../../../utils/validation'

// Nur maskierte Werte, nie Klartext.
export default defineEventHandler(async (event) => ({
  secrets: await panelService().projectSecrets(requireUuid(getRouterParam(event, 'id')))
}))
