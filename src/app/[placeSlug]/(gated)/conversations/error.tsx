'use client'

/**
 * Boundary local al bucket de conversaciones. Un error acá (ej: P2002 escapado,
 * action rota) muestra un copy calmo sin tumbar la navegación del place — los
 * otros route groups (`/settings`, `/m`) siguen funcionando.
 */
export default function ConversationsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
      <h1 className="font-serif text-2xl italic text-place-text">Algo no salió bien</h1>
      <p className="text-sm text-place-text-soft">
        No pudimos cargar las conversaciones ahora. Volvé a intentarlo en un momento.
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
