'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { BillingMode } from '@prisma/client'
import { createPlaceSchema } from '../schemas'
import { createPlaceAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'
import { placeUrl } from '@/shared/lib/app-url'
import { clientEnv } from '@/shared/config/env'

/**
 * Form de creación de place. Renderizado en `app.place.app/places/new`.
 * Usa Tailwind neutral — el theming del place aún no existe en este contexto.
 */

type FormValues = {
  slug: string
  name: string
  description: string
  billingMode: BillingMode
}

export function PlaceCreateForm() {
  const appDomain = clientEnv.NEXT_PUBLIC_APP_DOMAIN
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [serverError, setServerError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})

  const { register, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      slug: '',
      name: '',
      description: '',
      billingMode: BillingMode.OWNER_PAYS,
    },
  })

  function onSubmit(values: FormValues) {
    setServerError(null)
    setFieldErrors({})

    const parsed = createPlaceSchema.safeParse({
      slug: values.slug.trim(),
      name: values.name,
      description: values.description,
      billingMode: values.billingMode,
    })

    if (!parsed.success) {
      const errs: Partial<Record<keyof FormValues, string>> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormValues | undefined
        if (key && !errs[key]) errs[key] = issue.message
      }
      setFieldErrors(errs)
      return
    }

    startTransition(async () => {
      try {
        const res = await createPlaceAction(parsed.data)
        router.push(placeUrl(res.place.slug).toString())
      } catch (err) {
        setServerError(friendlyMessage(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {serverError ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {serverError}
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Slug</span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
          aria-invalid={fieldErrors.slug ? true : undefined}
          {...register('slug', { required: true })}
        />
        <span className="mt-1 block text-xs text-neutral-500">
          Tu subdomain:{' '}
          <code>
            {'{slug}'}.{appDomain}
          </code>
          . Solo minúsculas, dígitos y guiones. Inmutable.
        </span>
        {fieldErrors.slug ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.slug}</span>
        ) : null}
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Nombre</span>
        <input
          type="text"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
          aria-invalid={fieldErrors.name ? true : undefined}
          {...register('name', { required: true })}
        />
        {fieldErrors.name ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.name}</span>
        ) : null}
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Descripción (opcional)</span>
        <textarea
          rows={3}
          maxLength={280}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
          {...register('description')}
        />
        {fieldErrors.description ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.description}</span>
        ) : null}
      </label>

      <fieldset className="space-y-2">
        <legend className="mb-1 block text-sm text-neutral-600">Modo de cobro</legend>
        <label className="flex items-start gap-2 rounded-md border border-neutral-300 p-3 text-sm">
          <input
            type="radio"
            value={BillingMode.OWNER_PAYS}
            className="mt-1"
            {...register('billingMode')}
          />
          <span>El owner paga la cuenta del place</span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-neutral-300 p-3 text-sm">
          <input
            type="radio"
            value={BillingMode.OWNER_PAYS_AND_CHARGES}
            className="mt-1"
            {...register('billingMode')}
          />
          <span>El owner paga y cobra a los miembros</span>
        </label>
        <label className="flex items-start gap-2 rounded-md border border-neutral-300 p-3 text-sm">
          <input
            type="radio"
            value={BillingMode.SPLIT_AMONG_MEMBERS}
            className="mt-1"
            {...register('billingMode')}
          />
          <span>Se divide entre miembros</span>
        </label>
        {fieldErrors.billingMode ? (
          <span className="block text-xs text-amber-700">{fieldErrors.billingMode}</span>
        ) : null}
        <span className="block text-xs text-neutral-500">
          El cobro real se activa al completar la integración con Stripe (próxima fase).
        </span>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {pending ? 'Creando…' : 'Crear place'}
      </button>
    </form>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message || 'Datos inválidos.'
      case 'CONFLICT':
        return 'Ese slug ya está en uso.'
      case 'AUTHORIZATION':
        return 'Tu sesión expiró. Iniciá sesión de nuevo.'
      default:
        return 'No se pudo crear el place.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
