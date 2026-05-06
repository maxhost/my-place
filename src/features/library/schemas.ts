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
import { POST_TITLE_MAX_LENGTH, POST_TITLE_MIN_LENGTH } from '@/features/discussions/public'
import {
  CATEGORY_EMOJI_MAX_LENGTH,
  CATEGORY_EMOJI_MIN_LENGTH,
  CATEGORY_TITLE_MAX_LENGTH,
  CATEGORY_TITLE_MIN_LENGTH,
  ITEM_COVER_URL_MAX_LENGTH,
} from './domain/invariants'
import { CONTRIBUTION_POLICY_VALUES, LIBRARY_CATEGORY_KIND_VALUES } from './domain/types'

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
  'DESIGNATED',
  'MEMBERS_OPEN',
  'SELECTED_GROUPS',
] as const satisfies readonly (typeof CONTRIBUTION_POLICY_VALUES)[number][])

const categoryKindSchema = z.enum([
  'GENERAL',
  'COURSE',
] as const satisfies readonly (typeof LIBRARY_CATEGORY_KIND_VALUES)[number][])

// ---------------------------------------------------------------
// Inputs por action
// ---------------------------------------------------------------

export const createCategoryInputSchema = z.object({
  placeId: z.string().min(1),
  emoji: emojiSchema,
  title: titleSchema,
  contributionPolicy: contributionPolicySchema.optional().default('MEMBERS_OPEN'),
  /** G.5+6.b (2026-05-04): GENERAL = lista plana, COURSE = wizard prereqs. */
  kind: categoryKindSchema.optional().default('GENERAL'),
})
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>

export const updateCategoryInputSchema = z.object({
  categoryId: z.string().min(1),
  emoji: emojiSchema,
  title: titleSchema,
  contributionPolicy: contributionPolicySchema,
  kind: categoryKindSchema.optional(),
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

/**
 * Override completo del scope de grupos de una categoría library.
 * Pasar `groupIds: []` deja la categoría sin grupos asignados.
 *
 * Cap `.max(50)` consistente con `reorderCategoriesInputSchema` —
 * 50 grupos es muy por encima del uso esperado (un place típico
 * tiene 2-5 grupos) y protege contra payloads abusivos. La validación
 * de pertenencia al place se hace en la action.
 */
export const setLibraryCategoryGroupScopeInputSchema = z.object({
  categoryId: z.string().min(1),
  groupIds: z.array(z.string().min(1)).max(50),
})
export type SetLibraryCategoryGroupScopeInput = z.infer<
  typeof setLibraryCategoryGroupScopeInputSchema
>

/**
 * Override completo de la lista de contribuidores designados de una
 * categoría. Pasar `userIds: []` deja la categoría sin contribuidores.
 *
 * Cap `.max(150)` alineado con el invariante `MAX_MEMBERS_PER_PLACE`:
 * jamás puede haber más users designados que miembros activos del
 * place. La validación de membership se hace en la action.
 */
export const setLibraryCategoryDesignatedContributorsInputSchema = z.object({
  categoryId: z.string().min(1),
  userIds: z.array(z.string().min(1)).max(150),
})
export type SetLibraryCategoryDesignatedContributorsInput = z.infer<
  typeof setLibraryCategoryDesignatedContributorsInputSchema
>

// ---------------------------------------------------------------
// Items (R.7.6)
// ---------------------------------------------------------------

const itemTitleSchema = z
  .string()
  .min(POST_TITLE_MIN_LENGTH)
  .max(POST_TITLE_MAX_LENGTH)
  .refine((s) => s.trim().length >= POST_TITLE_MIN_LENGTH, {
    message: 'El título no puede estar vacío después de quitar espacios.',
  })

const coverUrlSchema = z.string().max(ITEM_COVER_URL_MAX_LENGTH).nullable().optional()

export const createItemInputSchema = z.object({
  placeId: z.string().min(1),
  categoryId: z.string().min(1),
  title: itemTitleSchema,
  // stub F.1, re-apretar a richTextDocumentSchema en F.2
  body: z.unknown(),
  coverUrl: coverUrlSchema,
})
export type CreateItemInput = z.infer<typeof createItemInputSchema>

export const updateItemInputSchema = z.object({
  itemId: z.string().min(1),
  title: itemTitleSchema,
  // stub F.1, re-apretar a richTextDocumentSchema en F.2
  body: z.unknown(),
  coverUrl: coverUrlSchema,
  /** Versión del Post al momento de abrir el editor (optimistic locking).
   *  Si otro editor pisó el item entremedio, `updateMany` matchea 0 filas
   *  → ConflictError. Ver `update-item.ts`. */
  expectedVersion: z.number().int().min(0),
})
export type UpdateItemInput = z.infer<typeof updateItemInputSchema>

export const archiveItemInputSchema = z.object({
  itemId: z.string().min(1),
})
export type ArchiveItemInput = z.infer<typeof archiveItemInputSchema>
