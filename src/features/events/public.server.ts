import 'server-only'

/**
 * Superficie pública server-only del slice `events`. Queries Prisma que
 * nunca deben viajar al bundle cliente.
 *
 * Server Components y server actions consumen acá; Client Components consumen
 * sólo `public.ts`. Ver `docs/decisions/2026-04-21-flags-subslice-split.md`
 * § "Boundary client vs server".
 */

export { listEvents, getEvent, listEventRsvps } from './server/queries'
