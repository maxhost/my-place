import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { clientEnv } from '@/shared/config/env'
import { PageHeader } from '@/shared/ui/page-header'
import { LeaveSystemPanel } from '@/features/members/profile/public'
import { findMemberPermissions, listActiveMembers } from '@/features/members/public.server'
import { TransferOwnershipForm } from '@/features/places/public'

export const metadata: Metadata = {
  title: 'Zona de peligro · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Zona de peligro del place — acciones irreversibles sobre la relación
 * user ↔ place. Renombre 2026-05-14 (era `/settings/system` / "Permanencia").
 *
 * Secciones:
 *  - **Transferir ownership** (owner-only) — el nuevo owner debe ser miembro
 *    activo. Si se tilda "salir al transferir", el actor pierde acceso en
 *    el mismo paso. Movido desde `/settings/members` 2026-05-14.
 *  - **Salir del place** (cualquier miembro) — `<LeaveSystemPanel>` que monta
 *    `<LeavePlaceDialog>`. Valida internamente "único owner sin transfer previo".
 *
 * El gate admin/owner del `/settings/*` layout NO restringe esta sub-page —
 * cualquier miembro debe poder salir. La sección Transferir ownership se
 * renderiza condicionalmente sólo si el viewer es owner.
 *
 * Ver `docs/decisions/2026-05-12-settings-system-for-lifecycle.md`.
 */
export default async function SettingsDangerZonePage({ params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  const actorId = auth!.id

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(actorId, place.id)
  const transferCandidates = perms.isOwner
    ? (await listActiveMembers(place.id))
        .filter((m) => m.userId !== actorId)
        .map((m) => ({
          userId: m.userId,
          displayName: m.user.displayName,
          handle: m.user.handle,
        }))
    : []

  return (
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Zona de peligro"
        description="Acciones irreversibles sobre tu permanencia en el place."
      />

      {perms.isOwner ? (
        <section aria-labelledby="transfer-ownership-heading" className="space-y-3">
          <div>
            <h2
              id="transfer-ownership-heading"
              className="border-b pb-2 font-serif text-xl"
              style={{ borderColor: 'var(--border)' }}
            >
              Transferir ownership
            </h2>
            <p className="mt-1 text-sm text-neutral-600">
              El nuevo owner tiene que ser miembro activo de este place. Si te tildás la opción de
              salir, perdés acceso al place en el mismo paso.
            </p>
          </div>
          <TransferOwnershipForm placeSlug={place.slug} candidates={transferCandidates} />
        </section>
      ) : null}

      <section aria-labelledby="leave-heading" className="space-y-3">
        <div>
          <h2
            id="leave-heading"
            className="border-b pb-2 font-serif text-xl"
            style={{ borderColor: 'var(--border)' }}
          >
            Salir del place
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Tu acceso se cierra y tu contenido queda atribuido 365 días antes de anonimizarse. Si
            sos el único owner, transferí ownership primero.
          </p>
        </div>
        <LeaveSystemPanel placeSlug={place.slug} appUrl={clientEnv.NEXT_PUBLIC_APP_URL} />
      </section>
    </div>
  )
}
