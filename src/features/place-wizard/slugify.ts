// Deriva una SUGERENCIA de slug desde el nombre libre del lugar. Es una
// afordancia de UI, NO autoritativa: la validacion dura es `slugSchema`
// (formato/reservado) y el `UNIQUE` de la DB (S5b). Puro, sin red ni DOM.
//
// NFKD + strip de diacriticos (rango combining U+0300-U+036F) mantiene la
// letra base (cafe, nandu); todo lo no alfanumerico colapsa a un guion;
// recorte a 63 (label DNS) sin guion de borde.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}
