import { createError } from 'h3'
import {
  MAX_BUDGET_CENTS, PROJECT_LANGUAGES, SECRET_KEYS, VIDEO_PROVIDER_OPTIONS
} from '../../shared/panel-constants'

export type FieldErrors = Record<string, string>
export type Parsed<T> = { ok: true, data: T } | { ok: false, errors: FieldErrors }

export interface ProjectInput {
  name?: string
  niche?: string
  language?: string
  stylePrompt?: string
  visualStylePrompt?: string
  heygenAvatarId?: string | null
  heygenVoiceId?: string | null
  videoProvider?: string
  scriptApprovalRequired?: boolean
  dailyBudgetCents?: number
  monthlyBudgetCents?: number
  targetVideoLengthS?: number
  topicBatchSize?: number
  maxRetries?: number
  maxVideosInReview?: number
  timezone?: string
}

export interface ScheduleRuleInput {
  weekday: number
  timeLocal: string
  videosPerDay: number
  enabled: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function parseProjectInput(body: unknown, mode: 'create' | 'update'): Parsed<ProjectInput> {
  if (!isObj(body)) return { ok: false, errors: { _: 'Ungültige Anfrage.' } }
  const errors: FieldErrors = {}
  const out: ProjectInput = {}
  const has = (k: string) => body[k] !== undefined

  const text = (k: keyof ProjectInput, label: string, max: number, required = false) => {
    if (!has(k)) {
      if (required && mode === 'create') errors[k] = `${label} ist erforderlich.`
      return
    }
    const v = body[k]
    if (typeof v !== 'string') { errors[k] = `${label} muss Text sein.`; return }
    const t = v.trim()
    if (required && !t) { errors[k] = `${label} ist erforderlich.`; return }
    if (t.length > max) { errors[k] = `${label} darf höchstens ${max} Zeichen lang sein.`; return }
    ;(out as Record<string, unknown>)[k] = t
  }
  const nullableText = (k: 'heygenAvatarId' | 'heygenVoiceId', label: string) => {
    if (!has(k)) return
    const v = body[k]
    if (v === null || v === '') { out[k] = null; return }
    if (typeof v !== 'string') { errors[k] = `${label} muss Text sein.`; return }
    const t = v.trim()
    if (t.length > 200) { errors[k] = `${label} darf höchstens 200 Zeichen lang sein.`; return }
    out[k] = t || null
  }
  const int = (k: keyof ProjectInput, label: string, min: number, max: number) => {
    if (!has(k)) return
    const v = body[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      errors[k] = `${label} muss eine ganze Zahl zwischen ${min} und ${max} sein.`
      return
    }
    ;(out as Record<string, unknown>)[k] = v
  }

  text('name', 'Name', 120, true)
  text('niche', 'Nische', 500)
  text('stylePrompt', 'Stil-Prompt', 4000)
  text('visualStylePrompt', 'Visueller Stil', 4000)
  nullableText('heygenAvatarId', 'Avatar-ID')
  nullableText('heygenVoiceId', 'Stimmen-ID')

  if (has('language')) {
    if (typeof body.language !== 'string' || !PROJECT_LANGUAGES.some(l => l.value === body.language)) errors.language = 'Bitte eine unterstützte Sprache wählen.'
    else out.language = body.language
  }
  if (has('videoProvider')) {
    if (typeof body.videoProvider !== 'string' || !VIDEO_PROVIDER_OPTIONS.some(l => l.value === body.videoProvider)) errors.videoProvider = 'Ungültiger Video-Anbieter.'
    else out.videoProvider = body.videoProvider
  }
  if (has('scriptApprovalRequired')) {
    if (typeof body.scriptApprovalRequired !== 'boolean') errors.scriptApprovalRequired = 'Skriptfreigabe muss ein Schalter (an/aus) sein.'
    else out.scriptApprovalRequired = body.scriptApprovalRequired
  }
  if (has('timezone')) {
    if (typeof body.timezone !== 'string' || !isValidTimezone(body.timezone)) errors.timezone = 'Ungültige Zeitzone (z. B. Europe/Berlin).'
    else out.timezone = body.timezone
  }

  int('dailyBudgetCents', 'Tagesbudget (Cent)', 0, MAX_BUDGET_CENTS)
  int('monthlyBudgetCents', 'Monatsbudget (Cent)', 0, MAX_BUDGET_CENTS)
  int('targetVideoLengthS', 'Ziellänge (Sekunden)', 30, 45)
  int('topicBatchSize', 'Themen pro Batch', 1, 100)
  int('maxRetries', 'Maximale Wiederholungen', 0, 10)
  int('maxVideosInReview', 'Maximale Videos im Review', 1, 50)

  if (out.dailyBudgetCents !== undefined && out.monthlyBudgetCents !== undefined && out.dailyBudgetCents > out.monthlyBudgetCents) {
    errors.dailyBudgetCents = 'Das Tagesbudget darf das Monatsbudget nicht übersteigen.'
  }
  if (mode === 'update' && !Object.keys(errors).length && !Object.keys(out).length) errors._ = 'Keine Änderungen angegeben.'

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: out }
}

export function parseScheduleRules(body: unknown): Parsed<ScheduleRuleInput[]> {
  const list = isObj(body) ? body.rules : undefined
  if (!Array.isArray(list)) return { ok: false, errors: { rules: 'Erwartet wird eine Liste "rules".' } }
  if (list.length > 50) return { ok: false, errors: { rules: 'Höchstens 50 Zeitplan-Einträge.' } }
  const errors: FieldErrors = {}
  const out: ScheduleRuleInput[] = []
  list.forEach((r, i) => {
    if (!isObj(r)) { errors[`rules.${i}`] = 'Ungültiger Eintrag.'; return }
    const { weekday, timeLocal, videosPerDay, enabled } = r
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) errors[`rules.${i}.weekday`] = 'Wochentag muss 0 (Sonntag) bis 6 (Samstag) sein.'
    if (typeof timeLocal !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeLocal)) errors[`rules.${i}.timeLocal`] = 'Uhrzeit muss im Format HH:MM angegeben werden.'
    if (typeof videosPerDay !== 'number' || !Number.isInteger(videosPerDay) || videosPerDay < 1 || videosPerDay > 10) errors[`rules.${i}.videosPerDay`] = 'Videos pro Tag: 1 bis 10.'
    if (enabled !== undefined && typeof enabled !== 'boolean') errors[`rules.${i}.enabled`] = 'Aktiv muss ein Schalter sein.'
    if (!Object.keys(errors).some(k => k.startsWith(`rules.${i}`))) {
      out.push({ weekday: weekday as number, timeLocal: timeLocal as string, videosPerDay: videosPerDay as number, enabled: enabled !== false })
    }
  })
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: out }
}

export function parseSecretKey(key: unknown, scope: 'global' | 'project'): Parsed<string> {
  const def = SECRET_KEYS.find(k => k.key === key)
  if (!def) return { ok: false, errors: { key: 'Unbekannter Schlüssel.' } }
  if (scope === 'project' && !def.projectOverride) return { ok: false, errors: { key: 'Dieser Schlüssel kann nicht pro Projekt überschrieben werden.' } }
  return { ok: true, data: def.key }
}

export function parseSecretValue(body: unknown): Parsed<string> {
  const v = isObj(body) ? body.value : undefined
  if (typeof v !== 'string' || !v.trim()) return { ok: false, errors: { value: 'Bitte einen Wert eingeben.' } }
  if (v.length > 2000) return { ok: false, errors: { value: 'Wert ist zu lang (max. 2000 Zeichen).' } }
  return { ok: true, data: v.trim() }
}

export function parseGlobalBudget(body: unknown): Parsed<number> {
  const v = isObj(body) ? body.globalMonthlyBudgetCents : undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_BUDGET_CENTS) {
    return { ok: false, errors: { globalMonthlyBudgetCents: `Globales Monatslimit muss eine ganze Zahl (Cent) zwischen 0 und ${MAX_BUDGET_CENTS} sein.` } }
  }
  return { ok: true, data: v }
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

/** Wirft 400 mit Feldfehlern, sonst liefert die Daten. */
export function unwrap<T>(r: Parsed<T>): T {
  if (r.ok) return r.data
  throw createError({ statusCode: 400, statusMessage: 'Ungültige Eingabe', data: { errors: r.errors } })
}

export function requireUuid(v: unknown): string {
  if (!isUuid(v)) throw createError({ statusCode: 400, statusMessage: 'Ungültige ID' })
  return v
}
