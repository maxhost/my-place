import Link from 'next/link'
import { Settings } from 'lucide-react'
import { placeUrl } from '@/shared/lib/app-url'
import type { MyPlace } from '../domain/types'

/**
 * Lista de "mis places" en el inbox. Server component.
 * Diferencia sutilmente places donde soy owner (badge tenue) de los que soy solo miembro.
 * Admin/owner ve un enlace de configuración (engranaje) al subdominio `/settings`
 * del place — R.S, "punto de entrada" desde fuera del place.
 * Principio "nada grita": sin colores saturados ni métricas vanidosas.
 */
export function PlacesList({ places }: { places: MyPlace[] }) {
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

  return (
    <ul className="space-y-2">
      {places.map((place) => (
        // Card body y cog son siblings (HTML prohíbe anchors anidados).
        // El flex del <li> reserva ancho para el cog (shrink-0, min-w-11) cuando isAdmin,
        // así el texto del card se trunca en lugar de pisar el icono.
        // El `pr-2` del <li> da el respiro derecho del cog respecto del border:
        // así el cog queda autosuficiente (cuadrado puro) y no depende del gap del parent.
        <li
          key={place.id}
          className="flex items-stretch gap-2 rounded-md border border-neutral-200 pr-2 transition-colors hover:border-neutral-400"
        >
          <a
            href={placeUrl(place.slug).toString()}
            className="flex min-w-0 flex-1 items-baseline justify-between gap-4 p-4"
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
          {place.isAdmin ? (
            <a
              href={placeUrl(place.slug, '/settings').toString()}
              aria-label={`Configuración de ${place.name}`}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            >
              <Settings size={16} aria-hidden="true" />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
