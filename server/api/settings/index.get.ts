import { defineEventHandler } from 'h3'
import { panelService } from '../../utils/panel-service'

// Globale Secrets nur maskiert + globales Monatslimit.
export default defineEventHandler(async () => {
  const svc = panelService()
  const [secrets, globalMonthlyBudgetCents] = await Promise.all([svc.globalSecrets(), svc.getGlobalBudget()])
  return { secrets, globalMonthlyBudgetCents }
})
