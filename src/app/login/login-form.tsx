'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { requestMagicLink } from './actions'
import { devSignIn } from './dev-actions'

const IS_DEV = process.env.NODE_ENV !== 'production'

const formSchema = z.object({
  email: z.string().email('Ingresá un email válido'),
})

type FormValues = z.infer<typeof formSchema>

export function LoginForm({ next, syncError }: { next?: string; syncError?: boolean }) {
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [devError, setDevError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<FormValues>()

  async function onSubmit(values: FormValues) {
    setSubmitting(true)
    const parsed = formSchema.safeParse(values)
    if (!parsed.success) {
      setSubmitting(false)
      return
    }
    await requestMagicLink({ email: parsed.data.email, next })
    setSent(true)
    setSubmitting(false)
  }

  async function onDevSignIn() {
    setDevError(null)
    const parsed = formSchema.safeParse(getValues())
    if (!parsed.success) {
      setDevError('Ingresá un email válido arriba.')
      return
    }
    setSubmitting(true)
    const result = await devSignIn({ email: parsed.data.email, next })
    // Si todo fue bien, devSignIn hace redirect() y nunca vuelve.
    setSubmitting(false)
    if (result && !result.ok) {
      setDevError(`Dev sign-in falló: ${result.error}`)
    }
  }

  if (sent) {
    return (
      <div
        className="rounded-md border border-neutral-300 p-4 text-sm text-place-text-soft"
        role="status"
      >
        Te enviamos un link a tu email. Revisá la bandeja y el spam.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {syncError ? (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Hubo un problema al sincronizar tu cuenta. Intentá de nuevo en un momento.
        </div>
      ) : null}
      <label className="block text-sm">
        <span className="mb-1 block text-place-text-soft">Email</span>
        <input
          type="email"
          autoComplete="email"
          autoFocus
          inputMode="email"
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-place-text focus:border-neutral-500 focus:outline-none"
          aria-invalid={errors.email ? true : undefined}
          {...register('email', { required: true })}
        />
        {errors.email ? (
          <span className="mt-1 block text-xs text-amber-700">
            {errors.email.message ?? 'Email inválido'}
          </span>
        ) : null}
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60"
      >
        {submitting ? 'Enviando…' : 'Enviame el link'}
      </button>
      {IS_DEV ? (
        <div className="mt-4 space-y-2 border-t border-dashed border-neutral-300 pt-4">
          <p className="text-xs text-place-text-whisper">
            Dev only · saltea el email y entra directo.
          </p>
          <button
            type="button"
            disabled={submitting}
            onClick={onDevSignIn}
            className="w-full rounded-md border border-neutral-400 px-4 py-2 text-sm text-place-text-soft disabled:opacity-60"
          >
            Entrar sin email (dev)
          </button>
          {devError ? (
            <p role="alert" className="text-xs text-amber-700">
              {devError}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  )
}
