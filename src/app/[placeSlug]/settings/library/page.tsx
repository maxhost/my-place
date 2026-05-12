/**
 * Children del layout cuando estás en `/settings/library` raíz (sin segment
 * `[categoryId]`). Renderea el placeholder en el detail pane del MasterDetailLayout.
 *
 * - Desktop: ocupa el detail pane (lista master visible al lado).
 * - Mobile: oculto via `<MasterDetailLayout hasDetail={false}>` que esconde
 *   el detail pane y muestra el master (lista) full-width.
 *
 * El layout (`./layout.tsx`) carga la lista UNA VEZ y la mantiene cuando
 * navegás a `/settings/library/[categoryId]` (Next 15 reusa layouts entre
 * routes hermanas → lista persistente sin re-fetch).
 *
 * Mismo patrón que `/settings/groups/page.tsx` (canon master-detail Place,
 * doc en `docs/ux-patterns.md` § "Master-detail layout").
 */
export default function LibraryRootPage(): React.ReactNode {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="text-center">
        <p className="text-sm text-neutral-500">
          Elegí una categoría de la lista para ver su detalle.
        </p>
      </div>
    </div>
  )
}
