/**
 * Zod schemas del slice `discussions`. Cubren:
 *  - El TipTap JSON AST completo con allowlist estricta de nodos y marks.
 *  - Input de todas las server actions de Fase 5 (create, edit, react, flag, etc).
 *
 * Reglas:
 *  - El schema rechaza **por construcción** cualquier nodo fuera de la allowlist.
 *  - Links: sólo `https:` y `mailto:`; attrs fijos `target="_blank"` y
 *    `rel="noopener noreferrer"` (inyectados por el cliente TipTap; si no
 *    coinciden, el parse falla).
 *  - Heading: niveles 2 y 3. Sin h1 (el título del Post ocupa ese lugar).
 *  - Size cap (20 KB) y depth cap (listas anidadas ≤ 5) se enforzan con
 *    `superRefine` y delegan en helpers puros de `domain/rich-text.ts`.
 *  - Mention validation server-side (userId es miembro activo) NO vive acá —
 *    requiere DB; se enforza en la action.
 *
 * Ver `docs/features/discussions/spec.md` § 14 (rich text) y § 4 (shape).
 */

import { z } from 'zod'
import {
  POST_TITLE_MAX_LENGTH,
  POST_TITLE_MIN_LENGTH,
  REACTION_EMOJI_DISPLAY,
} from './domain/invariants'
import {
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_LIST_DEPTH,
  richTextByteSize,
  richTextMaxListDepth,
} from './domain/rich-text'
import type { RichTextDocument } from './domain/types'

// ---------------------------------------------------------------
// Rich text: marks
// ---------------------------------------------------------------

const boldMarkSchema = z.object({ type: z.literal('bold') }).strict()
const italicMarkSchema = z.object({ type: z.literal('italic') }).strict()
const codeMarkSchema = z.object({ type: z.literal('code') }).strict()

/** URL allowlist: sólo `https:` y `mailto:`. Cualquier otro protocolo rechaza. */
const allowedUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'https:' || url.protocol === 'mailto:'
      } catch {
        return false
      }
    },
    { message: 'URL debe usar protocolo https: o mailto:.' },
  )

const linkMarkSchema = z
  .object({
    type: z.literal('link'),
    attrs: z
      .object({
        href: allowedUrlSchema,
        target: z.literal('_blank'),
        rel: z.literal('noopener noreferrer'),
      })
      .strict(),
  })
  .strict()

const richTextMarkSchema = z.discriminatedUnion('type', [
  boldMarkSchema,
  italicMarkSchema,
  codeMarkSchema,
  linkMarkSchema,
])

// ---------------------------------------------------------------
// Rich text: inline nodes
// ---------------------------------------------------------------

const textNodeSchema = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1),
    marks: z.array(richTextMarkSchema).max(8).optional(),
  })
  .strict()

const mentionNodeSchema = z
  .object({
    type: z.literal('mention'),
    attrs: z
      .object({
        userId: z.string().min(1).max(64),
        label: z.string().min(1).max(80),
      })
      .strict(),
  })
  .strict()

const richTextInlineNodeSchema = z.discriminatedUnion('type', [textNodeSchema, mentionNodeSchema])

// Text-only node (para codeBlock: sin marks ni mentions).
const codeBlockTextNodeSchema = z
  .object({ type: z.literal('text'), text: z.string().min(1) })
  .strict()

// ---------------------------------------------------------------
// Rich text: block nodes (recursivo vía z.lazy)
// ---------------------------------------------------------------

type RichTextBlockZ = z.ZodType

const richTextBlockNodeSchema: RichTextBlockZ = z.lazy(() =>
  z.discriminatedUnion('type', [
    paragraphSchema,
    headingSchema,
    bulletListSchema,
    orderedListSchema,
    blockquoteSchema,
    codeBlockSchema,
  ]),
)

const paragraphSchema = z
  .object({
    type: z.literal('paragraph'),
    content: z.array(richTextInlineNodeSchema).max(512).optional(),
  })
  .strict()

const headingSchema = z
  .object({
    type: z.literal('heading'),
    attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }).strict(),
    content: z.array(richTextInlineNodeSchema).max(512).optional(),
  })
  .strict()

const listItemSchema = z
  .object({
    type: z.literal('listItem'),
    content: z.array(richTextBlockNodeSchema).min(1).max(64),
  })
  .strict()

const bulletListSchema = z
  .object({
    type: z.literal('bulletList'),
    content: z.array(listItemSchema).min(1).max(128),
  })
  .strict()

const orderedListSchema = z
  .object({
    type: z.literal('orderedList'),
    content: z.array(listItemSchema).min(1).max(128),
  })
  .strict()

const blockquoteSchema = z
  .object({
    type: z.literal('blockquote'),
    content: z.array(richTextBlockNodeSchema).min(1).max(32),
  })
  .strict()

const codeBlockSchema = z
  .object({
    type: z.literal('codeBlock'),
    content: z.array(codeBlockTextNodeSchema).max(128).optional(),
  })
  .strict()

// ---------------------------------------------------------------
// Rich text: documento + refinements cap
// ---------------------------------------------------------------

export const richTextDocumentSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(richTextBlockNodeSchema).min(1).max(256),
  })
  .strict()
  .superRefine((doc, ctx) => {
    const bytes = richTextByteSize(doc)
    if (bytes > RICH_TEXT_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Body supera el límite de ${RICH_TEXT_MAX_BYTES} bytes (actual: ${bytes}).`,
        params: { bytes, maxBytes: RICH_TEXT_MAX_BYTES, kind: 'size' },
      })
    }
    const depth = richTextMaxListDepth(doc as RichTextDocument)
    if (depth > RICH_TEXT_MAX_LIST_DEPTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Listas anidadas exceden la profundidad máxima (${RICH_TEXT_MAX_LIST_DEPTH}).`,
        params: { depth, maxDepth: RICH_TEXT_MAX_LIST_DEPTH, kind: 'depth' },
      })
    }
  })

export type RichTextDocumentParsed = z.infer<typeof richTextDocumentSchema>

// ---------------------------------------------------------------
// Inputs de server actions
// ---------------------------------------------------------------

const postTitleSchema = z
  .string()
  .min(POST_TITLE_MIN_LENGTH)
  .max(POST_TITLE_MAX_LENGTH)
  .refine((s) => s.trim().length > 0, {
    message: 'El título no puede ser sólo espacios.',
  })

export const createPostInputSchema = z.object({
  placeId: z.string().min(1),
  title: postTitleSchema,
  body: richTextDocumentSchema.nullable().optional(),
})

export type CreatePostInput = z.infer<typeof createPostInputSchema>

export const createCommentInputSchema = z.object({
  postId: z.string().min(1),
  body: richTextDocumentSchema,
  quotedCommentId: z.string().min(1).nullable().optional(),
})

export type CreateCommentInput = z.infer<typeof createCommentInputSchema>

/**
 * Edit-session token emitido por `openPostEditSession` / `openCommentEditSession`.
 * Sólo exigido a non-admins. Ver `shared/lib/edit-session-token.ts` +
 * `docs/decisions/2026-04-21-edit-session-token.md`.
 */
const editSessionSchema = z.object({
  token: z.string().min(1),
  openedAt: z.string().datetime(),
})

export const editPostInputSchema = z.object({
  postId: z.string().min(1),
  title: postTitleSchema,
  body: richTextDocumentSchema.nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
  session: editSessionSchema.optional(),
})

export type EditPostInput = z.infer<typeof editPostInputSchema>

export const editCommentInputSchema = z.object({
  commentId: z.string().min(1),
  body: richTextDocumentSchema,
  expectedVersion: z.number().int().nonnegative(),
  session: editSessionSchema.optional(),
})

export type EditCommentInput = z.infer<typeof editCommentInputSchema>

export const openPostEditSessionInputSchema = z.object({
  postId: z.string().min(1),
})

export type OpenPostEditSessionInput = z.infer<typeof openPostEditSessionInputSchema>

export const openCommentEditSessionInputSchema = z.object({
  commentId: z.string().min(1),
})

export type OpenCommentEditSessionInput = z.infer<typeof openCommentEditSessionInputSchema>

const targetKindSchema = z.enum(['POST', 'COMMENT'])
const reactionEmojiSchema = z.enum(REACTION_EMOJI_DISPLAY)

export const reactInputSchema = z.object({
  targetType: targetKindSchema,
  targetId: z.string().min(1),
  emoji: reactionEmojiSchema,
})

export type ReactInput = z.infer<typeof reactInputSchema>

export const unreactInputSchema = z.object({
  targetType: targetKindSchema,
  targetId: z.string().min(1),
  emoji: reactionEmojiSchema,
})

export type UnreactInput = z.infer<typeof unreactInputSchema>

export const hidePostInputSchema = z.object({
  postId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
})

export type HidePostInput = z.infer<typeof hidePostInputSchema>

export const unhidePostInputSchema = hidePostInputSchema
export type UnhidePostInput = HidePostInput

export const deletePostInputSchema = z.object({
  postId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
})

export type DeletePostInput = z.infer<typeof deletePostInputSchema>

export const deleteCommentInputSchema = z.object({
  commentId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
})

export type DeleteCommentInput = z.infer<typeof deleteCommentInputSchema>

export const markPostReadInputSchema = z.object({
  postId: z.string().min(1),
  dwellMs: z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000),
})

export type MarkPostReadInput = z.infer<typeof markPostReadInputSchema>
