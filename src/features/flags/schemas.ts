/**
 * Zod schemas del slice `flags`. Cubren inputs de las server actions
 * (`flagAction`, `reviewFlagAction`). Reglas de contenido (motivos válidos,
 * límite de nota, estado de decisión) se validan acá por construcción.
 *
 * Ver `docs/features/discussions/spec.md` § 10.
 */

import { z } from 'zod'
import { FLAG_NOTE_MAX_LENGTH } from './domain/invariants'
import { FlagReasonValues } from './domain/types'

const targetKindSchema = z.enum(['POST', 'COMMENT'])

const flagReasonSchema = z.enum([
  FlagReasonValues.SPAM,
  FlagReasonValues.HARASSMENT,
  FlagReasonValues.OFFTOPIC,
  FlagReasonValues.MISINFO,
  FlagReasonValues.OTHER,
])

export const flagInputSchema = z.object({
  targetType: targetKindSchema,
  targetId: z.string().min(1),
  reason: flagReasonSchema,
  reasonNote: z.string().max(FLAG_NOTE_MAX_LENGTH).optional(),
})

export type FlagInput = z.infer<typeof flagInputSchema>

/**
 * Input de `reviewFlagAction`. Extensión sobre el contrato mínimo del spec:
 * `sideEffect` permite combinar, en la misma transacción, el update del flag
 * con hide/delete del target. Reglas:
 *  - `REVIEWED_DISMISSED` no admite sideEffect (por refine).
 *  - `HIDE_TARGET` sobre un `COMMENT` lo rechaza el action en runtime (comments
 *    se eliminan, no se ocultan — spec § 10).
 */
export const reviewFlagInputSchema = z
  .object({
    flagId: z.string().min(1),
    decision: z.enum(['REVIEWED_ACTIONED', 'REVIEWED_DISMISSED']),
    reviewNote: z.string().max(FLAG_NOTE_MAX_LENGTH).optional(),
    sideEffect: z.enum(['HIDE_TARGET', 'DELETE_TARGET']).nullable().default(null),
  })
  .refine((data) => data.decision !== 'REVIEWED_DISMISSED' || data.sideEffect === null, {
    message: 'Una revisión DISMISSED no puede llevar sideEffect.',
    path: ['sideEffect'],
  })

export type ReviewFlagInput = z.infer<typeof reviewFlagInputSchema>
