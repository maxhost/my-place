import 'server-only'

/**
 * Superficie pública server-only del slice `discussions`. Los consumidores
 * client-safe siguen viviendo en `public.ts`; lo que importa Prisma
 * directamente (hard delete polimórfico) sale por acá para que el bundler de
 * Next no lo trace al bundle cliente. Ver
 * `docs/decisions/2026-04-21-flags-subslice-split.md` §"Boundary client vs
 * server".
 */

export { hardDeletePost } from './server/hard-delete'
