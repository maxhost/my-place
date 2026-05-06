import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { AcceptInvitationView } from '@/features/members/public'
import { findInvitationByToken } from '@/features/members/public.server'

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
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
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

  return (
    <AcceptInvitationView
      token={token}
      placeName={invitation.place.name}
      placeSlug={invitation.place.slug}
      asAdmin={invitation.asAdmin}
    />
  )
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
