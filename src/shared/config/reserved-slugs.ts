// Slugs que no pueden ser usados como subdominio de un place.
// Canónico: docs/multi-tenancy.md § Reservados. Se valida en el flow de
// creación (saga, S4) — la verificación dura corre server-side, no en la UI.

export const RESERVED_SLUGS = [
  // Documentados en multi-tenancy.md.
  "app", // inbox universal ({app}.place.community)
  "www",
  "api",
  "admin",
  "staging",
  "dev",
  "test",
  // Otros subdominios de infraestructura/funcionalidad propia del producto.
  "auth",
  "mail",
  "smtp",
  "assets",
  "static",
  "cdn",
  "status",
  "help",
  "support",
] as const;

export type ReservedSlug = (typeof RESERVED_SLUGS)[number];

const RESERVED_SET = new Set<string>(RESERVED_SLUGS);

/** Normaliza igual que el validador de slug: trim + lowercase. */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(slug.trim().toLowerCase());
}
