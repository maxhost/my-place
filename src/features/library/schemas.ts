/**
 * Zod schemas de input de server actions del slice `library` (R.7.2).
 *
 * Validan la forma del input que viene del cliente. Las reglas de
 * negocio (cap, slug format, etc.) viven en `domain/invariants.ts` —
 * acá solo validación estructural: tipos + length caps.
 *
 * Ver `docs/features/library/spec.md` § 10 + § 11.
 */

import { z } from 'zod'
import {
  CATEGORY_EMOJI_MAX_LENGTH,
  CATEGORY_EMOJI_MIN_LENGTH,
  CATEGORY_TITLE_MAX_LENGTH,
  CATEGORY_TITLE_MIN_LENGTH,
} from './domain/invariants'
import { CONTRIBUTION_POLICY_VALUES } from './domain/types'

// ---------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------

const titleSchema = z
  .string()
  .min(CATEGORY_TITLE_MIN_LENGTH)
  .max(CATEGORY_TITLE_MAX_LENGTH)
  .refine((s) => s.trim().length >= CATEGORY_TITLE_MIN_LENGTH, {
    message: 'El título no puede estar vacío después de quitar espacios.',
  })

const emojiSchema = z.string().min(CATEGORY_EMOJI_MIN_LENGTH).max(CATEGORY_EMOJI_MAX_LENGTH)

const contributionPolicySchema = z.enum([
  'ADMIN_ONLY',
  'DESIGNATED',
  'MEMBERS_OPEN',
] as const satisfies readonly (typeof CONTRIBUTION_POLICY_VALUES)[number][])

// ---------------------------------------------------------------
// Inputs por action
// ---------------------------------------------------------------

export const createCategoryInputSchema = z.object({
  placeId: z.string().min(1),
  emoji: emojiSchema,
  title: titleSchema,
  contributionPolicy: contributionPolicySchema.optional().default('ADMIN_ONLY'),
})
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>

export const updateCategoryInputSchema = z.object({
  categoryId: z.string().min(1),
  emoji: emojiSchema,
  title: titleSchema,
  contributionPolicy: contributionPolicySchema,
})
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>

export const archiveCategoryInputSchema = z.object({
  categoryId: z.string().min(1),
})
export type ArchiveCategoryInput = z.infer<typeof archiveCategoryInputSchema>

export const reorderCategoriesInputSchema = z.object({
  placeId: z.string().min(1),
  /** Orden deseado: lista de categoryIds en la posición visual final.
   *  El index del array es la posición. La action hace UPDATE en una
   *  tx por idempotencia. */
  orderedCategoryIds: z.array(z.string().min(1)).min(1).max(50),
})
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesInputSchema>

// ---------------------------------------------------------------
// Contributors (R.7.4)
// ---------------------------------------------------------------

export const inviteContributorInputSchema = z.object({
  categoryId: z.string().min(1),
  userId: z.string().min(1),
})
export type InviteContributorInput = z.infer<typeof inviteContributorInputSchema>

export const removeContributorInputSchema = z.object({
  categoryId: z.string().min(1),
  userId: z.string().min(1),
})
export type RemoveContributorInput = z.infer<typeof removeContributorInputSchema>
