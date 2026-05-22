"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validateCustomDomain } from "@/shared/lib/custom-domain";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { requireSessionJwt } from "@/shared/lib/session";
import { addDomain, getDomainConfig } from "@/shared/lib/vercel";
import {
  type CustomDomainRecord,
  type DnsRecord,
  mapPgErrorToActionError,
  type RegisterCustomDomainResult,
  type RegisterError,
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "../types/custom-domain";

// Server Action de registro de custom domain (ADR-0026 + ADR-0029).
// Borde cross-system Neon Auth + Neon DB + Vercel Domains API — canon
// seam-split: correctitud por tipo/build + smoke vivo, NO vitest
// (`update-default-locale.ts:13`). Las piezas puras sí (validateCustomDomain,
// mapPgErrorToActionError, wrapper Vercel, `_v6-helpers`).
//
// FLUJO (6 fases): (1) Zod, (2) validateCustomDomain, (3) requireSessionJwt,
// (4) tx INSERT (lookup place + pre-check single-domain + INSERT;
// PG 23505 → domain_taken), (5) V9 addDomain (si falla rollback DB),
// (6) V6 getDomainConfig — chequeo dual ADR-0029.
//
// FASE 6 (V6 check post-add): cierra el race del bug `verified_at` falsa
// positiva. Antes el response mockeaba `verifiedAt: new Date()` cuando V9
// decía verified=true, pero la DB tenía `verified_at IS NULL`. Con
// `nocodecompany.co` (V9 verified=true por ownership clear + V6
// misconfigured=true por DNS roto) eso causaba falsa positiva durable.
// Fix: response y DB coinciden desde el segundo 0 — sólo si V9.verified=true
// AND V6.misconfigured=false, UPDATE `verified_at = now()` en DB ANTES de
// devolver la response. Sino → response pending con records combinados
// V9.verification[] + V6.recommended* (mejor pending que verified erróneo).

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Sentinel que se tira desde dentro de la tx para distinguir "limit_reached"
// del error PG en el catch único.
const LIMIT_REACHED_SENTINEL = "PLACE_DOMAIN_LIMIT_REACHED";

const registerInputSchema = z.object({
  placeSlug: z.string().min(3).max(63).regex(SLUG_RE),
  // Bounds amplios: la validación fina la hace `validateCustomDomain`.
  domain: z.string().min(1).max(300),
});

export type RegisterCustomDomainInput = z.input<typeof registerInputSchema>;
export type RegisterCustomDomain = (
  input: RegisterCustomDomainInput,
) => Promise<RegisterCustomDomainResult>;

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
 * filtra outsiders en el lookup → `"generic"`. Pre-check múltiples activos
 * → `"limit_reached"`. PG `23505` → `"domain_taken"`.
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
 * DELETE falla, loguea y sigue: la fila huérfana queda en pending y el
 * lazy poll la mostrará como pending (Vercel devolverá 404). El owner
 * puede archivar manual.
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

/**
 * UPDATE `verified_at = now()` cuando V9 + V6 coinciden en verified
 * genuino (ADR-0029 #5). Si falla, `new Date()` igual — lazy poll
 * subsequent reintenta y la UI ya muestra verified.
 */
async function persistVerifiedAtNow(
  token: string,
  id: string,
): Promise<Date> {
  try {
    return await getAuthenticatedDb(token, async (sql) => {
      const rows = await sql(
        `UPDATE place_domain
            SET verified_at = now()
          WHERE id = $1
            AND verified_at IS NULL
      RETURNING verified_at AS "verifiedAt"`,
        [id],
      );
      return (rows[0]?.verifiedAt as Date | undefined) ?? new Date();
    });
  } catch (err) {
    console.error(
      "[register-custom-domain] UPDATE verified_at = now() falló para id=",
      id,
      err,
    );
    return new Date();
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
 * Registra un custom domain. Owner-only por RLS. Idempotencia parcial:
 * double-submit → `limit_reached`. Post-addDomain, V6 decide si es
 * genuinamente verified (ADR-0029) antes de persistir `verified_at`.
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

  // Chequeo dual ADR-0029: V9.verified (sticky/ownership) AND
  // !V6.misconfigured (dinámico/DNS). UPDATE verified_at ANTES de la
  // response → DB + response coherentes desde el segundo 0.
  const v6Result = await getDomainConfig(normalized);
  const isGenuinelyVerified =
    vercelResult.data.verified === true &&
    v6Result.ok === true &&
    v6Result.data.misconfigured === false;

  const verifiedAt: Date | null = isGenuinelyVerified
    ? await persistVerifiedAtNow(token, inserted.id)
    : null;

  // DNS records: vacío si verified; sino V6 recommended (shape apex/
  // subdomain idiomático, #110) + V9.verification[] SOLO si trae records
  // reales (challenge TXT pendiente). Polish #110 alinea register con el
  // mismo combine-filter que `decideDomainFlow` (`_v6-helpers.ts`).
  const v9HasChallenge = vercelResult.data.dnsRecords.length > 0;
  const v9Records: DnsRecord[] = v9HasChallenge
    ? vercelRecordsToDnsRecords(vercelResult.data.dnsRecords)
    : [];
  const v6Records: DnsRecord[] =
    !isGenuinelyVerified && v6Result.ok
      ? v6ConfigToDnsRecords(v6Result.data, normalized)
      : [];
  const dnsRecords: DnsRecord[] = isGenuinelyVerified
    ? []
    : [...v9Records, ...v6Records];

  revalidatePath(`/place/${placeSlug}/settings/domain`);

  const record: CustomDomainRecord = {
    id: inserted.id,
    domain: inserted.domain,
    verifiedAt,
    createdAt: inserted.createdAt,
  };

  return { status: "ok", record, dnsRecords };
}
