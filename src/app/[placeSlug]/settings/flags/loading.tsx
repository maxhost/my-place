/**
 * Skeleton de la cola de reportes. Mismo patrón sobrio que el resto de
 * settings — barras grises fijas, sin animación ruidosa.
 */
export default function SettingsFlagsLoading() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 md:p-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="bg-place-mark-bg/30 h-4 w-40 rounded" />
        <div className="bg-place-mark-bg/50 h-8 w-48 rounded" />
        <div className="bg-place-mark-bg/30 h-3 w-32 rounded" />
      </div>
      <div className="space-y-3">
        <div className="h-28 rounded-lg border border-place-divider bg-place-card" />
        <div className="h-28 rounded-lg border border-place-divider bg-place-card" />
        <div className="h-28 rounded-lg border border-place-divider bg-place-card" />
      </div>
    </main>
  )
}
