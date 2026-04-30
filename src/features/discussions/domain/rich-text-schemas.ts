/**
 * Zod schemas del TipTap JSON AST usado como `body` de Post y Comment.
 *
 * Vive bajo `domain/` porque son tipos puros del dominio (sin DB, sin React).
 * Los helpers numéricos (`richTextByteSize`, `richTextMaxListDepth`) viven
 * en `domain/rich-text.ts` — esto es su counterpart de validación estructural.
 *
 * Reglas:
 *  - El schema rechaza **por construcción** cualquier nodo fuera de la allowlist.
 *  - Links: sólo `https:` y `mailto:`; attrs fijos `target="_blank"` y
 *    `rel="noopener noreferrer"` (inyectados por el cliente TipTap; si no
 *    coinciden, el parse falla).
 *  - Heading: niveles 2 y 3. Sin h1 (el título del Post ocupa ese lugar).
 *  - Size cap (20 KB) y depth cap (listas anidadas ≤ 5) se enforzan con
 *    `superRefine` y delegan en helpers puros de `rich-text.ts`.
 *  - Mention validation server-side (userId es miembro activo) NO vive acá —
 *    requiere DB; se enforza en la action.
 *
 * Ver `docs/features/discussions/spec.md` § 14.
 */

import { z } from 'zod'
import {
  RICH_TEXT_MAX_BYTES,
  RICH_TEXT_MAX_LIST_DEPTH,
  richTextByteSize,
  richTextMaxListDepth,
} from './rich-text'
import type { RichTextDocument } from './types'

// ---------------------------------------------------------------
// Marks
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
// Inline nodes
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
// Block nodes (recursivo vía z.lazy)
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
    embedNodeSchema,
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

// Embed: block atomic genérico para insertar contenido externo (videos,
// docs, links). Es block genérico de TipTap, no específico de un slice
// — library lo usa hoy, pero discusiones u otros podrían sumarlo en el
// futuro sin tocar este schema. Las reglas de provider/host viven en
// `library/domain/embed-parser.ts`; acá solo validamos shape estructural
// + URL https.
const embedNodeSchema = z
  .object({
    type: z.literal('embed'),
    attrs: z
      .object({
        url: allowedUrlSchema,
        provider: z.enum(['youtube', 'vimeo', 'gdoc', 'gsheet', 'drive', 'dropbox', 'generic']),
        title: z.string().max(160).optional().default(''),
      })
      .strict(),
  })
  .strict()

// ---------------------------------------------------------------
// Documento + refinements cap
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
