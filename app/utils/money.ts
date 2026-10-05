export const centsToEuro = (cents: number): number => Math.round(cents) / 100
export const euroToCents = (euro: number | null | undefined): number => Math.round((euro ?? 0) * 100)
export const formatEuro = (cents: number): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
