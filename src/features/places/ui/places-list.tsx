import Link from 'next/link'
import { protocolFor } from '@/shared/lib/app-url'
import type { MyPlace } from '../domain/types'

/**
 * Lista de "mis places" en el inbox. Server component.
 * Diferencia sutilmente places donde soy owner (badge tenue) de los que soy solo miembro.
 * Principio "nada grita": sin colores saturados ni métricas vanidosas.
 */
export function PlacesList({ places, appDomain }: { places: MyPlace[]; appDomain: string }) {
  if (places.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 p-6 text-sm text-neutral-600">
        <p className="mb-3">No pertenecés a ningún place todavía.</p>
        <Link
          href="/places/new"
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-white"
        >
          Crear un place
        </Link>
      </div>
    )
  }

  const proto = protocolFor(appDomain)

  return (
    <ul className="space-y-2">
      {places.map((place) => (
        <li key={place.id}>
          <a
            href={`${proto}://${place.slug}.${appDomain}/`}
            className="flex items-baseline justify-between gap-4 rounded-md border border-neutral-200 p-4 transition-colors hover:border-neutral-400"
          >
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="truncate font-serif text-lg italic">{place.name}</h2>
                {place.isOwner ? (
                  <span className="text-xs uppercase tracking-wide text-neutral-400">owner</span>
                ) : null}
              </div>
              {place.description ? (
                <p className="mt-1 truncate text-sm text-neutral-600">{place.description}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs text-neutral-400">{place.slug}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
