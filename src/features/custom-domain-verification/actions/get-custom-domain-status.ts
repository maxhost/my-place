import { getAuthenticatedDb } from "@/shared/lib/db";
import { requireSessionJwt } from "@/shared/lib/session";
import { getDomainConfig, getDomainStatus } from "@/shared/lib/vercel";
import {
  type CustomDomainRecord,
  type CustomDomainState,
} from "@/features/custom-domain/public";
import { decideDomainFlow, type DomainFlowDecision } from "./_v6-helpers";

// Lazy verification del feature custom-domain V1 (ADR-0026 §1) refinado
// por ADR-0029 (chequeo dual V9 + V6).
//
// NO es Server Action ("use server" omitido intencionalmente): se invoca
// directo desde el Server Component del page `/settings/domain`.
//
// MECANISMO LAZY DUAL: V9 `verified` es sticky/ownership; V6
// `misconfigured` es dinámico/DNS. Vercel multi-tenant pattern oficial:
// `verified && !misconfigured`. En cada carga corremos SIEMPRE V6; V9
// sólo cuando `verified_at IS NULL`. La decisión consolidada vive en
// `decideDomainFlow` (`./_v6-helpers.ts`, pura testeable).
//
// COSTO: +1 round-trip a V6 por carga del page (~50-150ms). El page es
// low-traffic (owner-only) — aceptable. Si en V2 molesta, cachear V6 con
// TTL corto (ADR-0029 §Alternativas).

type ActiveDomainRow = {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

/**
 * SELECT de la fila activa del place. RLS owner-only filtra outsiders a
 * 0 rows — UX-equivalente a "no existe". Retorna `null` ante error de DB.
 */
async function loadActiveDomainRow(
  token: string,
  placeId: string,
): Promise<ActiveDomainRow | null> {
  try {
    return await getAuthenticatedDb(token, async (sql) => {
      const rows = await sql(
        `SELECT id,
                domain,
                verified_at AS "verifiedAt",
                created_at  AS "createdAt"
           FROM place_domain
          WHERE place_id = $1
            AND archived_at IS NULL
          LIMIT 1`,
        [placeId],
      );
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id as string,
        domain: r.domain as string,
        verifiedAt: (r.verifiedAt as Date | null) ?? null,
        createdAt: r.createdAt as Date,
      };
    });
  } catch {
    return null;
  }
}

/**
 * UPDATE `verified_at = now()` cuando V9 confirma ownership y V6 dice DNS
 * OK. `null` si UPDATE flaky — caller usa `new Date()` como fallback y
 * el próximo page-load reintenta.
 */
async function persistVerifiedAt(
  token: string,
  id: string,
): Promise<Date | null> {
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
      return (rows[0]?.verifiedAt as Date | undefined) ?? null;
    });
  } catch (err) {
    console.error(
      "[get-custom-domain-status] UPDATE verified_at falló para id=",
      id,
      err,
    );
    return null;
  }
}

/**
 * UPDATE `verified_at = NULL` cuando V6 detecta DNS roto sobre un dominio
 * verified (ADR-0029, decisión #3). Si falla, devolvemos pending igual —
 * UX correcta es más importante que atomicidad; reintenta en próximo load.
 */
async function resetVerifiedAt(token: string, id: string): Promise<boolean> {
  try {
    return await getAuthenticatedDb(token, async (sql) => {
      const rows = await sql(
        `UPDATE place_domain
            SET verified_at = NULL
          WHERE id = $1
            AND verified_at IS NOT NULL
      RETURNING id`,
        [id],
      );
      return rows.length > 0;
    });
  } catch (err) {
    console.error(
      "[get-custom-domain-status] reset verified_at=NULL falló para id=",
      id,
      err,
    );
    return false;
  }
}

/** Mapea `DomainFlowDecision` a `CustomDomainState` + side-effects DB. */
async function applyFlowDecision(
  decision: DomainFlowDecision,
  baseRecord: CustomDomainRecord,
  token: string,
): Promise<CustomDomainState> {
  if (decision.kind === "verified_keep" || decision.kind === "verified_fallback") {
    return { status: "verified", record: baseRecord };
  }
  if (decision.kind === "verified_persist") {
    const persistedAt =
      (await persistVerifiedAt(token, baseRecord.id)) ?? new Date();
    return {
      status: "verified",
      record: { ...baseRecord, verifiedAt: persistedAt },
    };
  }
  if (decision.kind === "verified_reset") {
    await resetVerifiedAt(token, baseRecord.id);
    return {
      status: "pending",
      record: { ...baseRecord, verifiedAt: null },
      dnsRecords: decision.dnsRecords,
      wasDownreverted: true,
    };
  }
  // decision.kind === "pending"
  return {
    status: "pending",
    record: baseRecord,
    dnsRecords: decision.dnsRecords,
    vercelUnavailable: decision.vercelUnavailable ? true : undefined,
  };
}

/**
 * Estado consolidado del custom domain de un place. Atómico desde el
 * page: SELECT → V6 SIEMPRE → V9 si verifiedAt NULL → UPDATE (persist o
 * reset según decision) → return state.
 */
export async function getCustomDomainStatus(
  placeId: string,
): Promise<CustomDomainState> {
  let token: string;
  try {
    token = await requireSessionJwt();
  } catch {
    return { status: "none" };
  }

  const row = await loadActiveDomainRow(token, placeId);
  if (row === null) return { status: "none" };

  const baseRecord: CustomDomainRecord = {
    id: row.id,
    domain: row.domain,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  };

  // V6 SIEMPRE: detecta DNS roto incluso si verified_at ya estaba seteado.
  // V9 condicional: sólo si verifiedAt NULL (confirma ownership antes de
  // persistir). Si ya estaba verified, V9 no agrega info útil.
  const v6Result = await getDomainConfig(baseRecord.domain);
  const v9Result =
    baseRecord.verifiedAt === null
      ? await getDomainStatus(baseRecord.domain)
      : null;

  const decision = decideDomainFlow({
    v6: v6Result,
    v9: v9Result,
    verifiedAt: baseRecord.verifiedAt,
    domain: baseRecord.domain,
  });

  return await applyFlowDecision(decision, baseRecord, token);
}
