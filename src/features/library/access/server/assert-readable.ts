import 'server-only'
import { AuthorizationError, NotFoundError } from '@/shared/errors/domain-error'
import type { LibraryViewer } from '@/features/library/public'
import { canWriteCategory } from '@/features/library/contribution/public'
import { findWriteScope } from '@/features/library/contribution/public.server'
import { canReadCategory } from '../domain/permissions'
import { findReadScope } from './queries'

/**
 * Gate de LECTURA de categoría — punto único de verdad para todos los
 * call-sites que sirven contenido de biblioteca (Plan A, Hallazgo #2).
 *
 * Regla (decisión B del plan): `canReadCategory || canWriteCategory`.
 * El write implica read — un contributor con write-scope que NO está en
 * el read-scope NO debe perder lectura de la categoría donde escribe
 * (el ADR 2026-05-12 delega esta implicación "al composer"; acá la
 * centralizamos para evitar drift entre los ~10 call-sites).
 *
 * Owner y PUBLIC ya short-circuitean dentro de `canReadCategory`. Admin
 * NO-owner NO bypassa lectura restringida (decisión ADR 2026-05-04).
 *
 * `findReadScope`/`findWriteScope` están `React.cache`-wrapped → llamarlo
 * en varios puntos del mismo render no recarga.
 */
type Access = 'ok' | 'denied' | 'not-found'

async function resolveAccess(categoryId: string, viewer: LibraryViewer): Promise<Access> {
  const readScope = await findReadScope(categoryId)
  if (!readScope) return 'not-found'

  const canRead = canReadCategory(
    {
      readAccessKind: readScope.kind,
      groupReadIds: readScope.groupIds,
      tierReadIds: readScope.tierIds,
      userReadIds: readScope.userIds,
    },
    viewer,
  )
  if (canRead) return 'ok'

  const writeScope = await findWriteScope(categoryId)
  if (
    writeScope &&
    canWriteCategory(
      {
        writeAccessKind: writeScope.kind,
        groupWriteIds: writeScope.groupIds,
        tierWriteIds: writeScope.tierIds,
        userWriteIds: writeScope.userIds,
      },
      viewer,
    )
  ) {
    return 'ok'
  }
  return 'denied'
}

/**
 * Variante boolean para UI (no debe lanzar): `false` tanto si la
 * categoría no existe como si el viewer no tiene acceso.
 */
export async function canViewCategory(categoryId: string, viewer: LibraryViewer): Promise<boolean> {
  return (await resolveAccess(categoryId, viewer)) === 'ok'
}

/**
 * Variante imperativa para pages/actions: `NotFoundError` si la categoría
 * no existe, `AuthorizationError` si existe pero el viewer no tiene
 * acceso. No-op si es legible.
 */
export async function assertCategoryReadable(
  categoryId: string,
  viewer: LibraryViewer,
): Promise<void> {
  const access = await resolveAccess(categoryId, viewer)
  if (access === 'not-found') {
    throw new NotFoundError('Categoría no encontrada.', { categoryId })
  }
  if (access === 'denied') {
    throw new AuthorizationError('No tenés acceso a esta categoría.', {
      categoryId,
      userId: viewer.userId,
    })
  }
}
