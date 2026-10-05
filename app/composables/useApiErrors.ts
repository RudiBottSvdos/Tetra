/** Liest Feldfehler (data.errors) und eine Gesamtmeldung aus einem $fetch-Fehler. */
export function parseApiError(e: unknown): { message: string, fields: Record<string, string> } {
  const err = e as { data?: { statusMessage?: string, data?: { errors?: Record<string, string> } }, statusMessage?: string }
  const fields = err?.data?.data?.errors ?? {}
  const message = err?.data?.statusMessage ?? err?.statusMessage ?? 'Unerwarteter Fehler. Bitte erneut versuchen.'
  return { message, fields }
}
