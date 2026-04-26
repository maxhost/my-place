'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useRouter } from 'next/navigation'
import {
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  EVENT_TITLE_MIN_LENGTH,
} from '../domain/invariants'
import { createEventAction } from '../server/actions/create'
import { updateEventAction } from '../server/actions/update'
import { friendlyEventErrorMessage } from './errors'

type CreateMode = {
  kind: 'create'
  placeId: string
}

type EditMode = {
  kind: 'edit'
  eventId: string
  initialTitle: string
  initialDescription: string
  initialStartsAt: string // ISO 8601 (datetime-local format)
  initialEndsAt: string
  initialTimezone: string
  initialLocation: string
  /** Slug del thread asociado — el evento ES el thread (F.F). Tras guardar,
   *  redirigimos a `/conversations/${postSlug}`. Null en el caso defensivo
   *  de evento sin Post asociado. */
  postSlug: string | null
}

type Props = {
  mode: CreateMode | EditMode
  /** Whitelist de timezones IANA para el `<select>`. Se pasa como prop desde
   *  el server (página padre) para evitar que `EventForm` (Client Component)
   *  importe `@/features/hours/public`, que arrastra `import 'server-only'`
   *  al bundle cliente y rompe el build. Mismo precedente que el split
   *  client/server de flags. */
  allowedTimezones: ReadonlyArray<string>
  /** Default timezone para el form en modo create (típico: timezone del place
   *  o del browser). En edit viene del evento. */
  defaultTimezone?: string
}

type FormValues = {
  title: string
  description: string
  startsAt: string // <input type="datetime-local"> string
  endsAt: string
  timezone: string
  location: string
}

type Feedback = { kind: 'err'; message: string } | null

/**
 * Form de crear / editar evento. Misma UI sirve los dos modos.
 *
 * Inputs:
 *  - title (text, 3–120)
 *  - description (textarea — F1: plain text que el server envuelve en TipTap
 *    paragraph; F.E puede upgradear a TipTap editor completo)
 *  - startsAt (datetime-local)
 *  - endsAt (datetime-local, opcional)
 *  - timezone (select de whitelist hours)
 *  - location (text, max 200, opcional)
 *
 * `datetime-local` produce strings tipo `2026-05-01T20:00` SIN timezone —
 * el browser los interpreta como hora local del cliente. Acá los enviamos
 * como Date construido localmente; el server los persiste como UTC en
 * `timestamptz`. La columna `timezone` separada captura el "intencional".
 *
 * F1: si el cliente está en otro huso que el `timezone` seleccionado, lo
 * que escribió el usuario es la hora local del cliente — para arreglar esto
 * propiamente hace falta un picker que opere en el TZ del evento. Out of
 * scope F1; documentado.
 */
export function EventForm({ mode, allowedTimezones, defaultTimezone }: Props): React.ReactNode {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)

  const initial: FormValues =
    mode.kind === 'create'
      ? {
          title: '',
          description: '',
          startsAt: '',
          endsAt: '',
          timezone: defaultTimezone ?? 'America/Argentina/Buenos_Aires',
          location: '',
        }
      : {
          title: mode.initialTitle,
          description: mode.initialDescription,
          startsAt: mode.initialStartsAt,
          endsAt: mode.initialEndsAt,
          timezone: mode.initialTimezone,
          location: mode.initialLocation,
        }

  const { register, handleSubmit, formState } = useForm<FormValues>({ defaultValues: initial })

  function onSubmit(values: FormValues): void {
    setFeedback(null)
    const startsAt = new Date(values.startsAt)
    const endsAt = values.endsAt ? new Date(values.endsAt) : null
    const description = buildDescription(values.description)

    startTransition(async () => {
      try {
        if (mode.kind === 'create') {
          const result = await createEventAction({
            placeId: mode.placeId,
            title: values.title,
            description,
            startsAt,
            endsAt,
            timezone: values.timezone,
            location: values.location.trim() === '' ? null : values.location.trim(),
          })
          // F.F: el evento ES el thread; tras crear redirigimos al thread,
          // no a una page de detalle aparte.
          router.push(`/conversations/${result.postSlug}`)
        } else {
          await updateEventAction({
            eventId: mode.eventId,
            title: values.title,
            description,
            startsAt,
            endsAt,
            timezone: values.timezone,
            location: values.location.trim() === '' ? null : values.location.trim(),
          })
          // F.F: redirect al thread del evento. Si por alguna razón defensiva
          // no hay postSlug (debería ser raro), volvemos al listado.
          router.push(mode.postSlug ? `/conversations/${mode.postSlug}` : '/events')
          router.refresh()
        }
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyEventErrorMessage(err) })
      }
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {feedback?.kind === 'err' ? (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {feedback.message}
        </div>
      ) : null}

      <label className="block">
        <span className="mb-1 block text-sm text-place-text-soft">Título</span>
        <input
          type="text"
          maxLength={EVENT_TITLE_MAX_LENGTH}
          aria-invalid={formState.errors.title ? true : undefined}
          className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
          {...register('title', { required: true, minLength: EVENT_TITLE_MIN_LENGTH })}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-place-text-soft">Descripción (opcional)</span>
        <textarea
          rows={4}
          className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
          placeholder="Qué traer, cómo llegar, intenciones, links útiles…"
          {...register('description')}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-place-text-soft">Empieza</span>
          <input
            type="datetime-local"
            required
            className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
            {...register('startsAt', { required: true })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-place-text-soft">Termina (opcional)</span>
          <input
            type="datetime-local"
            className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
            {...register('endsAt')}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm text-place-text-soft">Timezone del evento</span>
        <select
          className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
          {...register('timezone', { required: true })}
        >
          {allowedTimezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-place-text-soft">
          La hora del evento se muestra siempre en este timezone, sin importar dónde esté quien lo
          mire.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm text-place-text-soft">
          Dónde (opcional, dirección o link)
        </span>
        <input
          type="text"
          maxLength={EVENT_LOCATION_MAX_LENGTH}
          placeholder="Av. Corrientes 1234 / https://meet.google.com/abc-defg-hij"
          className="w-full rounded-md border border-place-divider bg-place-card px-3 py-2 text-place-text focus:border-place-mark-fg focus:outline-none"
          {...register('location')}
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-place-mark-bg px-4 py-2 text-place-mark-fg disabled:opacity-60"
        >
          {pending
            ? mode.kind === 'create'
              ? 'Proponiendo…'
              : 'Guardando…'
            : mode.kind === 'create'
              ? 'Proponer evento'
              : 'Guardar cambios'}
        </button>
        {mode.kind === 'edit' ? (
          <button
            type="button"
            onClick={() =>
              router.push(mode.postSlug ? `/conversations/${mode.postSlug}` : '/events')
            }
            disabled={pending}
            className="rounded-md px-3 py-2 text-sm text-place-text-soft hover:text-place-text"
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  )
}

/**
 * Convierte el textarea plano en un mini AST TipTap (paragraph único).
 * F.E o post-F1 puede upgradear el form a TipTap editor completo.
 */
function buildDescription(text: string): null | { type: 'doc'; content: unknown[] } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: trimmed }],
      },
    ],
  }
}
