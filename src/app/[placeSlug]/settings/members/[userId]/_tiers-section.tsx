import 'server-only'
import { listTiersByPlace } from '@/features/tiers/public.server'
import { listAssignmentsByMember } from '@/features/tier-memberships/public.server'
import { TiersSection } from './components/tiers-section'

type Props = {
  placeSlug: string
  placeId: string
  memberUserId: string
}

/**
 * Streamed section: tiers asignados + control de asignación.
 *
 * Vive bajo `<Suspense>` en el page para que el header del miembro pinte
 * primero. Hace en paralelo las dos queries que necesita el bloque
 * (`listTiersByPlace` + `listAssignmentsByMember`) y filtra `PUBLISHED`
 * adentro, antes de delegar el render al Server Component
 * `<TiersSection>` del subdir `components/`.
 *
 * El sufijo `_` excluye al archivo del file-system routing de Next 15.
 */
export async function TiersSectionStreamed({ placeSlug, placeId, memberUserId }: Props) {
  const [allTiers, assignments] = await Promise.all([
    listTiersByPlace(placeId, true),
    listAssignmentsByMember(memberUserId, placeId),
  ])
  const publishedTiers = allTiers.filter((t) => t.visibility === 'PUBLISHED')

  return (
    <TiersSection
      placeSlug={placeSlug}
      memberUserId={memberUserId}
      assignments={assignments}
      publishedTiers={publishedTiers}
    />
  )
}

/**
 * Fallback minimal para el `<Suspense>`. Match aproximado del shell:
 * heading + lista + bloque "Asignar tier". Sin shimmer agresivo
 * (cozytech: nada parpadea).
 */
export function TiersSectionSkeleton() {
  return (
    <section className="space-y-3" aria-hidden="true">
      <div className="bg-border/40 h-5 w-40 animate-pulse rounded" />
      <div className="bg-border/40 h-16 w-full animate-pulse rounded" />
      <div className="bg-border/40 h-24 w-full animate-pulse rounded-md" />
    </section>
  )
}
