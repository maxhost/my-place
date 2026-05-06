import 'server-only'
import { listGroupsByPlace, listGroupsForUser } from '@/features/groups/public.server'
import type { GroupSummary } from '@/features/groups/public'
import { GroupsSection } from './components/groups-section'

type Props = {
  placeId: string
  memberUserId: string
}

/**
 * Streamed section: grupos asignados + control de asignación.
 *
 * Vive bajo `<Suspense>` en el page. Hace en paralelo
 * `listGroupsByPlace` + `listGroupsForUser` y computa `availableGroups`
 * (los del place a los que el miembro NO pertenece todavía) antes de
 * delegar el render al Server Component `<GroupsSection>` del subdir
 * `components/`.
 *
 * El sufijo `_` excluye al archivo del file-system routing de Next 15.
 */
export async function GroupsSectionStreamed({ placeId, memberUserId }: Props) {
  const [allGroups, memberGroups] = await Promise.all([
    listGroupsByPlace(placeId),
    listGroupsForUser(memberUserId, placeId),
  ])

  const memberGroupIds = new Set(memberGroups.map((g) => g.id))
  const availableGroups: GroupSummary[] = allGroups
    .filter((g) => !memberGroupIds.has(g.id))
    .map((g) => ({ id: g.id, name: g.name, isPreset: g.isPreset }))

  return (
    <GroupsSection
      placeId={placeId}
      memberUserId={memberUserId}
      currentGroups={memberGroups}
      availableGroups={availableGroups}
    />
  )
}

/**
 * Fallback minimal para el `<Suspense>`. Match aproximado del shell:
 * heading + bloque del control de grupos. Sin shimmer agresivo
 * (cozytech: nada parpadea).
 */
export function GroupsSectionSkeleton() {
  return (
    <section className="space-y-3" aria-hidden="true">
      <div className="bg-border/40 h-5 w-40 animate-pulse rounded" />
      <div className="bg-border/40 h-20 w-full animate-pulse rounded-md" />
    </section>
  )
}
