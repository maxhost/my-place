"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";

// Server Action de cambio de `place.default_locale` desde el settings (S7 del
// feature `settings`, `docs/features/settings/spec.md` §"Sección Idioma del
// place"). Borde cross-system del SDK Neon Auth + Neon DB; su correctitud es
// de tipo/build + smoke vivo en producción, NO vitest (arrastra `next/headers`
// + Neon Auth + DB real — canon de seam-split, idéntico a `createPlaceAction`,
// `logoutAction`, `signUpAccountAction`).
//
// Defense-in-depth — tres redes de seguridad apiladas:
//
// 1. **Zod sobre el input** (CLAUDE.md §"Zod para todo input externo"): valida
//    formato de slug + enum de los 6 locales. `routing.locales` es el SoT de
//    la lista (ADR-0024); la DB tiene el mismo CHECK constraint en la columna
//    (migration 0006, ADR-0022) — si Zod y el CHECK se desincronizaran, el
//    UPDATE fallaría loud. Mismo SoT que `createPlaceInputSchema.defaultLocale`
//    (`place-creation/domain/schema.ts:110`).
// 2. **`getAuthenticatedDbForRequest()`** (zone-aware, ADR-0032 §S11.2):
//    fail-closed antes de tocar la DB — el helper detecta la zona del request
//    y lee la cookie correcta (Neon Auth en apex/subdomain, SSO local
//    `__Host-place_sso_session` en custom domain). Sin sesión válida lanza
//    `NoSessionError` que el outer catch colapsa a `error`. Reemplaza el
//    patrón anterior `requireSessionJwt() + getAuthenticatedDb(token, …)` que
//    sólo leía la cookie Neon Auth (rota en custom domain por RFC 6265, bug
//    T1.2 detectado en smoke production 2026-05-23).
// 3. **RLS `place_upd` (owner-only, ADR-0010)**: el UPDATE corre con
//    `request.jwt.claims.sub` inyectado tx-local; la policy filtra a 0 rows
//    si el caller no es owner. `RETURNING id` detecta ese caso (rows vacío) y
//    lo mapea a `status: "error"` UX-equivalente — el caller no distingue
//    "no autorizado" de "slug no existe" (no doxxea, spec §"Journeys C").
//    Continuidad RLS cross-zone: el `sub` del local session JWT === el `sub`
//    del Neon Auth JWT, por lo que `app.current_user_id()` retorna el mismo
//    valor en custom domain que en apex (ADR-0032 §4).
//
// `revalidatePath("/place/[placeSlug]/settings")`: invalida la cache del page
// del settings (S6) — la próxima carga corre `getPlaceForZone(slug)` (cache
// de React por-render, no afectada) + `getTranslations({locale})` con el
// nuevo locale ⇒ el chrome renderea en el idioma elegido. Route group `(app)`
// no participa del path (Next App Router canon).
//
// Result shape `ok | error`: spec line 30. Internamente el action distingue
// las causas para logging futuro (zod invalid / RLS-filtered / DB error), pero
// las colapsa al mismo `error` porque la UX las trata igual ("no pudimos
// guardar el idioma, probá de nuevo"). Si en V2 se quiere distinguir (e.g.
// race de transferencia de ownership ⇒ relogin), se amplía el discriminated
// union sin breaking change.

// Slug DNS-safe (mismo regex que `place-creation/domain/schema.ts:27` —
// duplicado intencional para mantener el slice acíclico: si `place-settings`
// importara `slugSchema` de `place-creation/public.ts`, settings dependería de
// la saga de creación que es ortogonal). Defense-in-depth: el slug llega al
// action desde el page que ya hizo `isServiceableSlug(placeSlug)` (S6) — esto
// es la última red por si un caller (e.g. fetch directo desde devtools)
// salteara la barrera del page.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const updateDefaultLocaleInputSchema = z.object({
  placeSlug: z
    .string()
    .min(3)
    .max(63)
    .regex(SLUG_RE),
  newLocale: z.enum(routing.locales),
});

/** Payload del Server Action — el Client lo construye desde su state. */
export type UpdateDefaultLocaleInput = z.input<
  typeof updateDefaultLocaleInputSchema
>;

/**
 * Resultado del action. `ok` ⇒ persistido + cache invalidada; la próxima carga
 * del settings renderea en el nuevo locale. `error` ⇒ cualquier causa
 * (zod / sesión perdida / RLS / DB) — el Client muestra notice calmo y deja
 * el form editable. Spec §"Sección Idioma del place" — Estados.
 */
export type UpdateDefaultLocaleResult =
  | { status: "ok" }
  | { status: "error" };

/** Firma del action — utilizable por consumers que la inyectan (Client + tests). */
export type UpdateDefaultLocale = (
  input: UpdateDefaultLocaleInput,
) => Promise<UpdateDefaultLocaleResult>;

/**
 * Actualiza `place.default_locale` del lugar identificado por `placeSlug`.
 * Owner-only via RLS + EXISTS en `place_upd` (ADR-0010). Idempotente: aplicar
 * el mismo locale dos veces deja el row igual y revalida la cache igual — la
 * UX trata ambos como `ok`.
 */
export async function updateDefaultLocaleAction(
  input: UpdateDefaultLocaleInput,
): Promise<UpdateDefaultLocaleResult> {
  const parsed = updateDefaultLocaleInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error" };
  const { placeSlug, newLocale } = parsed.data;

  let updated: boolean;
  try {
    updated = await getAuthenticatedDbForRequest(async (sql) => {
      const rows = await sql(
        `UPDATE place
            SET default_locale = $1
          WHERE slug = $2
            AND archived_at IS NULL
          RETURNING id`,
        [newLocale, placeSlug],
      );
      return rows.length > 0;
    });
  } catch {
    // `NoSessionError` (sin cookie SSO local en custom domain, sin Neon Auth
    // en apex), cualquier fallo de DB / transport / verifier de JWT — todos
    // colapsan a `error`. El action es fail-closed: nada se persiste. El
    // Client muestra el notice y el próximo refresh del settings dispara el
    // silent SSO o redirige al login según corresponda.
    return { status: "error" };
  }
  if (!updated) {
    // RLS filtró (caller no es owner del place) o el slug no existe / está
    // archivado. UX-equivalente: no se persistió.
    return { status: "error" };
  }

  revalidatePath(`/place/${placeSlug}/settings`);
  return { status: "ok" };
}
