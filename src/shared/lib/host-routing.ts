import { isReservedSlug } from "@/shared/config/reserved-slugs";

// Routing host-based (ADR-0005 §10 · docs/multi-tenancy.md). PURO: clasifica
// el `host` de la request en una zona. Sin red ni DB → unit-testeable. El
// proxy (src/proxy.ts) traduce la zona a un rewrite con prefijo estático
// (`/place/{slug}`, `/inbox`) que NO colisiona con `[locale]` del árbol
// marketing — Next prohíbe dos segmentos dinámicos distintos en la misma
// posición de URL aunque estén en route groups distintos.
//
// Feature B — custom-domain-routing V1 (ADR-0031, 2026-05-22): se agrega la
// variante `custom-domain` y un wrapper ASYNC `resolveHostWithCustomDomains`
// que la resuelve consultando `app.lookup_place_by_domain` (SECURITY DEFINER,
// migration 0009/S1). `resolveHost` SYNC queda INTACTA — no breaking change;
// el wrapper async agrega la branch de custom-domain ÚNICAMENTE cuando el
// sync clasificaría como marketing Y el host parece candidato (no apex, no
// `www.<root>`, no `*.localhost`, no `*.vercel.app`). Esa heurística mantiene
// el cost budget V1 acotado: hosts conocidos estructuralmente NO consultan
// DB (ADR-0031 §"Lookup query cost budget").

export type HostZone =
  | { zone: "marketing" }
  | { zone: "inbox" }
  | { zone: "place"; slug: string }
  | {
      zone: "custom-domain";
      placeId: string;
      slug: string;
      defaultLocale: string;
    };

/**
 * Firma del lookup async que el wrapper invoca cuando el host es candidato a
 * custom domain. La implementación concreta vive en `custom-domain-lookup.ts`
 * (wrapper sobre `app.lookup_place_by_domain` DEFINER, S1). Inyectar la
 * dependencia mantiene `resolveHostWithCustomDomains` puro (no importa DB) y
 * mockeable sin red.
 *
 * Contrato:
 *   - `null` → el host no es custom domain conocido / no está verified /
 *     archivado / place archivado. El wrapper colapsa a `{zone: "marketing"}`.
 *   - `{placeId, slug, defaultLocale}` → match verified + activo en
 *     `place_domain`. El wrapper retorna la variante `custom-domain`.
 *   - **Nunca debería tirar**: la implementación de `custom-domain-lookup.ts`
 *     captura todo error de DB internamente. Aún así, este resolver hace
 *     defense-in-depth: cualquier throw colapsa a marketing (nunca crashea
 *     el proxy).
 */
export type CustomDomainLookup = (host: string) => Promise<{
  placeId: string;
  slug: string;
  defaultLocale: string;
} | null>;

/** Host raíz canónico, derivado de `NEXT_PUBLIC_APP_URL` (default prod). */
function defaultRootHost(): string {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community",
    ).host;
  } catch {
    return "place.community";
  }
}

/**
 * Clasifica el host en `marketing | inbox | place`.
 *
 * - apex / `www.` / `localhost` / `*.vercel.app` / host desconocido →
 *   `marketing` (los custom domains se resuelven por `place_domain` verificado
 *   vía `resolveHostWithCustomDomains` async; el sync fallback es marketing —
 *   nunca servir el place de otro en un host ajeno).
 * - `app.<root>` → `inbox` universal.
 * - `<label>.<root>` (o `<label>.localhost` en dev) → `place` con ese slug
 *   normalizado a minúsculas. El proxy lo rutea al árbol place; el gate de
 *   reservados/formato (`isServiceableSlug`) y la existencia en DB (S5b) los
 *   resuelve la page, no el proxy.
 */
export function resolveHost(
  rawHost: string,
  rootHost: string = defaultRootHost(),
): HostZone {
  const host = rawHost.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!host) return { zone: "marketing" };

  const root = rootHost.split(":")[0]?.trim().toLowerCase() ?? "";

  // Dev local: el browser resuelve `*.localhost` (multi-tenancy.md § Dev).
  const base =
    host === "localhost" || host.endsWith(".localhost") ? "localhost" : root;

  if (host === base || host === `www.${base}`) return { zone: "marketing" };

  if (!host.endsWith(`.${base}`)) {
    // Vercel preview (`*.vercel.app`) y custom/desconocidos → marketing.
    return { zone: "marketing" };
  }

  const label = host.slice(0, -(`.${base}`.length));
  // Un label compuesto (`a.b.<root>`) no es un place válido → marketing.
  if (!label || label.includes(".")) return { zone: "marketing" };
  if (label === "www") return { zone: "marketing" };
  if (label === "app") return { zone: "inbox" };
  return { zone: "place", slug: label };
}

/**
 * Wrapper ASYNC sobre `resolveHost` que agrega resolución de custom domains
 * vía `place_domain` verified (ADR-0031 §1).
 *
 * Política de skip (acota cost budget):
 *
 * 1. Si `resolveHost` SYNC clasifica el host como **no-marketing** (apex
 *    canónico, `app.<root>`, `<slug>.<root>`, dev `*.localhost`), retorna
 *    ese sync tal cual. Un custom domain NUNCA puede ganarle a la zona
 *    estructural: `mi-place.place.community` siempre rutea a su `place`, no
 *    a un `place_domain` que casualmente matcheara el host.
 * 2. Si el sync clasifica como **marketing** pero el host es estructuralmente
 *    no-custom (apex/www del root, `localhost`, `*.localhost`, `*.vercel.app`,
 *    host vacío), retorna sync tal cual — sin invocar `lookup` (no queremos
 *    1 query DB por hit a `place.community`).
 * 3. Solo cuando el host es candidato real (algo que el sync mandó a
 *    marketing y no es ninguno de los estructurales) se invoca `lookup`. El
 *    resultado `null` → marketing fallback (mismo comportamiento de hoy). El
 *    resultado con shape → variante `custom-domain`.
 *
 * Fail-safe `try/catch`: defense-in-depth sobre el contrato del `lookup`
 * (`custom-domain-lookup.ts` ya colapsa errores DB a null + log). Si por bug
 * futuro un lookup tira, el wrapper NO crashea — colapsa a marketing.
 *
 * `lookup` opcional: si no se pasa, el wrapper se comporta IDÉNTICO al sync
 * (proxy en tests sin dependencia DB). En runtime el proxy inyecta
 * `lookupPlaceByDomain` de `custom-domain-lookup.ts`.
 */
export async function resolveHostWithCustomDomains(
  rawHost: string,
  rootHost: string = defaultRootHost(),
  lookup?: CustomDomainLookup,
): Promise<HostZone> {
  const sync = resolveHost(rawHost, rootHost);
  if (sync.zone !== "marketing") return sync;
  if (!lookup) return sync;

  const host = rawHost.split(":")[0]?.trim().toLowerCase() ?? "";
  if (!host) return sync;

  const root = rootHost.split(":")[0]?.trim().toLowerCase() ?? "";
  if (host === root || host === `www.${root}`) return sync;
  if (host === "localhost" || host.endsWith(".localhost")) return sync;
  if (host.endsWith(".vercel.app")) return sync;

  // Hot path del cost budget V1: 1 query Neon iad1 por hit a host candidato
  // (incluye crawlers/scanners con Host fabricado). Si V1.1 el cost supera el
  // criterio cuantitativo del ADR-0031 (p95 > 100ms OR rate > 100/min),
  // agregar TTL cache acá.
  try {
    const result = await lookup(host);
    if (result === null) return sync;
    return {
      zone: "custom-domain",
      placeId: result.placeId,
      slug: result.slug,
      defaultLocale: result.defaultLocale,
    };
  } catch {
    // `custom-domain-lookup.ts` ya colapsa errores a null + log estructurado;
    // este catch es belt+suspenders para no crashear el proxy si un lookup
    // futuro deja de respetar el contrato fail-safe.
    return sync;
  }
}

// Label DNS de producto: 3–63, minúsc. alfanum + guion interno, sin guion de
// borde. Espeja el criterio de `slugSchema` (onboarding) — la AUTORIDAD de
// creación es esa (Zod, S5a) + el `UNIQUE` de la DB (S5b); acá es solo el gate
// ESTRUCTURAL del placeholder de place (sin importar internals de un feature,
// regla de aislamiento). La existencia real del slug → 404 es S5b.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/** ¿Este slug es servible por el árbol place? (formato + no reservado). */
export function isServiceableSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  return SLUG_RE.test(s) && !isReservedSlug(s);
}
