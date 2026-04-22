import { z } from 'zod'

/**
 * Zod schemas del slice `members`. Compartidos por server actions y forms.
 */

export const inviteMemberSchema = z.object({
  placeSlug: z.string().trim().min(1, 'placeSlug requerido.'),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Ingresá un email válido.')
    .max(254, 'Email demasiado largo.'),
  asAdmin: z.boolean().default(false),
})

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const resendInvitationSchema = z.object({
  invitationId: z.string().trim().min(1, 'invitationId requerido.'),
})

export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>
