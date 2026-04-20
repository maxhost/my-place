'use client'

import { useState, useTransition } from 'react'
import { useForm, useFieldArray, FormProvider } from 'react-hook-form'
import { ALLOWED_TIMEZONES } from '../domain/timezones'
import { updateHoursInputSchema, type UpdateHoursInput } from '../schemas'
import { updatePlaceHoursAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'
import { WeekEditor } from './week-editor'
import { ExceptionsEditor } from './exceptions-editor'
import { humanTimezone } from './hours-preview'

/**
 * Form de configuración del horario. Se monta en `/settings/hours` con defaults
 * del `OpeningHours` existente. El toggle `always_open` NO está disponible
 * intencionalmente (decisión de producto en `docs/features/hours/spec.md`) —
 * un admin que necesite 24/7 usa SQL hasta que se habilite en UI.
 *
 * Validación: se ejecuta con el mismo `updateHoursInputSchema` que el server;
 * el `safeParse` client-side muestra errores inline antes de hacer el round-trip.
 */

export type HoursFormDefaults = {
  timezone: (typeof ALLOWED_TIMEZONES)[number]
  recurring: UpdateHoursInput['recurring']
  exceptions: UpdateHoursInput['exceptions']
}

type FormValues = {
  timezone: string
  recurring: UpdateHoursInput['recurring']
  exceptions: UpdateHoursInput['exceptions']
}

type Feedback = { kind: 'ok' | 'err'; message: string }

export function HoursForm({
  placeSlug,
  defaults,
}: {
  placeSlug: string
  defaults: HoursFormDefaults
}) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const methods = useForm<FormValues>({
    defaultValues: {
      timezone: defaults.timezone,
      recurring: defaults.recurring,
      exceptions: defaults.exceptions,
    },
    mode: 'onSubmit',
  })
  const { register, handleSubmit, control } = methods

  const recurring = useFieldArray({ control, name: 'recurring' })
  const exceptions = useFieldArray({ control, name: 'exceptions' })

  function onSubmit(values: FormValues) {
    setFeedback(null)
    setFormError(null)

    const parsed = updateHoursInputSchema.safeParse({
      placeSlug,
      timezone: values.timezone,
      recurring: values.recurring,
      exceptions: values.exceptions,
    })
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setFormError(first?.message ?? 'Datos inválidos.')
      return
    }

    startTransition(async () => {
      try {
        await updatePlaceHoursAction(parsed.data)
        setFeedback({ kind: 'ok', message: 'Horario actualizado.' })
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyMessage(err) })
      }
    })
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
        {feedback ? (
          <div
            role={feedback.kind === 'ok' ? 'status' : 'alert'}
            className={
              feedback.kind === 'ok'
                ? 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900'
                : 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900'
            }
          >
            {feedback.message}
          </div>
        ) : null}

        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {formError}
          </div>
        ) : null}

        <section className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-600">Timezone del place</span>
            <select
              {...register('timezone')}
              className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
            >
              {ALLOWED_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {humanTimezone(tz)} — {tz}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-500">
            El horario se interpreta siempre en la zona del place, no en la del viewer.
          </p>
        </section>

        <WeekEditor
          fields={recurring.fields}
          onAdd={(w) => recurring.append(w)}
          onRemove={(idx) => recurring.remove(idx)}
        />

        <ExceptionsEditor
          fields={exceptions.fields}
          onAdd={(e) => exceptions.append(e)}
          onRemove={(idx) => exceptions.remove(idx)}
        />

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {pending ? 'Guardando…' : 'Guardar horario'}
        </button>
      </form>
    </FormProvider>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message || 'Horario inválido.'
      case 'AUTHORIZATION':
        return 'No tenés permisos para editar este horario.'
      case 'NOT_FOUND':
        return 'No encontramos este place.'
      default:
        return err.message
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
