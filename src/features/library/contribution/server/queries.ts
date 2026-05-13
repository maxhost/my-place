import 'server-only'
import { cache } from 'react'
import { prisma } from '@/db/client'
import type { WriteAccessKind } from '@/features/library/public'

/**
 * Queries del sub-slice `library/contribution` (S1a, 2026-05-12).
 *
 * Sólo este archivo (más actions) toca Prisma. UI/domain consumen via
 * `public.ts` / `public.server.ts`.
 *
 * Ver `docs/decisions/2026-05-12-library-permissions-model.md`.
 */

/**
 * Shape canónico del write scope de una categoría. Aplana la unión "una
 * de 3 tablas" en un único objeto plano: el caller elige qué array usar
 * según `kind`.
 *
 * Para evaluar `canWriteCategory`, el caller construye el
 * `CategoryWriteContext`:
 *
 *   const scope = await findWriteScope(categoryId)
 *   const ctx = scope ? {
 *     writeAccessKind: scope.kind,
 *     groupWriteIds: scope.groupIds,
 *     tierWriteIds: scope.tierIds,
 *     userWriteIds: scope.userIds,
 *   } : null
 */
export type LibraryCategoryWriteScope = {
  kind: WriteAccessKind
  groupIds: ReadonlyArray<string>
  tierIds: ReadonlyArray<string>
  userIds: ReadonlyArray<string>
}

/**
 * Resuelve el write scope completo de una categoría en 1 query con
 * includes (sin N+1). Cacheable por request via `React.cache` — múltiples
 * componentes en el mismo render comparten el resultado.
 *
 * Retorna `null` si la categoría no existe (NotFound es responsabilidad
 * del caller — la query es shape-pura).
 *
 * Las 3 tablas siempre se traen (sin importar `writeAccessKind`) — esto
 * permite al admin previsualizar/editar el set guardado de cualquier
 * tipo sin re-query. El cap del N de scopes (50 entries) hace que el
 * payload extra sea trivial.
 */
export const findWriteScope = cache(
  async (categoryId: string): Promise<LibraryCategoryWriteScope | null> => {
    const row = await prisma.libraryCategory.findUnique({
      where: { id: categoryId },
      select: {
        writeAccessKind: true,
        writeGroupScopes: { select: { groupId: true } },
        writeTierScopes: { select: { tierId: true } },
        writeUserScopes: { select: { userId: true } },
      },
    })
    if (!row) return null
    return {
      kind: row.writeAccessKind,
      groupIds: row.writeGroupScopes.map((s) => s.groupId),
      tierIds: row.writeTierScopes.map((s) => s.tierId),
      userIds: row.writeUserScopes.map((s) => s.userId),
    }
  },
)
