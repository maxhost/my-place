import 'server-only'

/**
 * API pública server-only del slice `flags`. Queries que tocan Prisma y nunca
 * deben viajar al client bundle. Los Server Components y layouts consumen acá;
 * los Client Components consumen `public.ts` (sin queries).
 *
 * Ver `docs/decisions/2026-04-21-flags-subslice-split.md` § "Boundary client vs server".
 */

export { countOpenFlags, listFlagTargetSnapshots, listFlagsByPlace } from './server/queries'
