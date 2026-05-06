import 'server-only'
import { Prisma } from '@prisma/client'
import { ConflictError } from '@/shared/errors/domain-error'
import { logger } from '@/shared/lib/logger'
import { resolveUniqueSlug } from './shared'

/**
 * Crea un Post bajo un cliente Prisma transaccional.
 *
 * Pensado para que otro slice (ej: `events` en F.E) pueda crear el thread
 * asociado dentro de la **misma `prisma.$transaction`** que crea el objeto
 * raíz, garantizando atomicidad: si una de las operaciones falla, ambas
 * rollbackean sin dejar Posts huérfanos ni Events sin thread.
 *
 * Diferencias con `createPostAction`:
 *  - Acepta `tx` client (no usa el singleton `prisma`).
 *  - **No** llama `assertPlaceOpenOrThrow` — el caller (action de evento)
 *    ya gateó antes de abrir la tx. Bypass intencional.
 *  - **No** llama `revalidatePath` — la action caller revalida sus rutas
 *    + las del thread al cerrar la tx.
 *  - Loguea como `postCreatedFromSystem` con `originSystem` + ID del objeto
 *    origen para audit.
 *
 * Slug: reusa `resolveUniqueSlug` parametrizado por client. Ante `P2002` por
 * colisión de slug, reintenta una vez con colisiones recalculadas; segundo
 * fallo ⇒ `ConflictError` (la tx caller decide si rollbackear o reintentar).
 *
 * Ver `docs/features/events/spec-integrations.md § 1.2` (PR-1).
 */

export type CreatePostFromSystemInput = {
  placeId: string
  title: string
  body: Prisma.InputJsonValue
  authorUserId: string
  authorSnapshot: Prisma.InputJsonValue
  /** Discriminador para logging.
   *  - `'event'`: auto-thread de eventos (F.E).
   *  - `'library_item'`: thread documento de un item de biblioteca (R.7.6). */
  originSystem: 'event' | 'library_item'
  /** ID del objeto origen (eventId, libraryItemId, etc.) para audit. */
  originId: string
}

export async function createPostFromSystemHelper(
  tx: Prisma.TransactionClient,
  input: CreatePostFromSystemInput,
): Promise<{ id: string; slug: string }> {
  // stub F.1: validación de tamaño rich-text se reintroduce en F.2 con Lexical AST.

  const trimmedTitle = input.title.trim()
  const now = new Date()

  const created = await attemptCreateUnderTx(tx, input, trimmedTitle, now).catch(async (err) => {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      throw err
    }
    // Retry once con set fresco de colisiones.
    try {
      return await attemptCreateUnderTx(tx, input, trimmedTitle, now)
    } catch (retryErr) {
      if (retryErr instanceof Prisma.PrismaClientKnownRequestError && retryErr.code === 'P2002') {
        throw new ConflictError('No pudimos asignar una URL única para el thread del evento.', {
          placeId: input.placeId,
          title: trimmedTitle,
          originSystem: input.originSystem,
          originId: input.originId,
        })
      }
      throw retryErr
    }
  })

  logger.info(
    {
      event: 'postCreatedFromSystem',
      placeId: input.placeId,
      postId: created.id,
      postSlug: created.slug,
      authorUserId: input.authorUserId,
      originSystem: input.originSystem,
      originId: input.originId,
    },
    'post created from system origin',
  )

  return created
}

async function attemptCreateUnderTx(
  tx: Prisma.TransactionClient,
  input: CreatePostFromSystemInput,
  trimmedTitle: string,
  now: Date,
): Promise<{ id: string; slug: string }> {
  const slug = await resolveUniqueSlug(input.placeId, trimmedTitle, tx)
  return tx.post.create({
    data: {
      placeId: input.placeId,
      authorUserId: input.authorUserId,
      authorSnapshot: input.authorSnapshot,
      title: trimmedTitle,
      slug,
      body: input.body,
      lastActivityAt: now,
    },
    select: { id: true, slug: true },
  })
}
