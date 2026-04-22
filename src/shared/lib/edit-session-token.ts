import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { serverEnv } from '@/shared/config/env'
import { DomainError } from '@/shared/errors/domain-error'

/**
 * Edit-session token (HMAC-SHA256, stateless).
 *
 * Contexto: la regla "autor edita dentro de los 60s desde `createdAt`" es un
 * invariante del dominio. Si el autor abre el form a los 55s y tarda 10s en
 * tipear, al guardar el server ya vio pasar los 60s y rechaza — mala UX.
 *
 * Fix: al abrir el form, el server firma un token con `{ subjectType, subjectId,
 * userId, openedAt }`. El server **verifica canEditPost en ese momento**, no al
 * guardar. El token vive `GRACE_MS` (5 min) — suficiente para terminar de
 * editar, acotado para no abrir una ventana indefinida.
 *
 * Por qué HMAC stateless (no DB): no duplica queries, no necesita migración,
 * no requiere limpieza. La verificación es un compute local. El secret
 * (`APP_EDIT_SESSION_SECRET`) lo maneja el ops — rotarlo invalida sesiones en
 * vuelo (aceptable: el user reabre el form).
 *
 * Admin bypassea todo esto: su permiso no expira, así que no recibe token.
 *
 * Ver `docs/decisions/2026-04-21-edit-session-token.md`.
 */

export const EDIT_SESSION_GRACE_MS = 5 * 60 * 1000

export type EditSessionSubjectType = 'POST' | 'COMMENT'

export type EditSessionPayload = {
  subjectType: EditSessionSubjectType
  subjectId: string
  userId: string
  /** ISO-8601 string — base del HMAC, no se permite drift. */
  openedAt: string
}

/**
 * El token viajó en un form pero algo falla: firma inválida, expiró, o payload
 * no matchea al subject que se está editando. UI lo mapea a "la sesión de
 * edición expiró, reabrí el form".
 */
export class EditSessionInvalid extends DomainError {
  constructor(
    reason: 'malformed' | 'bad_signature' | 'expired' | 'future_opened_at' | 'subject_mismatch',
    context?: Record<string, unknown>,
  ) {
    super('AUTHORIZATION', 'Sesión de edición inválida o expirada.', {
      reason,
      ...context,
    })
  }
}

function secret(): Buffer {
  const raw = serverEnv.APP_EDIT_SESSION_SECRET
  if (!raw) {
    throw new Error(
      '[edit-session-token] APP_EDIT_SESSION_SECRET no está configurada. ' +
        'Generá una con `openssl rand -base64 48` y pegala en .env.local.',
    )
  }
  return Buffer.from(raw, 'utf8')
}

function payloadBuffer(p: EditSessionPayload): Buffer {
  // Separador pipe no aparece en UUIDs ni en ISO strings → sin riesgo de
  // ambigüedad entre campos.
  return Buffer.from(`${p.subjectType}|${p.subjectId}|${p.userId}|${p.openedAt}`, 'utf8')
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = (4 - (padded.length % 4)) % 4
  return Buffer.from(padded + '='.repeat(pad), 'base64')
}

export function signEditSessionToken(payload: EditSessionPayload): string {
  const mac = createHmac('sha256', secret()).update(payloadBuffer(payload)).digest()
  return toBase64Url(mac)
}

/**
 * Verifica un token contra el payload esperado. Lanza `EditSessionInvalid` con
 * `reason` específico en cualquier fallo. Éxito es `void` (no retorna nada —
 * la prueba es que no tiró).
 *
 * Chequeos (orden):
 *  1. payload bien formado (openedAt parseable).
 *  2. firma matchea en timing-safe.
 *  3. `openedAt` no está en el futuro (clock skew del cliente).
 *  4. `now - openedAt < graceMs`.
 */
export function assertEditSessionToken(
  token: string,
  payload: EditSessionPayload,
  now: Date,
  graceMs: number = EDIT_SESSION_GRACE_MS,
): void {
  const openedAtMs = Date.parse(payload.openedAt)
  if (Number.isNaN(openedAtMs)) {
    throw new EditSessionInvalid('malformed')
  }

  const expected = fromBase64Url(signEditSessionToken(payload))
  const received = fromBase64Url(token)
  if (expected.length !== received.length) {
    throw new EditSessionInvalid('bad_signature')
  }
  if (!timingSafeEqual(expected, received)) {
    throw new EditSessionInvalid('bad_signature')
  }

  // 5s de tolerancia al skew futuro del reloj del cliente.
  if (openedAtMs > now.getTime() + 5_000) {
    throw new EditSessionInvalid('future_opened_at', {
      openedAt: payload.openedAt,
      now: now.toISOString(),
    })
  }

  if (now.getTime() - openedAtMs > graceMs) {
    throw new EditSessionInvalid('expired', {
      openedAt: payload.openedAt,
      graceMs,
    })
  }
}
