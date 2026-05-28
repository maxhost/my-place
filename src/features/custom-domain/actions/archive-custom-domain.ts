"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { log } from "@/shared/lib/observability/log";
import { removeDomain } from "@/shared/lib/vercel";
import { type ArchiveCustomDomainResult } from "../types/custom-domain";

// Server Action de archivado (soft-delete) de custom domain V1
// (ADR-0026 + `docs/features/custom-domain/spec.md`). Canon seam-split:
// sin vitest directo, correctitud por tipo/build + smoke.
//
// SEMÁNTICA "archive":
//
//   - Soft-delete en DB: `archived_at = now()`. La fila queda para auditoría.
//   - DELETE en Vercel: BEST-EFFORT — si falla (red, 4xx, 5xx), el archive
//     local sigue siendo SoT de la intención del owner. La reconciliación
//     manual via Vercel dashboard cubre el caso raro de domains "huérfanos
//     en Vercel". Esta asimetría es consciente: V1 prioriza que el owner
//     pueda "soltar" el dominio en su side de la app aunque Vercel esté
//     temporalmente fuera; el cost es que un dominio archived puede seguir
//     ocupando slot en Vercel hasta que el cron de V1.1 (S6 opcional) o el
//     dashboard manual lo limpien.
//   - La partial unique index `place_domain_domain_active_unq` (S1) libera
//     el `domain` para re-registro inmediato post-archive — el invariante
//     es "a lo sumo una fila activa por domain", no "un domain único en
//     toda la historia".
//
// AUTH + RLS: fail-closed ocurre dentro de `getAuthenticatedDbForRequest`
// (zone-aware, ADR-0032 §S11.2) — el helper detecta la zona del request y
// lee la cookie correcta (Neon Auth en apex/subdomain, SSO local
// `__Host-place_sso_session` en custom domain). Sin sesión válida lanza
// `NoSessionError` que el outer catch colapsa a `"generic"`. Reemplaza el
// patrón anterior `requireSessionJwt() + getAuthenticatedDb(token, …)` que
// sólo leía la cookie Neon Auth (rota en custom domain por RFC 6265, bug
// T1.2 detectado en smoke production 2026-05-23).
//
// Defense-in-depth slug-match: el WHERE incluye un `place_id IN (SELECT id
// FROM place WHERE slug = $2)` además del `id = $1`. La RLS owner-only de
// `place_domain` ya filtraría rows que no pertenezcan al caller, pero el
// slug-match es defense-in-depth contra un caller (e.g. devtools) que pase
// un domainId de un place distinto al actual: la UI sólo ofrece archive
// para el slug que renderea, así que cualquier mismatch debe colapsar a
// `"not_found"`. Continuidad RLS cross-zone: el `sub` del local session
// JWT === el `sub` del Neon Auth JWT, por lo que `app.current_user_id()`
// retorna el mismo valor en custom domain que en apex (ADR-0032 §4).
//
// `revalidatePath`: sub-path granular, idéntico al `register`.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const archiveInputSchema = z.object({
  placeSlug: z.string().min(3).max(63).regex(SLUG_RE),
  // El id de `place_domain` viene de `gen_random_uuid()::text` (data-model
  // §Convenciones). 36 chars canónicos; aceptamos un rango amplio por si en
  // V2 cambiamos el generador. Bound máximo defensivo contra payloads raros.
  domainId: z.string().min(1).max(64),
});

export type ArchiveCustomDomainInput = z.input<typeof archiveInputSchema>;
export type ArchiveCustomDomain = (
  input: ArchiveCustomDomainInput,
) => Promise<ArchiveCustomDomainResult>;

/**
 * Archiva (soft-delete) el custom domain identificado por `domainId` para
 * el place `placeSlug`. Owner-only via RLS. El DELETE en Vercel es
 * best-effort: un fallo no rollbackea el archive (DB es SoT de la decisión
 * del owner). Idempotente: re-archivar una fila ya archived retorna
 * `"not_found"` — UX-equivalente, no doxxea estado.
 */
export async function archiveCustomDomainAction(
  input: ArchiveCustomDomainInput,
): Promise<ArchiveCustomDomainResult> {
  const parsed = archiveInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", reason: "generic" };
  const { placeSlug, domainId } = parsed.data;

  let archivedDomain: string | null = null;
  try {
    archivedDomain = await getAuthenticatedDbForRequest(async (sql) => {
      const rows = await sql(
        `UPDATE place_domain
            SET archived_at = now()
          WHERE id = $1
            AND archived_at IS NULL
            AND place_id IN (
              SELECT id FROM place WHERE slug = $2 AND archived_at IS NULL
            )
       RETURNING domain`,
        [domainId, placeSlug],
      );
      return rows.length > 0 ? (rows[0].domain as string) : null;
    });
  } catch {
    // `NoSessionError` (sin cookie SSO local en custom domain, sin Neon Auth
    // en apex), cualquier fallo de DB / transport / verifier de JWT — todos
    // colapsan a "generic" (UX-equivalente). El action es fail-closed: nada
    // se persiste, y el DELETE en Vercel ni se intenta.
    return { status: "error", reason: "generic" };
  }

  if (archivedDomain === null) {
    // RLS filtró, o domainId no existe, o ya estaba archived, o el slug no
    // matchea el place_id. UX-equivalente: "no encontramos ese dominio".
    return { status: "error", reason: "not_found" };
  }

  // Vercel cleanup best-effort. Loggeo estructurado para que un fallo
  // recurrente sea visible en observability sin bloquear al owner.
  const vercelResult = await removeDomain(archivedDomain);
  if (!vercelResult.ok) {
    log.warn(
      {
        scope: "archive-custom-domain",
        reason: vercelResult.reason,
        domain: archivedDomain,
      },
      "Vercel removeDomain falló (archive local OK; reconciliación manual via dashboard si persiste)",
    );
  }

  revalidatePath(`/place/${placeSlug}/settings/domain`);
  return { status: "ok" };
}
