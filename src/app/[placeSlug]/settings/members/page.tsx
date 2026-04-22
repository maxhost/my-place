import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { clientEnv } from '@/shared/config/env'
import {
  InviteMemberForm,
  LeaveButton,
  PendingInvitationsList,
  findMemberPermissions,
  listActiveMembers,
} from '@/features/members/public'
import { TransferOwnershipForm } from '@/features/places/public'

export const metadata: Metadata = {
  title: 'Miembros · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Panel de miembros + invitaciones + transferencia de ownership + salida.
 *
 * El gate admin/owner vive en `settings/layout.tsx` — acá asumimos que el
 * `auth.user` está presente y que es admin u owner. Reejecutamos la query de
 * place/perms igual porque necesitamos sus datos para render (no es un re-gate
 * redundante, es el lookup que el render usa).
 *
 * Ver `docs/features/members/spec.md` § "Salir" y "Transferir ownership".
 */
export default async function SettingsMembersPage({ params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  const actorId = auth!.id

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(actorId, place.id)
  const members = await listActiveMembers(place.id)
  const transferCandidates = perms.isOwner
    ? members
        .filter((m) => m.userId !== actorId)
        .map((m) => ({
          userId: m.userId,
          displayName: m.user.displayName,
          handle: m.user.handle,
        }))
    : []

  return (
    <main className="mx-auto max-w-2xl space-y-10 p-8">
      <header>
        <p className="text-sm text-neutral-500">Settings · {place.name}</p>
        <h1 className="font-serif text-3xl italic">Miembros</h1>
        <p className="mt-1 text-xs text-neutral-400">
          {members.length} {members.length === 1 ? 'miembro activo' : 'miembros activos'}
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-serif text-xl italic">Lista</h2>
        <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
          {members.map((m) => (
            <li key={m.membershipId} className="flex items-center justify-between py-3 text-sm">
              <div>
                <div className="font-medium">{m.user.displayName}</div>
                {m.user.handle ? (
                  <div className="text-xs text-neutral-500">@{m.user.handle}</div>
                ) : null}
              </div>
              <div className="flex gap-2 text-xs">
                {m.isOwner ? (
                  <span className="rounded-full border border-amber-400 px-2 py-0.5 text-amber-700">
                    owner
                  </span>
                ) : null}
                <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-neutral-600">
                  {m.role === 'ADMIN' ? 'admin' : 'miembro'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl italic">Invitar</h2>
        <InviteMemberForm placeSlug={place.slug} />
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl italic">Invitaciones pendientes</h2>
        <PendingInvitationsList placeId={place.id} />
      </section>

      {perms.isOwner ? (
        <section className="space-y-3">
          <h2 className="font-serif text-xl italic">Transferir ownership</h2>
          <p className="text-sm text-neutral-600">
            El nuevo owner tiene que ser miembro activo de este place. Si te tildás la opción de
            salir, perdés acceso al place en el mismo paso.
          </p>
          <TransferOwnershipForm placeSlug={place.slug} candidates={transferCandidates} />
        </section>
      ) : null}

      <section className="space-y-3 border-t border-neutral-200 pt-6">
        <h2 className="font-serif text-xl italic">Salir del place</h2>
        <p className="text-sm text-neutral-600">
          Al salir tu acceso se cierra y tu contenido queda atribuido 365 días antes de
          anonimizarse. Si sos el único owner, tenés que transferir ownership primero.
        </p>
        <LeaveButton placeSlug={place.slug} appUrl={clientEnv.NEXT_PUBLIC_APP_URL} />
      </section>
    </main>
  )
}
