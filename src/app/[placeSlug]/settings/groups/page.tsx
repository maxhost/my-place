/**
 * Children del layout cuando estás en `/settings/groups` raíz (sin segment
 * `[groupId]`). Renderea el placeholder en el detail pane del MasterDetailLayout.
 *
 * - Desktop: ocupa el detail pane (lista master visible al lado).
 * - Mobile: oculto via `<MasterDetailLayout hasDetail={false}>` que esconde
 *   el detail pane y muestra el master (lista) full-width.
 *
 * El layout (`./layout.tsx`) carga la lista UNA VEZ y la mantiene cuando
 * navegás a `/settings/groups/[groupId]` (Next 15 reusa layouts entre
 * routes hermanas → lista persistente sin re-fetch).
 *
 * Decisión arquitectónica: NO usamos Parallel Routes para master-detail
 * (causaba bugs sutiles de routing y re-render). El layout simple +
 * page.tsx placeholder + [groupId]/page.tsx detail es más auditable y
 * funciona idénticamente en mobile (stack) y desktop (split).
 */
export default function GroupsRootPage() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="text-center">
        <p className="text-sm text-neutral-500">Elegí un grupo de la lista para ver su detalle.</p>
      </div>
    </div>
  )
}
