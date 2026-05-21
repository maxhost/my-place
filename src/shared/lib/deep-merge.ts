// Util compartido para mergear profundamente dos objetos planos, donde
// `overrides` gana sobre `base` recursivamente. Pure function, sin side
// effects: `base` y `overrides` quedan intactos; el resultado es un objeto
// nuevo (las ramas que se mergean también son clones — no se comparten
// referencias con los subtrees del base).
//
// Vive en `shared/lib` porque (a) ≥2 consumidores lo necesitan o lo van a
// necesitar (`src/i18n/request.ts` para el fallback runtime de traducciones
// per ADR-0024; potencialmente futuros overrides per-place de configuración
// como menciona ADR-0024 §157), y (b) el paradigma acíclico
// (`docs/architecture.md` §17-25) impide que slices/módulos i18n se importen
// entre sí — todos consumen `shared/`.
//
// Semántica de merge:
// - Keys de `base` no presentes en `overrides` → se preservan.
// - Keys de `overrides` no presentes en `base` → se incluyen.
// - Ambos objetos planos en la misma key → recursión.
// - Cualquier otro caso (arrays, primitivos, null, colisión tipo objeto vs
//   primitivo) → `overrides` reemplaza enteramente al valor del base.
// - Arrays NO se concatenan; se reemplazan (convención estándar de
//   deep-merge para evitar duplicación implícita).

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Mergea profundamente `base` con `overrides`, donde `overrides` gana.
 * Retorna un objeto nuevo; los inputs no se mutan.
 *
 * @example
 *   deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 99 } })
 *   // → { a: { b: 99, c: 2 } }
 */
export function deepMerge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrides)) {
    const overrideValue = overrides[key];
    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}
