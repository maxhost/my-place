/**
 * Zod schemas del sub-slice `library/contribution` (S1a, 2026-05-12).
 *
 * Validan el input del action `setLibraryCategoryWriteScopeAction`. Forma
 * discriminated union por `kind` — el set de IDs cambia según el
 * discriminator.
 *
 * Cap a 50 entries (defensive, mismo precedente que read scope). Place
 * tiene max 150 miembros, scopes típicos < 20.
 *
 * Ver ADR `docs/decisions/2026-05-12-library-permissions-model.md`.
 */

import { z } from 'zod'

const WRITE_SCOPE_MAX_ENTRIES = 50

const idSchema = z.string().min(1)

/**
 * Discriminated union por `kind`. Cada variante exige sólo el campo de
 * IDs relevante. OWNER_ONLY no tiene set asociado — sólo cambia el
 * discriminator (idéntico al PUBLIC del read scope).
 */
export const setLibraryCategoryWriteScopeInputSchema = z.discriminatedUnion('kind', [
  z.object({
    categoryId: idSchema,
    kind: z.literal('OWNER_ONLY'),
  }),
  z.object({
    categoryId: idSchema,
    kind: z.literal('GROUPS'),
    groupIds: z.array(idSchema).max(WRITE_SCOPE_MAX_ENTRIES),
  }),
  z.object({
    categoryId: idSchema,
    kind: z.literal('TIERS'),
    tierIds: z.array(idSchema).max(WRITE_SCOPE_MAX_ENTRIES),
  }),
  z.object({
    categoryId: idSchema,
    kind: z.literal('USERS'),
    userIds: z.array(idSchema).max(WRITE_SCOPE_MAX_ENTRIES),
  }),
])

export type SetLibraryCategoryWriteScopeInput = z.infer<
  typeof setLibraryCategoryWriteScopeInputSchema
>
