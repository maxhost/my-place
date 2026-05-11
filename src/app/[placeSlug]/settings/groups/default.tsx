/**
 * Default children del layout `groups/` cuando NO hay segment `[groupId]`
 * (ruta `/settings/groups` raíz).
 *
 * Se renderea como `{children}` del layout master-detail → ocupa el detail
 * pane:
 *  - Desktop: placeholder calmo "Elegí un grupo de la lista" en el detail
 *    pane (lista visible al lado).
 *  - Mobile: oculto via `<MasterDetailLayout hasDetail={false}>` que
 *    esconde el detail pane y muestra el master (lista) full-width.
 *
 * Necesario por Next 15: cuando una ruta no tiene `page.tsx` ni segments
 * que matcheen, `default.tsx` proporciona el children del layout.
 */
export default function GroupsDefault() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="text-center">
        <p className="text-sm text-neutral-500">Elegí un grupo de la lista para ver su detalle.</p>
      </div>
    </div>
  )
}
