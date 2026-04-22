import 'server-only'
import { createSupabaseAdmin } from './admin'
import { InvitationLinkGenerationError } from '@/shared/errors/domain-error'

/**
 * Genera un magic link via Supabase Auth admin API. Maneja los dos casos:
 *
 * - **User nuevo:** `generateLink({type:'invite'})` crea `auth.users` y
 *   devuelve URL que al abrirse loguea al user.
 * - **User existente:** primer intento falla 422 `email_exists`; fallback a
 *   `generateLink({type:'magiclink'})`, que funciona sin crear nada.
 *
 * `generateLink` **no envía email** en ninguno de los dos modos — retorna
 * solo la URL. Eso nos permite bypassear los rate limits del SMTP interno
 * de Supabase (ver `docs/decisions/2026-04-20-mailer-resend-primary.md`)
 * y enviar por Resend.
 *
 * En cualquier otro error (red, quota, etc.), se propaga como
 * `InvitationLinkGenerationError` con el mensaje crudo del SDK en `context`.
 */

export type GenerateInviteMagicLinkResult = {
  url: string
  /**
   * `true` si el user fue creado durante esta llamada (primer path, `type:'invite'`).
   * `false` si ya existía en `auth.users` (fallback a `magiclink`).
   */
  isNewAuthUser: boolean
}

export async function generateInviteMagicLink(params: {
  email: string
  redirectTo: string
}): Promise<GenerateInviteMagicLinkResult> {
  const { email, redirectTo } = params
  const admin = createSupabaseAdmin()

  // Intento 1: invite. Crea auth.users si no existe.
  const first = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { redirectTo },
  })

  if (!first.error) {
    const url = extractActionLink(first.data)
    if (!url) {
      throw new InvitationLinkGenerationError(
        'Supabase devolvió success pero sin action_link en el payload.',
        { email, path: 'invite' },
      )
    }
    return { url, isNewAuthUser: true }
  }

  // 422 email_exists → fallback.
  if (isEmailExistsError(first.error)) {
    const second = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })
    if (second.error) {
      throw new InvitationLinkGenerationError(`Fallback magiclink falló: ${second.error.message}`, {
        email,
        path: 'magiclink',
        status: second.error.status ?? null,
      })
    }
    const url = extractActionLink(second.data)
    if (!url) {
      throw new InvitationLinkGenerationError(
        'Supabase devolvió success en magiclink pero sin action_link.',
        { email, path: 'magiclink' },
      )
    }
    return { url, isNewAuthUser: false }
  }

  // Cualquier otro error del primer intento: propagamos.
  throw new InvitationLinkGenerationError(`generateLink(invite) falló: ${first.error.message}`, {
    email,
    path: 'invite',
    status: first.error.status ?? null,
  })
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

// El shape del payload es `{ properties: { action_link, ... }, user: { ... } }`.
// Lo extraemos defensivamente por si el SDK cambia.
function extractActionLink(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const props = (data as { properties?: { action_link?: unknown } }).properties
  if (!props || typeof props !== 'object') return null
  const link = props.action_link
  return typeof link === 'string' && link.length > 0 ? link : null
}
