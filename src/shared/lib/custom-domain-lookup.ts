import { cache } from "react";
import { z } from "zod";

import { pool } from "@/db/client";
import { log } from "@/shared/lib/observability/log";

// Feature B — custom-domain-routing V1 (ADR-0031 §1, migration 0009).
//
// ANONYMOUS LOOKUP — bypassa `getAuthenticatedDb` por diseño: el proxy resuelve
// el host ANTES de cualquier auth, no hay JWT del visitante. Este wrapper
// invoca `app.lookup_place_by_domain` (SECURITY DEFINER, STABLE, S1) que filtra
// explícitamente `verified_at IS NOT NULL` + `place_domain.archived_at IS NULL`
// + `place.archived_at IS NULL` y `LIMIT 1`. La RLS owner-only de
// `place_domain` NO se debilita — la función SQL abre un canal específico con
// payload mínimo (`place_id`, `slug`, `default_locale`) ejecutable sólo por
// `app_system` (REVOKE FROM PUBLIC, EXECUTE granted a `app_system`).
//
// MEMOIZACIÓN PER-REQUEST (React `cache`): envuelto con `cache()` para
// deduplicar dentro de un mismo render RSC. Un único request al page tree
// puede invocar este lookup desde múltiples puntos (proxy → layout → nested
// layouts → page → server actions); sin memo, cada uno dispara su propia
// query DB. `cache()` colapsa todas las llamadas con el mismo `rawHost`
// normalizado a UNA query. Fuera de contexto RSC (middleware Next, route
// handlers `/api/auth/sso-*`) `cache()` actúa como pass-through transparente:
// la función se ejecuta normal sin memo (esos paths invocan 1x por request
// igual). Safe to use en cualquier callsite server-only.
//
// Invariantes:
//   1. Normalización del host idéntica a `resolveHost` SYNC (port strip + trim
//      + lowercase). Defense-in-depth: la función SQL ya hace
//      `lower(domain) = lower(p_host)`, pero la frontera TS también normaliza
//      para no depender de la implementación remota.
//   2. Zod parse del payload `jsonb` — el contrato de schema queda explícito
//      en TS; un drift futuro del shape no rompe silenciosamente.
//   3. Fail-safe: TODO error de DB (timeout, network, pool exhaustion, drift
//      de schema) colapsa a `null` + `log.error` (ADR-0047). El proxy NUNCA crashea y
//      NUNCA sirve el place de otro por error — `null` rutea a marketing.
//   4. Renombre snake_case (DB) → camelCase (TS) en la frontera.

const lookupPayloadSchema = z.object({
  place_id: z.string().uuid(),
  slug: z.string(),
  default_locale: z.enum(["es", "en", "fr", "pt", "de", "ca"]),
});

interface LookupRow {
  payload: unknown;
}

export const lookupPlaceByDomain = cache(
  async (
    rawHost: string,
  ): Promise<{
    placeId: string;
    slug: string;
    defaultLocale: string;
  } | null> => {
    const host = rawHost.split(":")[0]?.trim().toLowerCase() ?? "";
    if (!host) return null;

    try {
      const result = await pool.query<LookupRow>(
        "SELECT app.lookup_place_by_domain($1) AS payload",
        [host],
      );

      const payload = result.rows[0]?.payload;
      if (payload === null || payload === undefined) return null;

      const parsed = lookupPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        log.error(
          parsed.error,
          { scope: "custom-domain-lookup", host },
          "payload inválido",
        );
        return null;
      }

      return {
        placeId: parsed.data.place_id,
        slug: parsed.data.slug,
        defaultLocale: parsed.data.default_locale,
      };
    } catch (err) {
      log.error(
        err,
        { scope: "custom-domain-lookup", host },
        "DB query falló",
      );
      return null;
    }
  },
);
