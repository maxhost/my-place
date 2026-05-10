import { Suspense } from 'react'
import { canCreateInAnyCategoryForViewer } from '@/features/library/public.server'
import { ZoneFabClient } from './zone-fab-client'

/**
 * Wrapper Server del FAB cross-zona (R.2.6) — separa el lookup de
 * `canCreateInAnyCategoryForViewer` (1 round-trip al pooler Postgres
 * en el peor caso para members no admin) del shell paint del layout
 * (gated).
 *
 * Contexto del refactor (2026-05-04): antes el `(gated)/layout.tsx`
 * resolvía `canCreateLibraryResource` con un `await` previo al
 * render, lo cual bloqueaba TODAS las pages bajo `(gated)` por una
 * capability que solo el FAB consume. Ahora el lookup vive dentro
 * del propio `<ZoneFab>` envuelto en `<Suspense fallback={null}>`:
 * Next streamea el shell + zona inmediatamente y el FAB aparece en
 * cuanto la query resuelve. Si la query falla o tarda, el shell
 * sigue interactivo.
 *
 * `fallback={null}` evita flicker visible: el FAB no tiene "estado
 * de carga"; o se muestra (canCreate=true) o no (canCreate=false).
 * Mientras Suspende, simplemente no hay nada renderizado — idéntico
 * al estado final cuando canCreate=false. Cuando resuelve, el FAB
 * "aparece" recién entonces, lo que es aceptable para un overlay
 * decorativo (no es contenido principal de la zona).
 *
 * Boundary: el import a `@/features/library/public.server` es
 * cross-slice válido (shell → library) vía la public surface
 * top-level del slice. La query usa el `prisma` singleton (service
 * role) y bypassea RLS; `placeId` y `userId` ya fueron validados
 * por el layout padre (auth + membership + hours).
 *
 * El componente cliente (`<ZoneFabClient>`) sigue siendo un Client
 * Component porque depende de `usePathname()` para decidir
 * visibilidad por zona. Ver `zone-fab-client.tsx` para la lógica.
 */
type Props = {
  placeId: string
  userId: string
  isAdmin: boolean
}

export function ZoneFab(props: Props): React.ReactNode {
  return (
    <Suspense fallback={null}>
      <ZoneFabResolver {...props} />
    </Suspense>
  )
}

async function ZoneFabResolver({ placeId, userId, isAdmin }: Props) {
  const canCreateLibraryResource = await canCreateInAnyCategoryForViewer({
    placeId,
    userId,
    isAdmin,
  })
  return <ZoneFabClient canCreateLibraryResource={canCreateLibraryResource} />
}
