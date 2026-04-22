'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { inviteMemberSchema } from '../schemas'
import { inviteMemberAction } from '../server/actions'
import { isDomainError } from '@/shared/errors/domain-error'

/**
 * Form de invitación para settings/members. Espera renderizarse dentro del place
 * (subdomain del tenant) y recibe `placeSlug` del server component padre.
 *
 * Tailwind neutral deliberado — el theming del place aún no está wired al slice.
 */

type FormValues = { email: string; asAdmin: boolean }

type Feedback = { kind: 'ok' | 'err'; message: string }

export function InviteMemberForm({ placeSlug }: { placeSlug: string }) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})

  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { email: '', asAdmin: false },
  })

  function onSubmit(values: FormValues) {
    setFeedback(null)
    setFieldErrors({})

    const parsed = inviteMemberSchema.safeParse({
      placeSlug,
      email: values.email,
      asAdmin: values.asAdmin,
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
        await inviteMemberAction(parsed.data)
        setFeedback({ kind: 'ok', message: 'Invitación enviada.' })
        reset({ email: '', asAdmin: false })
      } catch (err) {
        setFeedback({ kind: 'err', message: friendlyMessage(err) })
      }
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
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

      <label className="block text-sm">
        <span className="mb-1 block text-neutral-600">Email</span>
        <input
          type="email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 focus:border-neutral-500 focus:outline-none"
          aria-invalid={fieldErrors.email ? true : undefined}
          {...register('email', { required: true })}
        />
        {fieldErrors.email ? (
          <span className="mt-1 block text-xs text-amber-700">{fieldErrors.email}</span>
        ) : null}
      </label>

      <label className="flex items-start gap-2 text-sm text-neutral-600">
        <input type="checkbox" className="mt-1" {...register('asAdmin')} />
        <span>Invitar como admin (puede invitar a otros, editar config del place).</span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {pending ? 'Enviando…' : 'Enviar invitación'}
      </button>
    </form>
  )
}

function friendlyMessage(err: unknown): string {
  if (isDomainError(err)) {
    switch (err.code) {
      case 'VALIDATION':
        return err.message || 'Datos inválidos.'
      case 'AUTHORIZATION':
        return 'No tenés permisos para invitar miembros.'
      case 'NOT_FOUND':
        return 'No encontramos este place.'
      case 'INVARIANT_VIOLATION':
        return err.message
      case 'CONFLICT':
        return err.message
      case 'INVITATION_LINK_GENERATION':
        return 'No pudimos generar el link de invitación. La invitación quedó pendiente — podés reintentar desde "Invitaciones pendientes".'
      case 'INVITATION_EMAIL_FAILED':
        return 'No pudimos enviar el email. La invitación quedó guardada — podés reintentar desde "Invitaciones pendientes".'
      default:
        return 'No se pudo enviar la invitación.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
