// Von Server (Validierung) und UI (Auswahllisten) gemeinsam genutzt.
export const PROJECT_LANGUAGES = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'Englisch' },
  { value: 'es', label: 'Spanisch' },
  { value: 'fr', label: 'Französisch' },
  { value: 'it', label: 'Italienisch' },
  { value: 'pt', label: 'Portugiesisch' },
  { value: 'nl', label: 'Niederländisch' },
  { value: 'pl', label: 'Polnisch' },
  { value: 'tr', label: 'Türkisch' }
] as const

export const VIDEO_PROVIDER_OPTIONS = [
  { value: 'heygen', label: 'HeyGen' },
  { value: 'fallback', label: 'Fallback (ohne HeyGen)' }
] as const

export interface SecretKeyDef {
  key: string
  label: string
  description: string
  /** Darf pro Projekt überschrieben werden. */
  projectOverride: boolean
}

/** Erlaubte Secret-Schlüssel (alles andere wird abgelehnt). onedrive.refreshToken wird nur per OAuth gesetzt. */
export const SECRET_KEYS: readonly SecretKeyDef[] = [
  { key: 'heygen.apiKey', label: 'HeyGen API-Key', description: 'Avatar-Videos rendern.', projectOverride: true },
  { key: 'deepseek.apiKey', label: 'Deepseek API-Key', description: 'Themen und Skripte erzeugen.', projectOverride: true },
  { key: 'google.clientId', label: 'Google OAuth Client-ID', description: 'OAuth-Client (Web) für die YouTube-Kanalverbindung.', projectOverride: false },
  { key: 'google.clientSecret', label: 'Google OAuth Client-Secret', description: 'OAuth-Client (Web) für die YouTube-Kanalverbindung.', projectOverride: false },
  { key: 'onedrive.clientId', label: 'OneDrive Client-ID', description: 'Azure-App für die Archivierung (Platzhalter, Verbindung folgt).', projectOverride: false },
  { key: 'onedrive.clientSecret', label: 'OneDrive Client-Secret', description: 'Azure-App für die Archivierung (Platzhalter, Verbindung folgt).', projectOverride: false }
]

export const GLOBAL_MONTHLY_BUDGET_KEY = 'global_monthly_budget_cents'
export const DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS = 15000
export const MAX_BUDGET_CENTS = 10_000_000

export const WEEKDAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const
