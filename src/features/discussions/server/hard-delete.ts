import 'server-only'
import { prisma } from '@/db/client'

/**
 * Hard delete de un Post en una sola transacción.
 *
 * La fila de `Post` desaparece y con ella CASCADE las de `Comment` y
 * `PostRead` (FK onDelete: Cascade desde C.G.1). `Reaction` y `Flag` son
 * polimórficos — no tienen FK a Post/Comment — así que se limpian a mano
 * dentro de la misma tx, tanto para el POST como para cada COMMENT hijo.
 *
 * Exportado via `public.ts` para que `features/flags/server/actions.ts`
 * pueda reutilizarlo cuando admin resuelve un flag con `sideEffect`
 * `DELETE_TARGET` sobre un POST. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §3.
 */
export async function hardDeletePost(postId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const comments = await tx.comment.findMany({
      where: { postId },
      select: { id: true },
    })
    const commentIds = comments.map((c) => c.id)
    const targets = [
      { targetType: 'POST' as const, targetId: postId },
      ...commentIds.map((id) => ({
        targetType: 'COMMENT' as const,
        targetId: id,
      })),
    ]
    await tx.reaction.deleteMany({ where: { OR: targets } })
    await tx.flag.deleteMany({ where: { OR: targets } })
    await tx.post.delete({ where: { id: postId } })
  })
}
