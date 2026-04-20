type Props = { params: Promise<{ placeSlug: string; id: string }> }

/**
 * Thread individual. Placeholder hasta Fase 5 (conversaciones).
 */
export default async function ThreadPage({ params }: Props) {
  const { placeSlug, id } = await params
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl italic">Thread {id}</h1>
      <p className="mt-2 text-place-text-soft">En {placeSlug}. Placeholder — Fase 5.</p>
    </main>
  )
}
