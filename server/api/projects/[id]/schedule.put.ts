import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { panelService } from '../../../utils/panel-service'
import { parseScheduleRules, requireUuid, unwrap } from '../../../utils/validation'

// Ersetzt den gesamten Wochenplan des Projekts.
export default defineEventHandler(async (event) => {
  const id = requireUuid(getRouterParam(event, 'id'))
  const rules = unwrap(parseScheduleRules(await readBody(event)))
  return { rules: await panelService().setSchedule(id, rules) }
})
