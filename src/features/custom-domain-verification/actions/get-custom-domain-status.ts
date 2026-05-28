import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { log } from "@/shared/lib/observability/log";
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
// AUTH ZONE-AWARE (ADR-0032 §S11.2): los 3 helpers internos
// (`loadActiveDomainRow`, `persistVerifiedAt`, `resetVerifiedAt`) llaman
// `getAuthenticatedDbForRequest` directo — el helper detecta la zona del
// request (apex/subdomain → cookie Neon Auth; custom domain → cookie SSO
// local `__Host-place_sso_session`) y resuelve el token correcto. La
// fail-closed (sin sesión válida) se materializa como `NoSessionError`
// lanzado dentro de `loadActiveDomainRow`; su try/catch lo colapsa a
// `null` que el caller mapea a `{status: "none"}` — UX-equivalente al
// `requireSessionJwt` previo que retornaba el mismo shape.
//
// COSTO: +1 round-trip a V6 por carga del page (~50-150ms). El page es
// low-traffic (owner-only) — aceptable. Si en V2 molesta, cachear V6 con
// TTL corto (ADR-0029 §Alternativas). Adicionalmente cada call a
// `getAuthenticatedDbForRequest` repite resolución de zona + verificación
// JWT: en este path son hasta 3 SQL roundtrips a
// `app.lookup_place_by_domain` (SECURITY DEFINER STABLE, prepared stmt
// cached al pool) + 3 verificaciones JWT (load + persist|reset). Acceptable
// V1 owner-only low-traffic; V1.1 follow-up si telemetría lo demanda:
// memoizar la decision con `React.cache` dentro del helper.

type ActiveDomainRow = {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

/**
 * SELECT de la fila activa del place. RLS owner-only filtra outsiders a
 * 0 rows — UX-equivalente a "no existe". Retorna `null` ante error de DB
 * o `NoSessionError` del helper zone-aware (sin sesión válida): el caller
 * lo mapea a `{status: "none"}`, UX-equivalente al `requireSessionJwt`
 * previo (ADR-0032 §S11.2).
 */
async function loadActiveDomainRow(
  placeId: string,
): Promise<ActiveDomainRow | null> {
  try {
    return await getAuthenticatedDbForRequest(async (sql) => {
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
 * OK. `null` si UPDATE flaky (incluyendo `NoSessionError` improbable si
 * la sesión se cayó entre load y persist) — caller usa `new Date()` como
 * fallback y el próximo page-load reintenta.
 */
async function persistVerifiedAt(id: string): Promise<Date | null> {
  try {
    return await getAuthenticatedDbForRequest(async (sql) => {
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
    log.error(
      err,
      { scope: "get-custom-domain-status", placeDomainId: id },
      "UPDATE verified_at falló",
    );
    return null;
  }
}

/**
 * UPDATE `verified_at = NULL` cuando V6 detecta DNS roto sobre un dominio
 * verified (ADR-0029, decisión #3). Si falla (incluyendo `NoSessionError`
 * improbable post-load), devolvemos pending igual — UX correcta es más
 * importante que atomicidad; reintenta en próximo load.
 */
async function resetVerifiedAt(id: string): Promise<boolean> {
  try {
    return await getAuthenticatedDbForRequest(async (sql) => {
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
    log.error(
      err,
      { scope: "get-custom-domain-status", placeDomainId: id },
      "reset verified_at=NULL falló",
    );
    return false;
  }
}

/** Mapea `DomainFlowDecision` a `CustomDomainState` + side-effects DB. */
async function applyFlowDecision(
  decision: DomainFlowDecision,
  baseRecord: CustomDomainRecord,
): Promise<CustomDomainState> {
  if (decision.kind === "verified_keep" || decision.kind === "verified_fallback") {
    return { status: "verified", record: baseRecord };
  }
  if (decision.kind === "verified_persist") {
    const persistedAt =
      (await persistVerifiedAt(baseRecord.id)) ?? new Date();
    return {
      status: "verified",
      record: { ...baseRecord, verifiedAt: persistedAt },
    };
  }
  if (decision.kind === "verified_reset") {
    await resetVerifiedAt(baseRecord.id);
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
 *
 * Sin `requireSessionJwt` previo: el helper zone-aware
 * (`getAuthenticatedDbForRequest`) detecta la zona del request y lee la
 * cookie correcta. `NoSessionError` se materializa dentro de
 * `loadActiveDomainRow`, su catch lo colapsa a `null` y el caller mapea
 * a `{status: "none"}` — UX-equivalente al retorno previo
 * (ADR-0032 §S11.2).
 */
export async function getCustomDomainStatus(
  placeId: string,
): Promise<CustomDomainState> {
  const row = await loadActiveDomainRow(placeId);
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

  return await applyFlowDecision(decision, baseRecord);
}
