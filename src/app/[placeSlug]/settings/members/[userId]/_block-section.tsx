import 'server-only'
import { findMemberBlockInfo } from '@/features/members/public.server'
import { BlockSection } from './components/block-section'

type Props = {
  placeId: string
  memberUserId: string
  memberDisplayName: string
  /** Email del viewer — autocompleta el campo `contactEmail` del dialog. */
  actorEmail: string
}

/**
 * Streamed section: bloquear / desbloquear miembro.
 *
 * Vive bajo `<Suspense>` en el page. Resuelve `findMemberBlockInfo` y
 * delega el render al Server Component `<BlockSection>` del subdir
 * `components/`, que ya sabe diferenciar entre `block` y `unblock`
 * según el shape del `blockInfo`.
 *
 * El sufijo `_` excluye al archivo del file-system routing de Next 15.
 */
export async function BlockSectionStreamed({
  placeId,
  memberUserId,
  memberDisplayName,
  actorEmail,
}: Props) {
  const blockInfo = await findMemberBlockInfo(memberUserId, placeId)

  return (
    <BlockSection
      placeId={placeId}
      memberUserId={memberUserId}
      memberDisplayName={memberDisplayName}
      actorEmail={actorEmail}
      blockInfo={blockInfo}
    />
  )
}

/**
 * Fallback minimal para el `<Suspense>`. Match aproximado del shell:
 * heading + copy + botón. Sin shimmer agresivo (cozytech: nada parpadea).
 */
export function BlockSectionSkeleton() {
  return (
    <section className="space-y-3" aria-hidden="true">
      <div className="bg-border/40 h-5 w-44 animate-pulse rounded" />
      <div className="bg-border/40 h-4 w-full max-w-md animate-pulse rounded" />
      <div className="bg-border/40 h-9 w-40 animate-pulse rounded-md" />
    </section>
  )
}
