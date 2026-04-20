/**
 * Allowlist de timezones IANA aceptadas en `openingHours.timezone`.
 *
 * Controlada a propósito — aceptar cualquier string IANA abriría la puerta a
 * typos ("Argentina/Buenos_Aires" sin la `America/` prefix) y a zonas oscuras
 * que complican tests de DST. Agregar una nueva zona es una línea + un PR.
 *
 * Ver `docs/features/hours/spec.md` § "Contrato de horario y timezone".
 */

export const ALLOWED_TIMEZONES = [
  'UTC',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Lima',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Africa/Johannesburg',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
] as const

export type AllowedTimezone = (typeof ALLOWED_TIMEZONES)[number]

export function isAllowedTimezone(tz: string): tz is AllowedTimezone {
  return (ALLOWED_TIMEZONES as readonly string[]).includes(tz)
}
