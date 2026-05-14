import { z } from 'zod'

/**
 * Zod schemas del slice `members`. Compartidos por server actions y forms.
 */

// ---------------------------------------------------------------
// Constants — límites de texto libre en moderación.
// Fuente canónica: `docs/features/groups/spec.md` § "Schemas Zod"
// + columnas Prisma `Membership.{blockedReason,expelReason}` (`@db.VarChar(500)`).
// Los textareas UI (`block-member-dialog`, `expel-member-dialog`) usan estas
// constants como `maxLength` — mantener sincronizado.
// ---------------------------------------------------------------
export const BLOCK_MEMBER_REASON_MAX_LENGTH = 500
export const UNBLOCK_MEMBER_MESSAGE_MAX_LENGTH = 500
export const EXPEL_MEMBER_REASON_MAX_LENGTH = 500

// ---------------------------------------------------------------
// Invitar miembro
// ---------------------------------------------------------------
export const inviteMemberSchema = z
  .object({
    placeSlug: z.string().trim().min(1, 'placeSlug requerido.'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Ingresá un email válido.')
      .max(254, 'Email demasiado largo.'),
    // `asOwner=true` requiere owner-only en el server action (`invite.ts`) y
    // dispara la creación de PlaceOwnership al aceptar (`accept.ts`).
    asOwner: z.boolean().default(false),
    // `asAdmin=true` también es owner-only (decisión #2 ADR PermissionGroups);
    // suma GroupMembership al preset Administradores en el accept tx.
    asAdmin: z.boolean().default(false),
  })
  // `asOwner` ⇒ Owner del place ⇒ ya implica acceso completo via PlaceOwnership.
  // No tiene sentido invitar a alguien como owner Y como admin a la vez. Si
  // ambos vienen `true`, es input mal formado — fail-fast con ValidationError
  // en el caller. (Owner ya pertenece al preset admin operativamente; agregar
  // `asAdmin` es ruido o un error de UI.)
  .refine((d) => !(d.asAdmin && d.asOwner), {
    message: 'asAdmin y asOwner son mutuamente excluyentes.',
    path: ['asAdmin'],
  })

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>

export const resendInvitationSchema = z.object({
  invitationId: z.string().trim().min(1, 'invitationId requerido.'),
})

export type ResendInvitationInput = z.infer<typeof resendInvitationSchema>

export const revokeInvitationSchema = z.object({
  invitationId: z.string().trim().min(1, 'invitationId requerido.'),
})

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>

// ---------------------------------------------------------------
// Aceptar invitación — token base64url (43 chars desde 32 bytes random;
// ver `members/domain/invariants.ts` § generateInvitationToken).
// El schema NO chequea longitud exacta (defensivo: futuras rotaciones de
// `INVITATION_TOKEN_BYTES` no rompen el parser); valida que sea un string
// no-vacío base64url-safe.
// ---------------------------------------------------------------
export const acceptInvitationTokenSchema = z
  .string()
  .trim()
  .min(1, 'Token requerido.')
  .max(512, 'Token demasiado largo.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Token con formato inválido.')

export type AcceptInvitationToken = z.infer<typeof acceptInvitationTokenSchema>

// ---------------------------------------------------------------
// Salir del place — el action recibe el slug suelto (no un objeto).
// ---------------------------------------------------------------
export const leaveMembershipPlaceSlugSchema = z.string().trim().min(1, 'Slug del place requerido.')

export type LeaveMembershipPlaceSlug = z.infer<typeof leaveMembershipPlaceSlugSchema>

// ---------------------------------------------------------------
// Moderación: block / unblock / expel.
// Shape derivado de los callers (`{block,unblock,expel}-member.ts`) — usan
// `placeId` + `memberUserId` (no slug + userId). `contactEmail` es required:
// el dialog UI lo precarga con el email del actor pero permite editarlo.
// `reason` (block/expel) es required no-vacío; `message` (unblock) es opcional.
// Spec: `docs/features/groups/spec.md` § "Schemas Zod" + § 12.
// ---------------------------------------------------------------
export const blockMemberInputSchema = z.object({
  placeId: z.string().trim().min(1, 'placeId requerido.'),
  memberUserId: z.string().trim().min(1, 'memberUserId requerido.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Motivo requerido.')
    .max(BLOCK_MEMBER_REASON_MAX_LENGTH, 'Motivo demasiado largo.'),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email de contacto inválido.')
    .max(254, 'Email demasiado largo.'),
})

export type BlockMemberInput = z.infer<typeof blockMemberInputSchema>

export const unblockMemberInputSchema = z.object({
  placeId: z.string().trim().min(1, 'placeId requerido.'),
  memberUserId: z.string().trim().min(1, 'memberUserId requerido.'),
  message: z
    .string()
    .trim()
    .max(UNBLOCK_MEMBER_MESSAGE_MAX_LENGTH, 'Mensaje demasiado largo.')
    .optional(),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email de contacto inválido.')
    .max(254, 'Email demasiado largo.'),
})

export type UnblockMemberInput = z.infer<typeof unblockMemberInputSchema>

export const expelMemberInputSchema = z.object({
  placeId: z.string().trim().min(1, 'placeId requerido.'),
  memberUserId: z.string().trim().min(1, 'memberUserId requerido.'),
  reason: z
    .string()
    .trim()
    .min(1, 'Motivo requerido.')
    .max(EXPEL_MEMBER_REASON_MAX_LENGTH, 'Motivo demasiado largo.'),
  contactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email('Email de contacto inválido.')
    .max(254, 'Email demasiado largo.'),
})

export type ExpelMemberInput = z.infer<typeof expelMemberInputSchema>

// ---------------------------------------------------------------
// Directory query params — para `/settings/members` (search + paginación).
// `tab` discrimina entre listado de activos y de invitaciones pendientes.
// `q` busca por displayName+handle en active; por email en pending.
// `page` 1-based para que el URL sea legible. `limit` con cap defensivo.
// ---------------------------------------------------------------
export const DIRECTORY_LIMIT_DEFAULT = 20
export const DIRECTORY_LIMIT_MAX = 50
export const DIRECTORY_QUERY_MAX_LENGTH = 100

export const directoryQueryParamsSchema = z.object({
  tab: z.enum(['active', 'pending']).default('active'),
  q: z.string().trim().max(DIRECTORY_QUERY_MAX_LENGTH, 'Búsqueda demasiado larga.').default(''),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(DIRECTORY_LIMIT_MAX).default(DIRECTORY_LIMIT_DEFAULT),
})

export type DirectoryQueryParams = z.infer<typeof directoryQueryParamsSchema>
