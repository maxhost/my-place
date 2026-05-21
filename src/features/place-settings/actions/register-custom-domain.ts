"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateCustomDomain } from "@/shared/lib/custom-domain";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { requireSessionJwt } from "@/shared/lib/session";
import { addDomain } from "@/shared/lib/vercel";
import {
  type CustomDomainRecord,
  type DnsRecord,
  mapPgErrorToActionError,
  type RegisterCustomDomainResult,
  type RegisterError,
} from "../types/custom-domain";

// Server Action de registro de custom domain (feature custom-domain V1,
// ADR-0026 + `docs/features/custom-domain/spec.md`). Borde cross-system Neon
// Auth + Neon DB + Vercel Domains API — canon seam-split: correctitud por
// tipo/build + smoke vivo, NO vitest (idéntico a `update-default-locale.ts:13`).
// Las piezas puras (`validateCustomDomain`, `mapPgErrorToActionError`, wrapper
// Vercel) sí están testeadas en isolation.
//
// FLUJO (5 fases, falibles independientes):
//
//   1. Zod sobre input (placeSlug + domain) — fail-closed ante drift de tipo.
//   2. `validateCustomDomain` — formato RFC 1123 + ASCII + no-reservados.
//      Defense-in-depth: la UI ya validó client-side con la misma función
//      (SoT compartido); el action re-aplica antes de tocar DB.
//   3. `requireSessionJwt` — fail-closed antes de la DB.
//   4. Tx única (`runInsertTx`): lookup `place` por slug (RLS owner-only
//      filtra outsiders → 0 rows → "generic"), pre-check single-domain V1
//      (sentinel `LIMIT_REACHED_SENTINEL` distingue del error PG), INSERT con
//      `RETURNING`. UNIQUE violation (PG `23505`, contra
//      `place_domain_domain_active_unq` de S1) → `domain_taken` vía
//      `mapPgErrorToActionError`.
//   5. Fuera de tx: `vercel.addDomain`. Si falla, rollback DB con DELETE
//      best-effort (`rollbackInsertedRow`). La separación tx 1 / red / tx 2
//      evita mantener un conn idle durante el `fetch` a Vercel (puede tardar
//      segundos); el costo es que la atomicidad cross-system es best-effort
//      (V1 conscious). Un rollback fallido deja una fila huérfana; el lazy
//      poll de `getCustomDomainStatus` la verá como pending sin DNS records
//      y el owner puede archivarla manual.
//
// IDIOMPOTENCIA del double-click: el pre-check single-domain rechaza el
// segundo submit como `limit_reached`. UX clara — "ya tenés un dominio
// configurado". Idempotencia real (retorna ok con la fila existente) se
// difiere a V1.1 si el smoke lo amerita.
//
// `revalidatePath`: invalida `/place/[placeSlug]/settings/domain` (sub-path
// granular, NO `/settings` global; ADR-0026). La próxima carga corre
// `getCustomDomainStatus` (lazy poll) y muestra el state actual.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Sentinel que se tira desde dentro de la tx para distinguir "limit_reached"
// del error PG en el catch único. Usar string-key (no Error subclass)
// mantiene la detección trivial y no requiere instanceof juggling.
const LIMIT_REACHED_SENTINEL = "PLACE_DOMAIN_LIMIT_REACHED";

const registerInputSchema = z.object({
  placeSlug: z.string().min(3).max(63).regex(SLUG_RE),
  // Bounds amplios: la validación fina la hace `validateCustomDomain`. Acá
  // sólo evitamos que Zod deje pasar 10MB de basura accidental.
  domain: z.string().min(1).max(300),
});

export type RegisterCustomDomainInput = z.input<typeof registerInputSchema>;
export type RegisterCustomDomain = (
  input: RegisterCustomDomainInput,
) => Promise<RegisterCustomDomainResult>;

// Shape interno de la fila recién insertada (camelCase aliased en el
// RETURNING para parsing trivial).
type InsertedRow = {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

type InsertTxResult =
  | { ok: true; row: InsertedRow }
  | { ok: false; reason: RegisterError };

/** Mapea reason del validator de dominio al enum `RegisterError`. */
function validationReasonToRegisterError(
  reason: "invalid_format" | "idn_not_supported" | "reserved",
): RegisterError {
  if (reason === "idn_not_supported") return "idn_not_supported";
  if (reason === "reserved") return "reserved";
  return "invalid_domain";
}

/**
 * Tx única: lookup place + pre-check single-domain + INSERT. RLS owner-only
 * filtra outsiders en el lookup → `"generic"` (UX-equivalente a no-existe).
 * Pre-check múltiples activos → `"limit_reached"`. PG `23505` → `"domain_taken"`.
 */
async function runInsertTx(
  token: string,
  placeSlug: string,
  normalized: string,
): Promise<InsertTxResult> {
  try {
    const row = await getAuthenticatedDb(token, async (sql) => {
      const placeRows = await sql(
        `SELECT id FROM place WHERE slug = $1 AND archived_at IS NULL`,
        [placeSlug],
      );
      if (placeRows.length === 0) return null;
      const placeId = placeRows[0].id as string;

      const existingRows = await sql(
        `SELECT 1 FROM place_domain
          WHERE place_id = $1 AND archived_at IS NULL
          LIMIT 1`,
        [placeId],
      );
      if (existingRows.length > 0) throw new Error(LIMIT_REACHED_SENTINEL);

      const insertedRows = await sql(
        `INSERT INTO place_domain (place_id, domain)
              VALUES ($1, $2)
           RETURNING id,
                     domain,
                     verified_at AS "verifiedAt",
                     created_at  AS "createdAt"`,
        [placeId, normalized],
      );
      const r = insertedRows[0];
      return {
        id: r.id as string,
        domain: r.domain as string,
        verifiedAt: (r.verifiedAt as Date | null) ?? null,
        createdAt: r.createdAt as Date,
      };
    });
    if (row === null) return { ok: false, reason: "generic" };
    return { ok: true, row };
  } catch (err) {
    if (err instanceof Error && err.message === LIMIT_REACHED_SENTINEL) {
      return { ok: false, reason: "limit_reached" };
    }
    return { ok: false, reason: mapPgErrorToActionError(err) };
  }
}

/**
 * Rollback best-effort de la fila insertada cuando Vercel rechaza. Si la
 * DELETE falla, loguea y sigue: la fila huérfana queda en pending y el lazy
 * poll de `getCustomDomainStatus` la mostrará como pending sin DNS records
 * (Vercel devolverá 404). El owner puede archivar manual.
 */
async function rollbackInsertedRow(token: string, id: string): Promise<void> {
  try {
    await getAuthenticatedDb(token, async (sql) => {
      await sql(`DELETE FROM place_domain WHERE id = $1`, [id]);
    });
  } catch (rollbackErr) {
    console.error(
      "[register-custom-domain] rollback DELETE falló para id=",
      id,
      rollbackErr,
    );
  }
}

/** Mapea la reason del wrapper Vercel al enum `RegisterError` del slice. */
function mapVercelFailureToRegisterError(
  reason: "not_configured" | "unauthorized" | "domain_already_in_use" | "rate_limited" | "vercel_error" | "network",
): RegisterError {
  if (reason === "domain_already_in_use") return "domain_taken";
  return "vercel_unavailable";
}

/**
 * Registra un custom domain para el place `placeSlug`. Owner-only por RLS
 * + EXISTS implícito de `place` (la RLS owner-only de `place_sel` filtra a
 * 0 rows si el caller no es owner). Idempotencia parcial: double-submit
 * cae en `limit_reached`.
 */
export async function registerCustomDomainAction(
  input: RegisterCustomDomainInput,
): Promise<RegisterCustomDomainResult> {
  const parsed = registerInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", reason: "invalid_domain" };
  const { placeSlug, domain } = parsed.data;

  const validation = validateCustomDomain(domain);
  if (!validation.ok) {
    return {
      status: "error",
      reason: validationReasonToRegisterError(validation.reason),
    };
  }
  const normalized = validation.normalized;

  let token: string;
  try {
    token = await requireSessionJwt();
  } catch {
    return { status: "error", reason: "generic" };
  }

  const insertResult = await runInsertTx(token, placeSlug, normalized);
  if (!insertResult.ok) {
    return { status: "error", reason: insertResult.reason };
  }
  const inserted = insertResult.row;

  const vercelResult = await addDomain(normalized);
  if (!vercelResult.ok) {
    await rollbackInsertedRow(token, inserted.id);
    return {
      status: "error",
      reason: mapVercelFailureToRegisterError(vercelResult.reason),
    };
  }

  revalidatePath(`/place/${placeSlug}/settings/domain`);

  const dnsRecords: DnsRecord[] = vercelResult.data.dnsRecords.map((r) => ({
    type: r.type,
    name: r.name ?? r.domain ?? "",
    value: r.value,
  }));
  const record: CustomDomainRecord = {
    id: inserted.id,
    domain: inserted.domain,
    verifiedAt: vercelResult.data.verified ? new Date() : null,
    createdAt: inserted.createdAt,
  };

  return { status: "ok", record, dnsRecords };
}
