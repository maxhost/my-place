import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getCurrentAuthUser } from '@/shared/lib/auth-user'
import { loadPlaceBySlug } from '@/shared/lib/place-loader'
import { findMemberPermissions } from '@/features/members/public.server'
import { listGroupsByPlace } from '@/features/groups/public.server'
import { ADMIN_PRESET_NAME, GroupsListAdmin } from '@/features/groups/public'
import { listLibraryCategories } from '@/features/library/public.server'
import { PageHeader } from '@/shared/ui/page-header'
import { MasterDetailLayout } from '@/shared/ui/master-detail-layout'

type Props = {
  children: React.ReactNode
  params: Promise<{ placeSlug: string }>
}

/**
 * Layout master-detail de `/settings/groups/*`.
 *
 * **Patrón canónico Place para master-detail** (decisión post-fixes Sesión
 * 3 + 5; aplicar este mismo patrón al rediseño futuro de library/tiers/members):
 *
 *  - La **lista** (master) vive ACÁ en el layout, server-rendered una sola
 *    vez. Persiste cuando navegás entre `/settings/groups` y
 *    `/settings/groups/[groupId]` — Next 15 reusa layouts entre routes
 *    hermanas, NO re-fetchea.
 *  - El **detail** es `{children}`, variable según el segment hijo:
 *     - `/settings/groups` (sin segment) → children = `page.tsx` (placeholder).
 *     - `/settings/groups/[groupId]` → children = `[groupId]/page.tsx` (detail).
 *  - Mobile: `<MasterDetailLayout hasDetail={true}>` esconde el master
 *    cuando hay detail (full screen). Detail content tiene back link `md:hidden`.
 *
 * **Approaches descartados:**
 *
 *  - **Parallel Routes (`@detail/` slot)**: probado en Sesión 3, descartado.
 *    Causa duplicación cuando ambos children y slot matchean la misma ruta.
 *    Más complejo y menos auditable. Doc: bug fix commit 60c777e.
 *  - **page.tsx independiente sin layout shared**: lista se re-fetchea en
 *    cada navegación → page reload visual en desktop al cambiar de detail.
 *  - **default.tsx en groups/ root**: solo aplica con Parallel Routes;
 *    sin slots, el URL `/groups` raíz da 404 sin un page.tsx real.
 *
 * Gate: owner-only (idéntico al gate viejo del page.tsx). El layout
 * `/settings/layout.tsx` ya gateá admin/owner; acá afinamos a owner.
 *
 * Ver `docs/features/groups/spec.md` § 5 y `docs/ux-patterns.md` §
 * "Master-detail layout".
 */
export default async function GroupsMasterDetailLayout({ children, params }: Props) {
  const { placeSlug } = await params

  const auth = await getCurrentAuthUser()
  if (!auth) {
    redirect(`/login?next=/settings/groups`)
  }

  const place = await loadPlaceBySlug(placeSlug)
  if (!place || place.archivedAt) {
    notFound()
  }

  const perms = await findMemberPermissions(auth.id, place.id)
  if (!perms.isOwner) {
    notFound()
  }

  const [groups, categories] = await Promise.all([
    listGroupsByPlace(place.id),
    listLibraryCategories(place.id),
  ])

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    emoji: c.emoji,
    title: c.title,
  }))

  const customGroups = groups.filter((g) => !g.isPreset)
  const hasCustomGroups = customGroups.length > 0

  // hasDetail derivado del pathname: si tenemos /settings/groups/[non-empty]
  // mobile esconde la lista y muestra el detail full-screen. Desktop muestra
  // ambos (split view) siempre.
  const headerStore = await headers()
  const pathname = headerStore.get('x-pathname') ?? ''
  const hasDetail = /^\/settings\/groups\/[^/]+/.test(pathname)

  const masterPane = (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8">
      <PageHeader
        title="Grupos"
        description={
          <>
            Definí grupos con permisos atómicos para delegar moderación. El grupo &quot;
            {ADMIN_PRESET_NAME}&quot; tiene todos los permisos por defecto y no se puede eliminar.
          </>
        }
      />
      <section aria-labelledby="groups-list-heading" className="space-y-3">
        <h2
          id="groups-list-heading"
          className="border-b pb-2 font-serif text-xl"
          style={{ borderColor: 'var(--border)' }}
        >
          Grupos
        </h2>
        <p className="mt-1 text-xs text-neutral-600">
          {groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}. El preset &quot;
          {ADMIN_PRESET_NAME}&quot; tiene todos los permisos por defecto.
        </p>
        <GroupsListAdmin placeSlug={place.slug} groups={groups} categories={categoryOptions} />
        {!hasCustomGroups && (
          <p className="text-sm italic text-neutral-500">
            Todavía no creaste grupos custom. Crealos para delegar moderación a miembros sin darles
            todos los permisos.
          </p>
        )}
      </section>
    </div>
  )

  return (
    <MasterDetailLayout
      master={masterPane}
      detail={children}
      hasDetail={hasDetail}
      masterLabel="Lista de grupos"
      detailLabel="Detalle del grupo"
    />
  )
}
