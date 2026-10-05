import { jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_common'

/** Globale verschluesselte Standards (heygen.apiKey, deepseek.apiKey, onedrive.*). */
export const settingsSecret = pgTable('settings_secret', {
  id: id(),
  key: text('key').notNull().unique(),
  valueEnc: text('value_enc').notNull(),
  ...timestamps()
})

/** Nicht geheime globale Einstellungen (global_monthly_budget_cents, global_paused, ...). */
export const appSetting = pgTable('app_setting', {
  id: id(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull(),
  ...timestamps()
})
