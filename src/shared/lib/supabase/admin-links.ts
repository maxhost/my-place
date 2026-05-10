import 'server-only'
import { createSupabaseAdmin } from './admin'
import { InvitationLinkGenerationError } from '@/shared/errors/domain-error'

/**
 * Genera un magic link via Supabase Auth admin API. Maneja los dos casos:
 *
 * - **User nuevo:** `generateLink({type:'invite'})` crea `auth.users` y
 *   devuelve URL + hashed_token de tipo `invite`.
 * - **User existente:** primer intento falla 422 `email_exists`; fallback a
 *   `generateLink({type:'magiclink'})`, que devuelve URL + hashed_token de
 *   tipo `magiclink`.
 *
 * `generateLink` **no envía email** en ninguno de los dos modos — retorna
 * solo URL + payload. Eso nos permite bypassear los rate limits del SMTP
 * interno de Supabase y enviar por Resend.
 *
 * **Sobre `hashedToken` y `type`:** el `action_link` de Supabase usa
 * implicit flow (tokens en `#hash` que el server no recibe). Nosotros
 * extraemos el `hashed_token` y el `type` para construir nuestra propia
 * URL `/auth/invite-callback?token_hash=...&type=...&next=...` que hace
 * `verifyOtp` server-side y setea cookies con `domain=<apex>`. Ver
 * `docs/gotchas/supabase-magic-link-callback-required.md`.
 *
 * `redirectTo` quedó opcional: el flow nuevo no lo necesita (la URL del
 * email es nuestra, no el `action_link` de Supabase). Mantenido por compat
 * con futuros flows que sí dependan del `action_link` directo.
 */

export type GenerateInviteMagicLinkResult = {
  /** action_link de Supabase. Útil para debug; el flow real no lo usa. */
  url: string
  /** Token OTP server-side para `verifyOtp({ token_hash, type })`. */
  hashedToken: string
  /** Tipo del token, debe matchearse en `verifyOtp`. */
  type: 'invite' | 'magiclink'
  /**
   * `true` si el user fue creado durante esta llamada (path `type:'invite'`).
   * `false` si ya existía en `auth.users` (fallback `magiclink`).
   */
  isNewAuthUser: boolean
}

export async function generateInviteMagicLink(params: {
  email: string
  /**
   * Opcional. Solo se forwardea a Supabase si está presente. El flow
   * canónico (invite-callback) no lo necesita.
   */
  redirectTo?: string
}): Promise<GenerateInviteMagicLinkResult> {
  const { email, redirectTo } = params
  const admin = createSupabaseAdmin()
  const options = redirectTo ? { redirectTo } : {}

  // Intento 1: invite. Crea auth.users si no existe.
  const first = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options,
  })

  if (!first.error) {
    return extractResult(first.data, 'invite', { isNewAuthUser: true, email })
  }

  // 422 email_exists → fallback.
  if (isEmailExistsError(first.error)) {
    const second = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options,
    })
    if (second.error) {
      throw new InvitationLinkGenerationError(`Fallback magiclink falló: ${second.error.message}`, {
        email,
        path: 'magiclink',
        status: second.error.status ?? null,
      })
    }
    return extractResult(second.data, 'magiclink', { isNewAuthUser: false, email })
  }

  // Cualquier otro error del primer intento: propagamos.
  throw new InvitationLinkGenerationError(`generateLink(invite) falló: ${first.error.message}`, {
    email,
    path: 'invite',
    status: first.error.status ?? null,
  })
}

function extractResult(
  data: unknown,
  type: 'invite' | 'magiclink',
  ctx: { isNewAuthUser: boolean; email: string },
): GenerateInviteMagicLinkResult {
  const url = extractActionLink(data)
  if (!url) {
    throw new InvitationLinkGenerationError(
      `Supabase devolvió success en ${type} pero sin action_link en el payload.`,
      { email: ctx.email, path: type },
    )
  }
  const hashedToken = extractHashedToken(data)
  if (!hashedToken) {
    throw new InvitationLinkGenerationError(
      `Supabase devolvió success en ${type} pero sin hashed_token en el payload.`,
      { email: ctx.email, path: type },
    )
  }
  return { url, hashedToken, type, isNewAuthUser: ctx.isNewAuthUser }
}

function isEmailExistsError(error: {
  status?: number | undefined
  message?: string | undefined
  code?: string | undefined
}): boolean {
  // Supabase GoTrue responde 422 con `code: 'email_exists'` o mensaje:
  // "A user with this email address has already been registered".
  if (error.status === 422) return true
  if (error.code === 'email_exists') return true
  const msg = error.message ?? ''
  return /email.{0,3}exists|already.{0,6}registered/i.test(msg)
}

// El shape del payload es `{ properties: { action_link, hashed_token, ... }, user: { ... } }`.
// Extraemos defensivamente por si el SDK cambia.
function extractActionLink(data: unknown): string | null {
  const props = readProperties(data)
  if (!props) return null
  const link = (props as { action_link?: unknown }).action_link
  return typeof link === 'string' && link.length > 0 ? link : null
}

function extractHashedToken(data: unknown): string | null {
  const props = readProperties(data)
  if (!props) return null
  const token = (props as { hashed_token?: unknown }).hashed_token
  return typeof token === 'string' && token.length > 0 ? token : null
}

function readProperties(data: unknown): object | null {
  if (!data || typeof data !== 'object') return null
  const props = (data as { properties?: unknown }).properties
  if (!props || typeof props !== 'object') return null
  return props
}
