import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/shared/lib/supabase/server'
import { findMemberPermissions } from '@/features/members/public'
import { findPlaceHours, isPlaceOpen, PlaceClosedView } from '@/features/hours/public'
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

  const supabase = await createSupabaseServer()
  const { data: auth } = await supabase.auth.getUser()
  const place = await loadPlace(placeSlug)
  if (!auth.user || !place) {
    notFound()
  }

  const [perms, hours] = await Promise.all([
    findMemberPermissions(auth.user.id, place.id),
    findPlaceHours(place.id),
  ])

  const status = isPlaceOpen(hours, new Date())
  if (status.open) {
    return <>{children}</>
  }

  const variant: 'admin' | 'member' = perms.isOwner || perms.role === 'ADMIN' ? 'admin' : 'member'

  return (
    <PlaceClosedView
      placeName={place.name}
      placeSlug={place.slug}
      opensAt={status.opensAt}
      hours={hours}
      variant={variant}
    />
  )
}
