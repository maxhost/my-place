/**
 * Subdomains que no pueden ser slugs de place.
 * Ver `docs/multi-tenancy.md` § "Reservados".
 *
 * Extender esta lista cada vez que el producto tome un subdomain nuevo.
 *
 * **Nota sobre `www`:** sigue en la lista para BLOQUEAR que un user cree un
 * place con slug `www`, pero `resolveHost` lo intercepta antes del check
 * `isReservedSlug` y lo trata como `marketing` (alias del apex) — Vercel
 * redirige automáticamente apex → www cuando ambos están registrados, y
 * `reserved` rompería flows que apuntan a apex. Ver ADR
 * `2026-05-10-auth-callbacks-on-apex.md`.
 */
export const RESERVED_SLUGS = [
  'app',
  'www',
  'api',
  'admin',
  'staging',
  'dev',
  'test',
  'docs',
  'mail',
  'status',
  'blog',
  'help',
  'support',
  'assets',
  'static',
  'cdn',
] as const

export type ReservedSlug = (typeof RESERVED_SLUGS)[number]

export function isReservedSlug(candidate: string): candidate is ReservedSlug {
  return (RESERVED_SLUGS as readonly string[]).includes(candidate.toLowerCase())
}
