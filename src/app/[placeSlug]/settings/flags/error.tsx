'use client'

/**
 * Boundary local a la cola de reportes. Un error acá (query fallida, action
 * rota) muestra un copy calmo sin tumbar el resto de `/settings/*`.
 */
export default function SettingsFlagsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
      <h1 className="font-serif text-2xl italic text-place-text">No pudimos cargar los reportes</h1>
      <p className="text-sm text-place-text-soft">
        Algo salió mal al traer la cola de moderación. Reintentá en un momento.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-place-divider bg-place-card px-4 py-2 text-sm text-place-text-soft hover:text-place-text"
      >
        Reintentar
      </button>
    </main>
  )
}
