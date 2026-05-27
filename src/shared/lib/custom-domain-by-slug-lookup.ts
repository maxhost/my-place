import { cache } from "react";
import { z } from "zod";

import { pool } from "@/db/client";

// Feature E — Invite Accept Flow V1.2 · Sesión A (ADR-0046 §D1, migration
// 0022). Wrapper TS sobre `app.lookup_custom_domain_by_slug` SECURITY DEFINER.
//
// Inverso de `lookupPlaceByDomain` (`shared/lib/custom-domain-lookup.ts`,
// Feature B S1): aquel toma host → place; éste toma slug → domain. Consumer
// canónico: `buildPlaceCanonicalUrl` (`shared/lib/auth-redirect.ts`), que
// decide si una URL canónica del place se emite contra el custom domain
// verified o contra el subdomain canon fallback.
//
// ANONYMOUS LOOKUP — bypassa `getAuthenticatedDb` por diseño: el caller
// canónico es un RSC sin sesión del owner del place inviting (e.g. el RSC
// que renderiza el invite link para un invitee anónimo, o `settings/members`
// renderizado por un caller que ES owner pero no usa la sesión para el
// lookup informativo). La función SQL (migration 0022) filtra explícitamente
// `pd.verified_at IS NOT NULL` + ambos `archived_at IS NULL` + ejecuta sólo
// como `app_system` (REVOKE FROM PUBLIC).
//
// ## Memoización per-request via React.cache
//
// Wrapper envuelto en `cache()` (`import { cache } from "react"`). Argumento
// PRIMITIVO (`slug: string`) → React.cache deduplica intra-render por
// identity de string (===). Cuando el invite flow V1.2 invoca el lookup desde
// el helper `buildPlaceCanonicalUrl` en 2+ posiciones del mismo render
// (e.g. `inviteUrl` + `placeHomeUrl` en `invite/[token]/page.tsx`), una sola
// query Neon iad1 cubre todas. Misma técnica que `getPlaceLocaleFallback`
// (`(app)/place/[placeSlug]/_lib/get-place-for-zone.ts:190`).
//
// Diferencia vs `lookupPlaceByDomain`/`lookupPlaceLocaleBySlug` (NO
// cacheados): aquellos viven en pages que ya tienen sus propios coordinators
// memoizados (`getPlaceForZone`); acá el helper consumer es puro y no tiene
// donde colgar el cache, así que el wrapper lo asume.
//
// ## Invariantes
//
//   1. Normalización del slug: trim + lowercase. Defense-in-depth: la función
//      SQL ya hace `lower(slug) = lower(p_slug)`, pero la frontera TS también
//      normaliza para no depender de la implementación remota Y para que
//      React.cache deduplique correctamente cuando dos callsites pasan el
//      mismo slug con casing distinto.
//   2. Zod parse del retorno como `z.string().min(1)`: defense-in-depth ante
//      drift extremo (NULL inesperado, tipo no-string, string vacío). El
//      shape de un domain es validado por Feature A en register-action; el
//      Zod acá no re-valida el formato DNS — sólo "es string no vacío".
//   3. Fail-safe: TODO error de DB (timeout, network, pool exhaustion, drift
//      de schema) colapsa a `null` + `console.error`. El helper consumer
//      NUNCA crashea y NUNCA emite URLs corruptas — `null` cae al subdomain
//      canon (`buildSubdomainCanonicalUrl`).
//   4. Skip short-circuit: slug vacío / whitespace-only → null sin query.

const domainSchema = z.string().min(1);

interface LookupRow {
  domain: unknown;
}

export const lookupCustomDomainBySlug = cache(async (
  rawSlug: string,
): Promise<string | null> => {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) return null;

  try {
    const result = await pool.query<LookupRow>(
      "SELECT app.lookup_custom_domain_by_slug($1) AS domain",
      [slug],
    );

    const domain = result.rows[0]?.domain;
    if (domain === null || domain === undefined) return null;

    const parsed = domainSchema.safeParse(domain);
    if (!parsed.success) {
      console.error(
        "[custom-domain-by-slug-lookup] domain inválido para slug=",
        slug,
        parsed.error,
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error(
      "[custom-domain-by-slug-lookup] DB query falló para slug=",
      slug,
      err,
    );
    return null;
  }
});
