/**
 * Helper genérico para enforce exhaustividad en switches discriminados.
 *
 * Uso típico:
 *
 *   switch (state) {
 *     case 'A': return ...
 *     case 'B': return ...
 *     default:  return assertNever(state)
 *   }
 *
 * Si en el futuro alguien agrega `'C'` al union sin actualizar el switch,
 * TypeScript marca `assertNever(state)` como error en compile-time porque
 * `state` ya no es `never`. El throw en runtime es defensa en profundidad
 * por si llega un valor que pasó el typecheck (datos crudos de DB, JSON
 * deserialization, etc.).
 *
 * Sin dependencias de features ni runtime. Se ubica en `shared/lib/` por
 * ser pure utility reusable transversalmente.
 */
export function assertNever(value: never): never {
  throw new Error(`[assertNever] Unexpected value: ${JSON.stringify(value)}`)
}
