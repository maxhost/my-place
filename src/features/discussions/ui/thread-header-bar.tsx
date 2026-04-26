import { BackButton } from '@/shared/ui/back-button'

/**
 * Header bar del thread detail (R.6.4). Sticky 56px arriba del PostDetail
 * dentro del shell viewport — el TopBar del shell (52px) + dots (28px)
 * son los que están más arriba pero no son sticky, así que cuando el user
 * scrollea, ThreadHeaderBar queda pinned al top de la viewport.
 *
 * Layout: BackButton 36×36 a la izquierda + slot derecho para acciones
 * contextuales (típicamente `<PostAdminMenu>` para admins; vacío para
 * non-admins en R.6).
 *
 * El `fallbackHref` apunta a `/conversations` — si el user llega via deep
 * link y no tiene history, "Volver" lo lleva al listado.
 *
 * Backdrop blur sobre `bg/80` — preserva contraste cuando hay contenido
 * pasando por debajo durante el scroll. Border bottom hairline marca el
 * límite con el contenido del thread.
 *
 * Ver `docs/features/discussions/spec.md` § 21.2.
 */
export function ThreadHeaderBar({ rightSlot }: { rightSlot?: React.ReactNode }): React.ReactNode {
  return (
    <div className="bg-bg/80 supports-[backdrop-filter]:bg-bg/70 sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b-[0.5px] border-border px-3 backdrop-blur">
      <BackButton fallbackHref="/conversations" label="Volver a conversaciones" />
      <div className="flex items-center gap-1">{rightSlot}</div>
    </div>
  )
}
