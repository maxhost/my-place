import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { clientEnv } from '@/shared/config/env'
import { PageHeader } from '@/shared/ui/page-header'
import { LeaveSystemPanel } from '@/features/members/profile/public'

export const metadata: Metadata = {
  title: 'Permanencia · Settings',
}

type Props = { params: Promise<{ placeSlug: string }> }

/**
 * Panel de **Sistema** del place — decisiones de ciclo de vida del miembro
 * y del place. Hoy contiene una sola sección:
 *
 *  - **Salir del place** — `<LeaveSystemPanel>` que monta `<LeavePlaceDialog>`.
 *    El dialog valida internamente "único owner sin transfer previo".
 *
 * Futuro (no en este plan):
 *  - **Archivar place** — owner-only, soft-delete via `Place.archivedAt`.
 *
 * El gate admin/owner del `/settings/*` layout NO restringe esta sub-page —
 * cualquier miembro debe poder salir del place. Por eso la entry del sidebar
 * NO tiene `requiredRole: 'owner'`.
 *
 * Ver `docs/decisions/2026-05-12-settings-system-for-lifecycle.md` para la
 * decisión arquitectónica de separar lifecycle de access.
 */
export default async function SettingsSystemPage({ params }: Props) {
  const { placeSlug } = await params

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  return (
    <div className="mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Permanencia"
        description="Decisiones sobre tu permanencia en este place."
      />

      <section aria-labelledby="system-leave-heading" className="space-y-3">
        <div>
          <h2
            id="system-leave-heading"
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
