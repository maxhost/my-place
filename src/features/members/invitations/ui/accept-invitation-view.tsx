'use client'

import { useState, useTransition } from 'react'
import { acceptInvitationAction } from '../server/actions/accept'
import { isDomainError } from '@/shared/errors/domain-error'
import { placeUrl } from '@/shared/lib/app-url'

/**
 * Vista de confirmación para aceptar una invitación. Renderizada por
 * `src/app/invite/accept/[token]/page.tsx` tras validar el token server-side.
 *
 * En success redirige al subdomain del place del slug retornado por el server.
 */

export function AcceptInvitationView({
  token,
  placeName,
  placeSlug,
  asAdmin,
  errorFromCallback = null,
}: {
  token: string
  placeName: string
  placeSlug: string
  asAdmin: boolean
  /**
   * Mensaje opcional que el callback puede pasar via `?error=<reason>` cuando
   * el accept inline (T2) falló y necesita fallback al flow manual. La page
   * mappea reasons del core a mensajes humanos antes de pasarlo acá.
   */
  errorFromCallback?: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(errorFromCallback)

  function onAccept() {
    setError(null)
    startTransition(async () => {
      try {
        const res = await acceptInvitationAction(token)
        window.location.href = placeUrl(res.placeSlug).href
      } catch (err) {
        setError(friendlyMessage(err))
      }
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div>
          <p className="text-sm text-neutral-500">Invitación a</p>
          <h1 className="font-serif text-3xl italic">{placeName}</h1>
          <p className="mt-1 text-xs text-neutral-400">{placeSlug}</p>
        </div>

        <p className="text-sm text-neutral-700">
          {asAdmin
            ? 'Te van a sumar como administrador. Vas a poder invitar a otros miembros y editar la configuración del place.'
            : 'Te van a sumar como miembro. Podés participar en conversaciones y eventos.'}
        </p>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onAccept}
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
        >
          {pending ? 'Entrando…' : 'Aceptar y entrar'}
        </button>
      </div>
    </main>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message
      case 'AUTHORIZATION':
        return 'Tu sesión expiró. Iniciá sesión de nuevo.'
      case 'NOT_FOUND':
        return 'Esta invitación ya no es válida.'
      case 'INVARIANT_VIOLATION':
        return err.message
      case 'CONFLICT':
        return err.message
      default:
        return 'No se pudo aceptar la invitación.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
