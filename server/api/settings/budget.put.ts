import { defineEventHandler, readBody } from 'h3'
import { panelService } from '../../utils/panel-service'
import { parseGlobalBudget, unwrap } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const cents = unwrap(parseGlobalBudget(await readBody(event)))
  await panelService().setGlobalBudget(cents)
  return { globalMonthlyBudgetCents: cents }
})
