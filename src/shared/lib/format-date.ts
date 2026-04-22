/**
 * Formato absoluto de fecha en español (es-AR). Se usa en SSR — el mismo string
 * viaja al cliente, evitando mismatches de hidratación.
 */
export function formatAbsoluteTime(date: Date | string, locale: string = 'es-AR'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

/**
 * Formato absoluto "largo" con año — tooltip de `<TimeAgo>` y copy en quote.
 */
export function formatAbsoluteTimeLong(date: Date | string, locale: string = 'es-AR'): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}
