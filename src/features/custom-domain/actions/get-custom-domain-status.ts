import { getAuthenticatedDb } from "@/shared/lib/db";
import { requireSessionJwt } from "@/shared/lib/session";
import { getDomainStatus } from "@/shared/lib/vercel";
import {
  type CustomDomainRecord,
  type CustomDomainState,
  type DnsRecord,
} from "../types/custom-domain";

// Lazy verification helper del feature custom-domain V1 (ADR-0026 §1).
//
// NO es Server Action ("use server" omitido intencionalmente): se invoca
// directo desde el Server Component del page `/settings/domain`. Esto le
// permite al page mantener el server-side rendering coherente (sin barreras
// de serialización Action-style) y evita el costo de generar un endpoint
// POST internal.
//
// MECANISMO LAZY (ADR-0026 alternativa elegida vs cron continuo):
//
//   En cada carga del page, si la fila tiene `verified_at IS NULL` se
//   re-consulta a Vercel. Si Vercel confirma verified, persistimos en DB
//   (`UPDATE place_domain SET verified_at = now()`). Esto elimina la
//   necesidad de un cron permanente: el owner que vuelve al page después
//   de configurar el DNS ve el estado actualizado inmediatamente sin
//   esperar el próximo tick. El cron de V1.1 (S6 opcional, diferible) es
//   safety-net para owners que NUNCA vuelven al page — caso raro V1.
//
// ESTADO `vercelUnavailable`:
//
//   Si Vercel falla (red, 5xx, rate limit) y la fila estaba pending,
//   retornamos `{status: "pending", dnsRecords: null, vercelUnavailable:
//   true}`. La UI muestra notice calmo "estamos verificando, intentaremos
//   de nuevo en breve" sin DNS records (los recupera en la próxima
//   carga). Distinto de `dnsRecords: []` que sería "Vercel confirmó cero
//   records pero el dominio sigue pending" (caso teórico, no observable).

// Shape interno crudo del SELECT — camelCase ya aliased en la query.
type ActiveDomainRow = {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

/**
 * SELECT de la fila activa del place. RLS owner-only filtra a 0 rows si
 * el caller no es owner — la UX trata "no autorizado" y "no existe" como
 * el mismo `{status: "none"}`. Retorna `null` ante error de DB (transport,
 * JWT) — UX-equivalente.
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
 * UPDATE `verified_at = now()` cuando Vercel confirma verified. Retorna el
 * timestamp persistido o `null` ante UPDATE flaky (transport / JWT) — el
 * caller usa `new Date()` como fallback y deja que el próximo page-load
 * reintente.
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

/** Mapea los DNS records del wrapper Vercel al shape estricto del slice. */
function vercelRecordsToDnsRecords(
  records: ReadonlyArray<{ type: string; name?: string; value: string; domain?: string }>,
): DnsRecord[] {
  return records.map((r) => ({
    type: r.type,
    name: r.name ?? r.domain ?? "",
    value: r.value,
  }));
}

/**
 * Estado consolidado del custom domain de un place. Llamado por el Server
 * Component del page `/settings/domain`. Atómico desde el punto de vista
 * del page: una invocación realiza (a) SELECT por place_id, (b)
 * potencialmente GET a Vercel, (c) potencialmente UPDATE de `verified_at`,
 * en ese orden.
 *
 * Failure modes:
 *   - Sin sesión vigente → `{status: "none"}`. El page debió haber
 *     redirigido al login antes de invocar; este branch es defense-in-
 *     depth ante races.
 *   - DB error en el SELECT → `{status: "none"}`. UX-equivalente a "el
 *     place no tiene dominio". El próximo refresh re-intenta.
 *   - Vercel falla en pending → `{status: "pending", dnsRecords: null,
 *     vercelUnavailable: true}` con la fila DB. Owner ve copy calmo.
 *   - UPDATE verified_at falla → retornamos `verified` igual (Vercel ya
 *     confirmó). Next page-load reintenta el UPDATE.
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

  if (baseRecord.verifiedAt !== null) {
    return { status: "verified", record: baseRecord };
  }

  const vercelResult = await getDomainStatus(baseRecord.domain);
  if (!vercelResult.ok) {
    return {
      status: "pending",
      record: baseRecord,
      dnsRecords: null,
      vercelUnavailable: true,
    };
  }

  if (vercelResult.data.verified) {
    const persistedAt = (await persistVerifiedAt(token, baseRecord.id)) ?? new Date();
    return {
      status: "verified",
      record: { ...baseRecord, verifiedAt: persistedAt },
    };
  }

  return {
    status: "pending",
    record: baseRecord,
    dnsRecords: vercelRecordsToDnsRecords(vercelResult.data.dnsRecords),
  };
}
