'use client'

/**
 * Boundary local a la admin UI de biblioteca. Un error acá (query fallida,
 * action rota) muestra un copy calmo sin tumbar el resto de `/settings/*`.
 *
 * Tailwind neutrals (settings es admin chrome — no CSS vars de brand).
 */
export default function SettingsLibraryError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="space-y-4 px-3 py-6 md:px-4 md:py-8">
      <h1 className="font-serif text-2xl italic text-neutral-900">
        No pudimos cargar la biblioteca
      </h1>
      <p className="text-sm text-neutral-600">
        Algo salió mal al traer las categorías. Reintentá en un momento.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Reintentar
      </button>
    </div>
  )
}
