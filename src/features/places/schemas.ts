import { z } from 'zod'
import { BillingMode } from '@prisma/client'
import { SLUG_MIN, SLUG_MAX, SLUG_REGEX } from './domain/invariants'

/**
 * Zod schemas del slice `places`.
 * Compartidos por server actions (validación autoritativa) y forms (UX local).
 */

export const billingModeSchema = z.nativeEnum(BillingMode)

export const slugSchema = z
  .string()
  .min(SLUG_MIN, `Mínimo ${SLUG_MIN} caracteres.`)
  .max(SLUG_MAX, `Máximo ${SLUG_MAX} caracteres.`)
  .regex(SLUG_REGEX, 'Solo minúsculas, dígitos y guiones.')
  .refine((s) => !s.startsWith('-') && !s.endsWith('-'), 'No puede empezar ni terminar con guion.')
  .refine((s) => !s.includes('--'), 'No puede contener guiones consecutivos.')

export const createPlaceSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1, 'Campo requerido.').max(80, 'Máximo 80 caracteres.'),
  description: z
    .string()
    .trim()
    .max(280, 'Máximo 280 caracteres.')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  billingMode: billingModeSchema,
})

export type CreatePlaceInput = z.infer<typeof createPlaceSchema>

export const transferOwnershipSchema = z.object({
  placeSlug: z.string().trim().min(1),
  toUserId: z.string().trim().min(1),
  removeActor: z.boolean().default(false),
})

export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>
