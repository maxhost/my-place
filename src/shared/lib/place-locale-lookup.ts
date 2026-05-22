import { z } from "zod";

import { pool } from "@/db/client";

// Feature B — custom-domain-routing V1 (ADR-0031 §"Fuente 2", migration 0010).
//
// ANONYMOUS LOOKUP del `default_locale` configurado por el owner para un place
// identificado por slug. Cierra el "Bug 1" del audit S4: el layout
// `(app)/place/[placeSlug]/` resuelve `<html lang>` vía
// `place.default_locale`, pero `getPlaceForZone` retorna `null` cuando el
// caller no es owner (RLS owner-only en `place`). Resultado pre-S4b: visitor
// anónimo en subdomain canon (`mi-place.place.community/`) ve el chrome en
// `routing.defaultLocale` ('es') aunque el owner configuró 'pt'.
//
// Este wrapper bypassa `getAuthenticatedDb` por diseño: el visitor en
// subdomain canon NO tiene sesión propia del place (la cookie Neon Auth es
// host-only `.place.community`, pero el flow es lookup informativo, sin
// reading owner-only data). Invoca `app.lookup_place_locale_by_slug`
// (SECURITY DEFINER, STABLE, S4b §SQL) que filtra explícitamente
// `archived_at IS NULL` y devuelve ÚNICAMENTE el `default_locale` —
// no expone slug, id, billing, ni ninguna otra columna. La RLS owner-only de
// `place` NO se debilita — la función SQL abre un canal específico con
// payload mínimo (escalar `text` validado por CHECK constraint), ejecutable
// sólo por `app_system` (REVOKE FROM PUBLIC, EXECUTE granted a `app_system`).
//
// Invariantes:
//   1. Normalización del slug: trim + lowercase. Defense-in-depth: la
//      función SQL ya hace `lower(slug) = lower(p_slug)`, pero la frontera
//      TS también normaliza para no depender de la implementación remota.
//   2. Zod parse del retorno como `enum` cerrado (los 6 locales operativos,
//      ADR-0024). El CHECK constraint `place_default_locale_check` garantiza
//      el invariante en DB; el Zod defense-in-depth ante drift TS↔SQL (e.g.,
//      el día que se agregue un locale al CHECK pero no al enum del front).
//   3. Fail-safe: TODO error de DB (timeout, network, pool exhaustion, drift
//      de schema) colapsa a `null` + `console.error`. El layout NUNCA crashea
//      y NUNCA renderea con un `<html lang>` inválido — `null` cae a
//      `routing.defaultLocale` (precedence 3).
//   4. Skip short-circuit: slug vacío / whitespace-only → null sin query.

const localeSchema = z.enum(["es", "en", "fr", "pt", "de", "ca"]);

interface LookupRow {
  locale: unknown;
}

export async function lookupPlaceLocaleBySlug(
  rawSlug: string,
): Promise<string | null> {
  const slug = rawSlug.trim().toLowerCase();
  if (!slug) return null;

  try {
    const result = await pool.query<LookupRow>(
      "SELECT app.lookup_place_locale_by_slug($1) AS locale",
      [slug],
    );

    const locale = result.rows[0]?.locale;
    if (locale === null || locale === undefined) return null;

    const parsed = localeSchema.safeParse(locale);
    if (!parsed.success) {
      console.error(
        "[place-locale-lookup] locale inválido para slug=",
        slug,
        parsed.error,
      );
      return null;
    }

    return parsed.data;
  } catch (err) {
    console.error(
      "[place-locale-lookup] DB query falló para slug=",
      slug,
      err,
    );
    return null;
  }
}
