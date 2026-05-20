// Util compartido para derivar iniciales de un displayName. Vive en
// `shared/lib` porque ≥2 slices lo consumen (`nav-hub` para el avatar del
// account menu; `inbox` para el cuadrado de la place-card). Mantener la
// función en un solo slice viola el principio acíclico — los slices no se
// importan entre sí (`docs/architecture.md` §17-25), pero todos pueden
// importar de `shared/`.
//
// Comportamiento: máximo 2 letras, upper-case, separación por whitespace
// (cualquier cantidad). Si la entrada es `null`, vacío, o sólo whitespace,
// devuelve `null` — el caller decide el fallback (ícono genérico, color del
// place, etc).

/**
 * Convierte un displayName a iniciales (máx 2 letras, upper).
 *
 * - `"Ana López"` → `"AL"`
 * - `"Ana"` → `"A"`
 * - `"Maria de los Ángeles"` → `"MD"` (primeras 2 palabras, no las relevantes)
 * - `"  ana   maría  "` → `"AM"` (whitespace extra colapsado)
 * - `null` | `""` | `"   "` → `null`
 */
export function computeInitials(displayName: string | null): string | null {
  if (!displayName) return null;
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const letters = words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return letters || null;
}
