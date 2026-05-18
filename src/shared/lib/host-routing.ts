import { isReservedSlug } from "@/shared/config/reserved-slugs";

// Routing host-based (ADR-0005 §10 · docs/multi-tenancy.md). PURO: clasifica
// el `host` de la request en una zona. Sin red ni DB → unit-testeable. El
// proxy (src/proxy.ts) traduce la zona a un rewrite con prefijo estático
// (`/place/{slug}`, `/inbox`) que NO colisiona con `[locale]` del árbol
// marketing — Next prohíbe dos segmentos dinámicos distintos en la misma
// posición de URL aunque estén en route groups distintos.

export type HostZone =
  | { zone: "marketing" }
  | { zone: "inbox" }
  | { zone: "place"; slug: string };

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
 *   en una feature posterior; hasta entonces el fallback seguro es marketing —
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
