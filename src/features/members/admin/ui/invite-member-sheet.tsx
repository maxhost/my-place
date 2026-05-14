'use client'

import { useEffect, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import {
  EditPanel,
  EditPanelBody,
  EditPanelClose,
  EditPanelContent,
  EditPanelDescription,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '@/shared/ui/edit-panel'
import { toast } from '@/shared/ui/toaster'
import { isDomainError } from '@/shared/errors/domain-error'
import { inviteMemberSchema } from '@/features/members/schemas'
import { inviteMemberAction } from '@/features/members/invitations/public'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  placeSlug: string
  /** Si el viewer es owner, habilita el checkbox "Invitar como admin". */
  canInviteAsAdmin: boolean
}

type FormValues = {
  email: string
  asAdmin: boolean
}

/**
 * EditPanel con form de invitación. Mirror estructural del
 * `<TierFormSheet>` / `<GroupFormSheet>`. Submit dispara
 * `inviteMemberAction` (gateado server-side: actor debe ser owner o admin
 * del place).
 *
 * El checkbox "Invitar como admin" solo se muestra a owners (decisión #2
 * ADR PermissionGroups: solo owner puede invitar como admin). La invitación
 * `asOwner=true` queda fuera de scope del admin de members — vive en
 * `/settings/access` específicamente para ownership.
 *
 * Sin field errors inline complejos — confiamos en Zod del schema canónico
 * y mapeamos errores domain a toast (mismo patrón que `<InviteMemberForm>`
 * legacy en `invitations/ui/invite-form.tsx`).
 */
export function InviteMemberSheet({
  open,
  onOpenChange,
  placeSlug,
  canInviteAsAdmin,
}: Props): React.ReactNode {
  const [pending, startTransition] = useTransition()
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const { register, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { email: '', asAdmin: false },
  })

  useEffect(() => {
    if (!open) {
      reset({ email: '', asAdmin: false })
      setFieldErrors({})
    }
  }, [open, reset])

  function onSubmit(values: FormValues): void {
    setFieldErrors({})
    const parsed = inviteMemberSchema.safeParse({
      placeSlug,
      email: values.email,
      asAdmin: canInviteAsAdmin ? values.asAdmin : false,
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
        toast.success('Invitación enviada.')
        onOpenChange(false)
      } catch (err) {
        toast.error(friendlyMessage(err))
      }
    })
  }

  return (
    <EditPanel open={open} onOpenChange={onOpenChange}>
      <EditPanelContent>
        <EditPanelHeader>
          <EditPanelTitle>Invitar miembro</EditPanelTitle>
          <EditPanelDescription>
            Mandamos un email con un magic link. La invitación expira en 7 días.
          </EditPanelDescription>
        </EditPanelHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
          <EditPanelBody>
            <div className="space-y-4 py-2">
              <label className="block">
                <span className="mb-1 block text-sm text-neutral-600">Email</span>
                <input
                  type="email"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
                  aria-invalid={fieldErrors.email ? true : undefined}
                  placeholder="nombre@ejemplo.com"
                  {...register('email', { required: true })}
                />
                {fieldErrors.email ? (
                  <span role="alert" className="mt-1 block text-xs text-amber-700">
                    {fieldErrors.email}
                  </span>
                ) : null}
              </label>

              {canInviteAsAdmin ? (
                <label className="flex min-h-11 items-start gap-2 text-sm text-neutral-700">
                  <input type="checkbox" className="mt-1.5" {...register('asAdmin')} />
                  <span>
                    Invitar como admin — podrá invitar otros miembros y editar configuración del
                    place.
                  </span>
                </label>
              ) : null}
            </div>
          </EditPanelBody>

          <EditPanelFooter>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? 'Enviando…' : 'Invitar'}
            </button>
            <EditPanelClose asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm disabled:opacity-60"
              >
                Cancelar
              </button>
            </EditPanelClose>
          </EditPanelFooter>
        </form>
      </EditPanelContent>
    </EditPanel>
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
        return 'No pudimos generar el link de invitación. Quedó pendiente — reintentá desde la lista de invitaciones.'
      case 'INVITATION_EMAIL_FAILED':
        return 'No pudimos enviar el email. La invitación quedó guardada — reintentá desde la lista.'
      default:
        return 'No se pudo enviar la invitación.'
    }
  }
  return 'Error inesperado. Intentá de nuevo.'
}
