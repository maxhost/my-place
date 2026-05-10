import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { logger } from '@/shared/lib/logger'
import { placeUrl } from '@/shared/lib/app-url'
import { AcceptInvitationView } from '@/features/members/invitations/public'
import { findActiveMembership, findInvitationByToken } from '@/features/members/public.server'

export const metadata: Metadata = {
  title: 'Aceptar invitación · Place',
}

/**
 * Ruta de aceptación de invitación. Vive en el apex (`lvh.me` / `place.app`) —
 * el middleware trata el apex como "marketing" y no hace gate, así que la
 * verificación de sesión ocurre acá.
 *
 * Si no hay sesión, redirige a `/login?next=/invite/accept/{token}`. El callback
 * del magic link reenvía al mismo path después del login (resolveSafeNext acepta
 * paths relativos dentro del apex).
 *
 * Ver `docs/features/members/spec.md` § "Aceptar".
 */
export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ _t?: string; error?: string }>
}) {
  const { token } = await params
  const sp = (await searchParams) ?? {}
  const traceId = sp._t ?? 'no-trace'
  const errorParam = sp.error ?? null
  const headerStore = await headers()
  const cookieHeader = headerStore.get('cookie') ?? ''
  const sbCookies =
    cookieHeader
      .split(';')
      .map((c) => c.trim())
      .filter((c) => /^sb-/.test(c))
      .map((c) => {
        const [name, value] = c.split('=')
        return `${name}(${value?.length ?? 0})`
      })
      .join(',') || '(none)'
  logger.warn(
    {
      debug: 'AP_entry',
      traceId,
      token,
      host: headerStore.get('host'),
      sbCookies,
      ua: headerStore.get('user-agent'),
    },
    `DBG AP[entry] tr=${traceId} host=${headerStore.get('host')} sb=[${sbCookies}]`,
  )

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  logger.warn(
    {
      debug: 'AP_getUser',
      traceId,
      hasUser: !!auth.user,
      userId: auth.user?.id ?? null,
    },
    `DBG AP[getUser] tr=${traceId} user=${auth.user?.id ?? 'null'}`,
  )
  if (!auth.user) {
    logger.warn({ debug: 'AP_redirect_login', traceId }, `DBG AP[redirect-login] tr=${traceId}`)
    redirect(`/login?next=/invite/accept/${encodeURIComponent(token)}`)
  }

  const invitation = await findInvitationByToken(token)

  if (!invitation) {
    return <InvitationProblem kind="not_found" />
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return <InvitationProblem kind="expired" />
  }
  if (invitation.place.archivedAt) {
    return <InvitationProblem kind="archived" />
  }

  // Si el callback ya aceptó inline (T2) y el user llega acá ya como member,
  // redirigir al place — no tiene sentido mostrar "Aceptar y entrar" si ya está
  // adentro. Cubre también: user clickea email DOS veces (segundo click ve
  // membership creada por el primero).
  const existingMembership = await findActiveMembership(auth.user.id, invitation.placeId)
  if (existingMembership) {
    redirect(placeUrl(invitation.place.slug).href)
  }

  return (
    <AcceptInvitationView
      token={token}
      placeName={invitation.place.name}
      placeSlug={invitation.place.slug}
      asAdmin={invitation.asAdmin}
      errorFromCallback={errorReasonToMessage(errorParam)}
    />
  )
}

/**
 * Convierte el `?error=<reason>` que el callback puede setear (ver
 * `acceptErrorToReason` en `/auth/invite-callback/route.ts`) en un mensaje
 * humano para mostrar arriba del botón Aceptar. Si el reason es uno de los
 * "page-level" (`expired`, `archived`, `invalid_token`), ya fue manejado
 * arriba con `<InvitationProblem>` — los reasons que llegan acá son los
 * recuperables (e.g. capacity reached, conflict).
 */
function errorReasonToMessage(reason: string | null): string | null {
  if (!reason) return null
  switch (reason) {
    case 'over_capacity':
      return 'El place llegó al máximo de miembros (150). Pedile al admin que abra cupo.'
    case 'admin_preset_missing':
      return 'No pudimos sumarte como admin. Avisale al owner del place.'
    case 'membership_conflict':
      return 'Hubo un conflicto al sumarte. Probá de nuevo o pedile al admin un link nuevo.'
    case 'already_used':
      return 'Esta invitación ya fue usada por otra persona.'
    default:
      return 'No pudimos completar la aceptación automática. Hacelo manualmente abajo.'
  }
}

function InvitationProblem({ kind }: { kind: 'not_found' | 'expired' | 'archived' }) {
  const messages = {
    not_found: {
      title: 'Invitación no encontrada',
      body: 'El link que usaste no corresponde a una invitación vigente.',
    },
    expired: {
      title: 'Invitación expirada',
      body: 'Esta invitación caducó. Pedí una nueva al admin del place.',
    },
    archived: {
      title: 'Place archivado',
      body: 'El place al que te invitaron ya no está activo.',
    },
  } as const

  const { title, body } = messages[kind]

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <h1 className="font-serif text-3xl italic">{title}</h1>
        <p className="text-sm text-neutral-700">{body}</p>
        <Link href="/" className="inline-block text-sm text-neutral-500 underline">
          Volver al inicio
        </Link>
      </div>
    </main>
  )
}
