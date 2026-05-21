import { z } from "zod";

// Wrapper de Vercel Domains REST API consumido por el slice
// `place-settings/domain` (custom-domain V1, ADR-0026).
//
// QUÉ: 3 funciones (`addDomain`, `getDomainStatus`, `removeDomain`) que
// encapsulan POST `/v10/projects/{id}/domains`, GET y DELETE
// `/v9/projects/{id}/domains/{domain}`. Toda función retorna una
// discriminated union `VercelResult<T>` — nunca tira: la capa caller
// (Server Actions S3, Server Component S4) ramifica por `result.ok` y
// mapea `reason` a copy en español (`docs/features/custom-domain/spec.md`
// § "Errores enumerados"). Cero estado de polling acá; el lazy poll en
// page-load (ADR-0026 §1) decide cuándo llamar y persiste el resultado.
//
// POR QUÉ wrapper y no SDK: el SDK `@vercel/sdk` arrastra dependencias
// de Node + tipos que tapan reasons de error que nosotros sí queremos
// distinguir (404 vs 409 vs 422). El surface real son 3 endpoints; un
// `fetch` directo con Zod parsing es 200 LOC y mantiene control del
// error mapping. El barrel `./index.ts` re-exporta `*` desde acá.
//
// SHAPE VERIFICADO contra docs Vercel REST 2026-05-21:
// - POST `/v10/projects/{idOrName}/domains` — body `{name}` requerido,
//   200 retorna `{name, apexName, projectId, verified, verification[],
//   createdAt, updatedAt, ...}`. `verification[]` items requieren
//   `{type, domain, value, reason}` (todos string). Errores: 400
//   (validación), 401 (auth), 402 (payment), 403 (perm), 409
//   (already in use).
// - GET `/v9/projects/{idOrName}/domains/{domain}` — 200 con mismo
//   shape que POST 200. 400, 401, 403 documentados; 404 no aparece en
//   docs pero observable en producción cuando el domain no existe en
//   el proyecto, por lo que lo mapeamos a `not_configured` igual.
// - DELETE `/v9/projects/{idOrName}/domains/{domain}` — 200 retorna
//   objeto vacío `{}`. Tipamos `data: {uid?: string}` como
//   forward-compat por si Vercel agrega el campo (algunos endpoints
//   relacionados de Domains lo devuelven). 400, 401, 403, 404, 409.
//
// ENV: lee `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` en cada llamada
// (sin caching de módulo: facilita testing con `vi.stubEnv` y evita
// surprise si rotan en runtime). Si falta cualquiera de las dos:
// `console.error` calmo + retorna `{ok: false, reason: "vercel_error"}`.
// El wrapper es defensivo: nunca tira por configuración faltante.

/** Record DNS que Vercel devuelve en `verification[]` cuando el domain está pending. */
export type DnsRecord = {
  type: string;
  /**
   * Vercel emite los DNS records dentro de `verification[]` con la clave
   * `domain` (host completo del record). Exponemos también `name` como
   * alias del mismo valor para que la UI no tenga que conocer el
   * vocabulario interno de Vercel (los componentes de tabla DNS usan
   * `name`/`type`/`value` típicamente).
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

export type VercelErrorReason =
  | "not_configured"
  | "unauthorized"
  | "domain_already_in_use"
  | "rate_limited"
  | "vercel_error"
  | "network";

export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: VercelErrorReason };

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
 * `verified=true`); `apexName`/`projectId` no los consumimos pero los
 * declaramos como passthrough no requerido — `z.object` por default
 * acepta keys extra sin validar.
 */
const DomainPayloadSchema = z.object({
  name: z.string(),
  verified: z.boolean(),
  verification: z.array(VerificationSchema).optional(),
});

const RemovePayloadSchema = z.object({
  uid: z.string().optional(),
});

// ─── helpers ────────────────────────────────────────────────────────

const VERCEL_API_BASE = "https://api.vercel.com";

/** Lee env vars y construye headers Bearer. Null si falta cualquiera. */
function readEnvAndHeaders():
  | { token: string; projectId: string; headers: Record<string, string> }
  | null {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    console.error(
      "[vercel] VERCEL_API_TOKEN o VERCEL_PROJECT_ID ausente — wrapper retorna vercel_error",
    );
    return null;
  }
  return {
    token,
    projectId,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
}

/** Mapea status code HTTP a `VercelErrorReason`. */
function mapStatusToReason(status: number): VercelErrorReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_configured";
  if (status === 409) return "domain_already_in_use";
  if (status === 429) return "rate_limited";
  return "vercel_error";
}

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
 * verified, populated si pending). Mapea errores HTTP a
 * `VercelErrorReason`. No tira: errores de red → `network`; parse Zod
 * fallido → `vercel_error`.
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
 * shape de response que `addDomain` 200. Lo consume el lazy poll del
 * Server Component en cada carga del `/settings/domain` mientras
 * `verified_at IS NULL` (ADR-0026 §1).
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
      { method: "GET", headers: env.headers },
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
      { method: "DELETE", headers: env.headers },
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
