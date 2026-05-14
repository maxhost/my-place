/**
 * Skeleton de la cola de reportes. Mismo patrón sobrio que el resto de
 * settings — barras grises fijas, sin animación ruidosa. Tailwind neutrals
 * (no CSS vars de brand: settings es admin chrome).
 */
export default function SettingsFlagsLoading() {
  return (
    <div className="space-y-6 px-3 py-6 md:px-4 md:py-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-40 rounded bg-neutral-200" />
        <div className="h-8 w-48 rounded bg-neutral-200" />
        <div className="h-3 w-32 rounded bg-neutral-200" />
      </div>
      <div className="space-y-3">
        <div className="h-28 rounded-md border border-neutral-200 bg-neutral-100" />
        <div className="h-28 rounded-md border border-neutral-200 bg-neutral-100" />
        <div className="h-28 rounded-md border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  )
}
