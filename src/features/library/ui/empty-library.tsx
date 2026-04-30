/**
 * Empty state de la zona Biblioteca (R.5).
 *
 * Cuando no hay categorías en el place, mostramos un placeholder
 * calmo: emoji 📭 + título Fraunces + subtitle muted. **Sin CTA**
 * (decisión user 2026-04-30): no inducimos a accionar uploads
 * mientras la feature no exista. Cuando R.5.X sume uploads, se
 * agrega el botón con flow real.
 *
 * Sin grito visual, sin badges. Alineado con principios "nada
 * parpadea, nada grita" + "presencia silenciosa".
 *
 * Server Component puro.
 *
 * Ver `docs/features/library/spec.md`.
 */
export function EmptyLibrary(): React.ReactNode {
  return (
    <div className="mx-3 flex flex-col items-center gap-3 rounded-[18px] border-[0.5px] border-border bg-surface px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl leading-none">
        📭
      </span>
      <h2 className="font-title text-[22px] font-bold text-text">
        Tu comunidad todavía no agregó recursos
      </h2>
      <p className="max-w-[280px] font-body text-sm text-muted">
        Cuando alguien suba un documento o un link, lo vas a ver acá organizado por categoría.
      </p>
    </div>
  )
}
