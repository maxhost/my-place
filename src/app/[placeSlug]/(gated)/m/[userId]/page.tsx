import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberProfile, findMemberPermissions } from '@/features/members/public'

export const metadata: Metadata = {
  title: 'Miembro · Place',
}

type Props = { params: Promise<{ placeSlug: string; userId: string }> }

/**
 * Perfil contextual mínimo de un miembro del place (2.H).
 *
 * Gate: visitor logueado + visitor miembro activo del place + target miembro activo
 * del mismo place. Cualquier falla resuelve 404 — principio ontológico: sin perfil
 * público fuera de places. Un no-miembro no puede siquiera confirmar que ese userId existe.
 *
 * Contenido MVP: displayName, handle, avatar, antigüedad, rol visible. Sin bio, sin
 * stats, sin DM. Placeholder de "contribuciones" queda reservado para Fase 5/6.
 *
 * Ver `docs/features/members/spec.md` § "Perfil contextual del miembro".
 */
export default async function MemberProfilePage({ params }: Props) {
  const { placeSlug, userId } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/m/${userId}`)
  }
  const visitorId = auth.id

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  // Visitor debe ser miembro activo del place — sino, 404 (no podés ver perfiles de
  // un place al que no pertenecés).
  const visitorPerms = await findMemberPermissions(visitorId, place.id)
  if (!visitorPerms.role) {
    notFound()
  }

  const profile = await findMemberProfile(place.id, userId)
  if (!profile) {
    notFound()
  }

  const roleLabel = profile.isOwner ? 'owner' : profile.role === 'ADMIN' ? 'admin' : 'miembro'

  return (
    <main className="mx-auto max-w-xl space-y-8 p-8">
      <header className="flex items-center gap-4">
        <Avatar url={profile.user.avatarUrl} displayName={profile.user.displayName} />
        <div>
          <h1 className="font-serif text-3xl italic">{profile.user.displayName}</h1>
          {profile.user.handle ? (
            <p className="text-sm text-neutral-500">@{profile.user.handle}</p>
          ) : null}
          <p className="mt-1 text-xs text-neutral-400">
            <span className="rounded-full border border-neutral-300 px-2 py-0.5">{roleLabel}</span>
            <span className="ml-2">{formatAntiquity(profile.joinedAt)}</span>
          </p>
        </div>
      </header>

      <section className="rounded-md border border-dashed border-neutral-300 p-6">
        <h2 className="font-serif text-lg italic text-neutral-600">Contribuciones</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Disponible cuando existan conversaciones y eventos en este place.
        </p>
      </section>
    </main>
  )
}

function Avatar({ url, displayName }: { url: string | null; displayName: string }) {
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="size-16 rounded-full border border-neutral-200 object-cover"
      />
    )
  }
  return (
    <div
      aria-hidden
      className="flex size-16 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 font-serif text-lg text-neutral-500"
    >
      {initials || '·'}
    </div>
  )
}

/**
 * "miembro desde hace X meses/días/años" en español. UTC en `joinedAt`, formato local.
 * No usamos Intl.RelativeTimeFormat directamente porque queremos siempre un valor
 * negativo (pasado) y granularidades fijas — los auto-pivot de `format()` varían con
 * la distancia y producen strings raros ("hace 180 segundos").
 */
function formatAntiquity(joinedAt: Date): string {
  const deltaMs = Date.now() - joinedAt.getTime()
  const days = Math.floor(deltaMs / (24 * 60 * 60 * 1000))
  if (days < 1) return 'miembro desde hoy'
  if (days < 30) return `miembro desde hace ${days} ${days === 1 ? 'día' : 'días'}`
  const months = Math.floor(days / 30)
  if (months < 12) return `miembro desde hace ${months} ${months === 1 ? 'mes' : 'meses'}`
  const years = Math.floor(months / 12)
  return `miembro desde hace ${years} ${years === 1 ? 'año' : 'años'}`
}
