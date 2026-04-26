/**
 * Formatea `startsAt`/`endsAt` de un evento en el timezone del evento (IANA).
 *
 * Patrón distinto al `TimeAgo` de discussions: los eventos son puntos
 * absolutos en el tiempo con un timezone "intencional" (la hora del
 * evento). Mostrar siempre en la hora del evento ancla la lectura — es lo
 * que el host quiso decir cuando publicó. Si el viewer vive en otro huso,
 * la UI muestra una segunda línea "hora local: …" (gestionada por el call
 * site, no acá).
 *
 * Idioma `es-AR`. Pure function, server + client safe.
 */
export function formatEventDateTime(startsAt: Date, endsAt: Date | null, timezone: string): string {
  const dateStr = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(startsAt)

  const timeStr = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(startsAt)

  if (!endsAt) return `${capitalize(dateStr)} · ${timeStr}`

  // Si endsAt cae el mismo día calendario en el TZ del evento, mostramos
  // una sola fecha con rango horario. Si cae otro día, dos fechas.
  const endDateStr = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(endsAt)
  const startDateOnly = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: timezone,
  }).format(startsAt)
  const endTimeStr = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(endsAt)

  if (endDateStr === startDateOnly) {
    return `${capitalize(dateStr)} · ${timeStr}–${endTimeStr}`
  }
  return `${capitalize(dateStr)} ${timeStr} → ${endDateStr} ${endTimeStr}`
}

function capitalize(s: string): string {
  if (s.length === 0) return s
  return s[0]!.toUpperCase() + s.slice(1)
}

/** Label del timezone para la línea "hora del evento (IANA)". */
export function formatTimezoneLabel(timezone: string): string {
  // Heurística: tomamos la última parte del IANA y reemplazamos `_` por espacios.
  const parts = timezone.split('/')
  const last = parts[parts.length - 1] ?? timezone
  return last.replace(/_/g, ' ')
}

/**
 * Fecha compacta para overlines y cards bento. "Sáb 27 Abr".
 *
 * Sin "HOY"/"MAÑANA" — el principio "sin urgencia artificial" descarta
 * relativos gritados. Siempre absoluto.
 */
export function formatEventCompactDate(date: Date, timezone: string): string {
  const dow = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    timeZone: timezone,
  }).format(date)
  const day = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    timeZone: timezone,
  }).format(date)
  const month = new Intl.DateTimeFormat('es-AR', {
    month: 'short',
    timeZone: timezone,
  }).format(date)
  return `${capitalize(stripTrailingDot(dow))} ${day} ${capitalize(stripTrailingDot(month))}`
}

/**
 * Rango horario compacto. "10:00–14:00" si mismo día; "10:00" si no hay
 * `endsAt`; "10:00 → 14:00 (28 abr)" si cruza día.
 */
export function formatEventTimeRange(
  startsAt: Date,
  endsAt: Date | null,
  timezone: string,
): string {
  const startTime = formatTime24h(startsAt, timezone)

  if (!endsAt) return startTime

  const endTime = formatTime24h(endsAt, timezone)
  const startDay = dayInTz(startsAt, timezone)
  const endDay = dayInTz(endsAt, timezone)

  if (startDay === endDay) return `${startTime}–${endTime}`
  // Cross-day: añadimos la fecha de fin separada para no confundir.
  const endDayLabel = `${endDay} ${stripTrailingDot(monthShortInTz(endsAt, timezone))}`
  return `${startTime} → ${endTime} (${endDayLabel})`
}

function formatTime24h(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(date)
}

function dayInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    timeZone: timezone,
  }).format(date)
}

function monthShortInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    month: 'short',
    timeZone: timezone,
  }).format(date)
}

/**
 * Partes de la fecha para el calendar tile del header. `dow` y `month` en
 * uppercase y sin punto final ("SÁB", "ABR"); `day` en numérico.
 *
 * Format determinístico desde el timezone IANA del evento — distintos TZ
 * producen distintos `{dow, day, month}` para una misma `Date` cuando la
 * hora cae cerca de medianoche.
 */
export function formatEventDateParts(
  date: Date,
  timezone: string,
): { dow: string; day: string; month: string } {
  const dow = new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    timeZone: timezone,
  }).format(date)
  const day = new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    timeZone: timezone,
  }).format(date)
  const month = new Intl.DateTimeFormat('es-AR', {
    month: 'short',
    timeZone: timezone,
  }).format(date)
  return {
    dow: stripTrailingDot(dow).toUpperCase(),
    day,
    month: stripTrailingDot(month).toUpperCase(),
  }
}

function stripTrailingDot(s: string): string {
  return s.replace(/\.$/, '')
}
