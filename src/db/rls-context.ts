import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Contexto de identidad para RLS — base del switch.
 *
 * Cada query a la base corre "en nombre de" un principal. Este módulo
 * mantiene ese principal en un `AsyncLocalStorage` poblado en el borde
 * del servidor (server action / RSC de datos / route handler / job) vía
 * `runWithPrincipal`. El wrapper de `db/client` lo lee y, antes de cada
 * transacción, ejecuta `SET LOCAL ROLE` + `set_config('request.jwt.claims')`
 * para que Postgres evalúe las policies con `auth.uid()` correcto.
 *
 * Diseño: `docs/rls/switch-design.md`. Restricciones del owner:
 *  - Cero service-role, nada bypasea RLS.
 *  - Tres principales, todos sujetos a RLS (el `System` con FORCE RLS +
 *    policies propias mínimas).
 *  - Falla CERRADA: sin principal en el contexto, el wrapper lanza —
 *    NUNCA cae a un cliente que bypasea. Este módulo no decide eso (lo
 *    hace el wrapper), pero `getCurrentPrincipal` puede devolver
 *    `undefined` y el contrato es que el consumidor trate eso como error.
 *  - Sin botón de emergencia: no hay flag que desactive el enforcement.
 */

/**
 * Nombre del rol Postgres dedicado al principal de sistema (crons/jobs
 * sin usuario). Rol propio (opción A) + las tablas usan
 * `FORCE ROW LEVEL SECURITY` (opción B) para que ni este rol ni el dueño
 * de las tablas puedan saltarse RLS. Un único lugar de verdad para el
 * nombre — la migración que lo crea debe usar exactamente este string.
 */
export const SYSTEM_DB_ROLE = 'app_system' as const

/** Roles Postgres válidos como destino de `SET LOCAL ROLE`. */
export type DbRole = 'authenticated' | 'anon' | typeof SYSTEM_DB_ROLE

export type Principal =
  | { readonly kind: 'authenticated'; readonly userId: string }
  | { readonly kind: 'anon' }
  | { readonly kind: 'system' }

const storage = new AsyncLocalStorage<Principal>()

/**
 * Ejecuta `fn` con `principal` activo en el contexto. Todo lo que corra
 * por debajo (incluidas las queries Prisma vía el wrapper) hereda este
 * principal. Se invoca UNA vez por request/job en el borde del servidor
 * (no por query — el costo del carnet se amortiza por request).
 */
export function runWithPrincipal<T>(principal: Principal, fn: () => Promise<T>): Promise<T> {
  return storage.run(principal, fn)
}

/** Atajo: request de un usuario autenticado (userId del JWT verificado). */
export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithPrincipal({ kind: 'authenticated', userId }, fn)
}

/** Atajo: request sin sesión (landing, vista pública del directorio). */
export function runAsAnon<T>(fn: () => Promise<T>): Promise<T> {
  return runWithPrincipal({ kind: 'anon' }, fn)
}

/**
 * Atajo: tarea de sistema sin usuario (cron de anonimización 365d,
 * openings, erasure). El job se declara `system` explícitamente — no hay
 * cookie ni sesión. Igual queda sujeto a RLS (FORCE + policies `System`).
 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return runWithPrincipal({ kind: 'system' }, fn)
}

/**
 * Principal activo, o `undefined` si no hay contexto. El wrapper de
 * `db/client` trata `undefined` como ERROR (falla cerrada): ninguna
 * query corre sin un principal explícito.
 */
export function getCurrentPrincipal(): Principal | undefined {
  return storage.getStore()
}

/**
 * Traduce el principal al rol Postgres + claim JWT que el wrapper aplica
 * con `SET LOCAL ROLE <role>` y
 * `set_config('request.jwt.claims', <claim>, true)`.
 *
 * `auth.uid()` en las policies lee `request.jwt.claims->>'sub'`. Para
 * `anon`/`system` no hay `sub` (no son un usuario) — su acceso lo
 * gobiernan policies específicas del rol, no `auth.uid()`.
 */
export function principalToDbContext(principal: Principal): {
  role: DbRole
  claims: Record<string, string>
} {
  switch (principal.kind) {
    case 'authenticated':
      return {
        role: 'authenticated',
        claims: { sub: principal.userId, role: 'authenticated' },
      }
    case 'anon':
      return { role: 'anon', claims: { role: 'anon' } }
    case 'system':
      return { role: SYSTEM_DB_ROLE, claims: { role: SYSTEM_DB_ROLE } }
    default: {
      // Exhaustividad: si se agrega un kind y no se cubre, rompe el build.
      const _exhaustive: never = principal
      return _exhaustive
    }
  }
}
