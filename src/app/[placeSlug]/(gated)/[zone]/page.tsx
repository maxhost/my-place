type Props = { params: Promise<{ placeSlug: string; zone: string }> }

/**
 * Zona del place (conversations, events, etc.). Placeholder hasta Fase 5/6.
 */
export default async function PlaceZonePage({ params }: Props) {
  const { placeSlug, zone } = await params
  return (
    <main className="p-8">
      <h1 className="font-serif text-2xl italic">
        {placeSlug} · {zone}
      </h1>
      <p className="mt-2 text-place-text-soft">Zona placeholder.</p>
    </main>
  )
}
