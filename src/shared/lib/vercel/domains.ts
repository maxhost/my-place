import { z } from "zod";
import {
  VERCEL_API_BASE,
  VERCEL_FETCH_TIMEOUT_MS,
  mapStatusToReason,
  readEnvAndHeaders,
  type VercelResult,
} from "./domains-shared";

// Wrapper de Vercel Domains REST API consumido por el slice
// `custom-domain` V1 (ADR-0026, ADR-0028).
//
// QUÉ: 3 funciones (`addDomain`, `getDomainStatus`, `removeDomain`) que
// encapsulan POST `/v10/projects/{id}/domains`, GET y DELETE
// `/v9/projects/{id}/domains/{domain}`. Toda función retorna una
// discriminated union `VercelResult<T>` — nunca tira: la capa caller
// (Server Actions S3, Server Component S4) ramifica por `result.ok` y
// mapea `reason` a copy en español (`docs/features/custom-domain/spec.md`
// § "Errores enumerados"). El endpoint V6 `getDomainConfig`
// (`misconfigured` dinámico) vive en `./domains-config.ts` —
// complementario para el lazy poll según ADR-0029.
//
// POR QUÉ wrapper y no SDK: el SDK `@vercel/sdk` arrastra dependencias
// de Node + tipos que tapan reasons de error que nosotros sí queremos
// distinguir (404 vs 409 vs 422). El surface real son 4 endpoints; un
// `fetch` directo con Zod parsing es mantenible y mantiene control del
// error mapping. El barrel `./index.ts` re-exporta `*` desde acá y
// desde `./domains-config.ts`.
//
// SHAPE VERIFICADO contra docs Vercel REST 2026-05-21:
// - POST `/v10/projects/{idOrName}/domains` — body `{name}` requerido,
//   200 retorna `{name, apexName, projectId, verified, verification[],
//   createdAt, updatedAt, ...}`. `verification[]` items requieren
//   `{type, domain, value, reason}` (todos string). Errores: 400, 401,
//   402, 403, 409.
// - GET `/v9/projects/{idOrName}/domains/{domain}` — 200 con mismo
//   shape que POST 200. 400, 401, 403 documentados; 404 observable en
//   producción cuando el domain no existe en el proyecto, lo mapeamos
//   a `not_configured`.
// - DELETE `/v9/projects/{idOrName}/domains/{domain}` — 200 retorna
//   objeto vacío `{}`. Tipamos `data: {uid?: string}` como
//   forward-compat. 400, 401, 403, 404, 409.
//
// SEMÁNTICA del campo `verified` (importante por ADR-0029): refleja
// "ownership challenge completado" — sticky/append-only. NO refleja
// "DNS apunta a Vercel ahora". Para eso usar `getDomainConfig` (V6)
// y chequear `misconfigured`. Vercel pattern oficial multi-tenant:
// `verified && !misconfigured`.

// Re-export del namespace público compartido para que consumers
// externos sigan importando desde `@/shared/lib/vercel`.
export type { VercelErrorReason, VercelResult } from "./domains-shared";

/** Record DNS que Vercel devuelve en `verification[]` cuando el domain está pending. */
export type DnsRecord = {
  type: string;
  /**
   * Vercel emite los DNS records dentro de `verification[]` con la clave
   * `domain` (host completo del record). Exponemos también `name` como
   * alias del mismo valor para que la UI no tenga que conocer el
   * vocabulario interno de Vercel.
   */
  name?: string;
  value: string;
  domain?: string;
  reason?: string;
};

export type DomainStatus = {
  domain: string;
  verified: boolean;
  /** `[]` cuando `verified=true`; populated cuando pending. */
  dnsRecords: DnsRecord[];
};

// ─── Zod schemas ────────────────────────────────────────────────────

/** Item de `verification[]` en POST/GET 200. Todos los campos requeridos. */
const VerificationSchema = z.object({
  type: z.string(),
  domain: z.string(),
  value: z.string(),
  reason: z.string(),
});

/**
 * Shape común de POST `/v10/.../domains` y GET `/v9/.../domains/{domain}`
 * según docs Vercel REST. `verification` es opcional (ausente cuando
 * `verified=true`); `apexName`/`projectId` no los consumimos y se
 * ignoran via `z.object` permisivo por default.
 */
const DomainPayloadSchema = z.object({
  name: z.string(),
  verified: z.boolean(),
  verification: z.array(VerificationSchema).optional(),
});

const RemovePayloadSchema = z.object({
  uid: z.string().optional(),
});

// ─── helpers privados ───────────────────────────────────────────────

/** Normaliza una `verification` item a `DnsRecord` exponiendo `name` = `domain`. */
function verificationToDnsRecord(
  v: z.infer<typeof VerificationSchema>,
): DnsRecord {
  return {
    type: v.type,
    name: v.domain,
    value: v.value,
    domain: v.domain,
    reason: v.reason,
  };
}

/** Parse + map del shape de POST/GET 200 a `DomainStatus`. Null si Zod falla. */
function parseDomainPayload(raw: unknown): DomainStatus | null {
  const parsed = DomainPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { name, verified, verification } = parsed.data;
  return {
    domain: name,
    verified,
    dnsRecords: verified ? [] : (verification ?? []).map(verificationToDnsRecord),
  };
}

// ─── API pública ────────────────────────────────────────────────────

/**
 * POST `/v10/projects/{VERCEL_PROJECT_ID}/domains` body `{name: domain}`.
 * Retorna `DomainStatus` con `verified` y `dnsRecords` (vacío si
 * verified, populated si pending). El campo `verified` en la response
 * refleja ownership (sticky), no DNS actual — ADR-0029 explica por
 * qué el caller debe complementar con `getDomainConfig` (V6).
 */
export async function addDomain(
  domain: string,
): Promise<VercelResult<DomainStatus>> {
  const env = readEnvAndHeaders();
  if (!env) return { ok: false, reason: "vercel_error" };

  let response: Response;
  try {
    response = await fetch(
      `${VERCEL_API_BASE}/v10/projects/${env.projectId}/domains`,
      {
        method: "POST",
        headers: env.headers,
        body: JSON.stringify({ name: domain }),
        signal: AbortSignal.timeout(VERCEL_FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: mapStatusToReason(response.status) };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = parseDomainPayload(body);
  if (!parsed) return { ok: false, reason: "vercel_error" };
  return { ok: true, data: parsed };
}

/**
 * GET `/v9/projects/{VERCEL_PROJECT_ID}/domains/{encodedDomain}`. Mismo
 * shape de response que `addDomain` 200. El lazy poll (ADR-0026 §1) lo
 * consume para chequear el campo `verified` (ownership) y el
 * `verification[]` challenge — pero NO basta solo: ADR-0029 establece
 * que el flow completo incluye también `getDomainConfig` (V6) para
 * detectar `misconfigured` dinámico.
 */
export async function getDomainStatus(
  domain: string,
): Promise<VercelResult<DomainStatus>> {
  const env = readEnvAndHeaders();
  if (!env) return { ok: false, reason: "vercel_error" };

  let response: Response;
  try {
    response = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${env.projectId}/domains/${encodeURIComponent(domain)}`,
      {
        method: "GET",
        headers: env.headers,
        signal: AbortSignal.timeout(VERCEL_FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: mapStatusToReason(response.status) };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = parseDomainPayload(body);
  if (!parsed) return { ok: false, reason: "vercel_error" };
  return { ok: true, data: parsed };
}

/**
 * DELETE `/v9/projects/{VERCEL_PROJECT_ID}/domains/{encodedDomain}`.
 * Best-effort desde la Server Action `archiveCustomDomainAction`
 * (ADR-0026): la fila local pasa a archived sí o sí; el DELETE en
 * Vercel se intenta pero un fallo no rollbackea el archive local.
 * Vercel retorna `{}` en 200 — tipamos `uid?: string` por
 * forward-compat (el campo aparece en endpoints relacionados).
 */
export async function removeDomain(
  domain: string,
): Promise<VercelResult<{ uid?: string }>> {
  const env = readEnvAndHeaders();
  if (!env) return { ok: false, reason: "vercel_error" };

  let response: Response;
  try {
    response = await fetch(
      `${VERCEL_API_BASE}/v9/projects/${env.projectId}/domains/${encodeURIComponent(domain)}`,
      {
        method: "DELETE",
        headers: env.headers,
        signal: AbortSignal.timeout(VERCEL_FETCH_TIMEOUT_MS),
      },
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: mapStatusToReason(response.status) };
  }

  const body: unknown = await response.json().catch(() => ({}));
  const parsed = RemovePayloadSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: true, data: {} };
  return { ok: true, data: parsed.data };
}
