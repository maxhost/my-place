import { LibraryItemHeader, type LibraryItemDetailView } from '@/features/library/public'

type Props = {
  item: LibraryItemDetailView
  /** Item del prereq para resolver title + slug. Si null (data inconsistente
   *  — el prereq fue archivado/eliminado pero el item sigue apuntando), se
   *  muestra copy fallback sin link. */
  prereq: { title: string; postSlug: string } | null
}

/**
 * Vista del item cuando el viewer NO completó el prereq (W3 wiring courses,
 * 2026-05-14). Reemplaza el body Lexical en `<LibraryItemContent>` con un
 * card calmo que comunica el lock + provee CTA al prereq.
 *
 * Decisión D2 ADR `2026-05-04-library-courses-and-read-access.md`:
 * **visible-but-locked** — el viewer ve título + cover + meta del item
 * (via `<LibraryItemHeader>`) pero NO el body. NO se oculta el item del
 * todo (anti-UX, pierde el "itinerary map" del curso).
 *
 * Owner bypass se maneja antes en el caller (`canOpenItem` retorna true
 * para owner) — este componente solo se renderiza para non-owners con
 * prereq incompleto.
 */
export function LockedItemView({ item, prereq }: Props): React.ReactNode {
  return (
    <>
      <LibraryItemHeader item={item} />
      <section
        className="mx-3 mt-3 rounded-md border border-amber-300 bg-amber-50 p-4"
        aria-labelledby="locked-heading"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">
            🔒
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="locked-heading" className="font-serif text-lg text-amber-900">
              Esta lección todavía está bloqueada
            </h2>
            {prereq ? (
              <>
                <p className="mt-1 text-sm text-amber-900/85">
                  Para abrirla, primero tenés que completar{' '}
                  <span className="font-medium">«{prereq.title}»</span>.
                </p>
                <a
                  href={`/library/${item.categorySlug}/${prereq.postSlug}`}
                  className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-amber-400 bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Ir a «{prereq.title}»
                </a>
              </>
            ) : (
              <p className="mt-1 text-sm text-amber-900/85">
                Esta lección depende de otra que ya no está disponible. Avisá al admin del place.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
