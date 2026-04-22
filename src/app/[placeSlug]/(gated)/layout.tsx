import { notFound } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { findOrCreateCurrentOpening } from '@/features/discussions/public'
import { findMemberPermissions } from '@/features/members/public'
import { isPlaceOpen, parseOpeningHours, PlaceClosedView } from '@/features/hours/public'
import { logger } from '@/shared/lib/logger'
import { loadPlace } from '../layout'

type Props = {
  children: React.ReactNode
  params: Promise<{ placeSlug: string }>
}

/**
 * Hard gate de acceso al contenido del place. Si el place está cerrado según
 * `isPlaceOpen(hours, now)`:
 *  - Member → `<PlaceClosedView variant="member">`.
 *  - Admin/owner → `<PlaceClosedView variant="admin">` con CTA a `/settings/hours`.
 *
 * El layout padre (`[placeSlug]/layout.tsx`) ya garantizó sesión + membership,
 * así que aquí podemos resolver el rol reusando los mismos queries (React.cache
 * los memoiza por request).
 *
 * Ver `docs/features/hours/spec.md` § "Comportamiento por rol".
 */
export default async function GatedLayout({ children, params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  const place = await loadPlace(placeSlug)
  if (!auth || !place) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  const hours = parseOpeningHours(place.openingHours)
  const status = isPlaceOpen(hours, new Date())
  if (status.open) {
    // Materializa (o reusa) la apertura actual como efecto del request abierto.
    // Fire-and-forget: no bloqueamos el render; si falla, la próxima acción
    // que necesite la apertura (ej: markPostRead) la reintenta. React.cache
    // en `findOrCreateCurrentOpening` evita el round-trip duplicado si un RSC
    // hijo lo invoca en la misma request.
    findOrCreateCurrentOpening(place.id).catch((err) => {
      logger.error({ err, placeId: place.id }, 'failed to materialize opening')
    })
    return <>{children}</>
  }

  const variant: 'admin' | 'member' = perms.isOwner || perms.role === 'ADMIN' ? 'admin' : 'member'

  return (
    <PlaceClosedView
      placeName={place.name}
      opensAt={status.opensAt}
      hours={hours}
      variant={variant}
    />
  )
}
