// Helpers + tipos compartidos del wrapper de Vercel Domains REST API.
// Privado al namespace `src/shared/lib/vercel/` — el barrel `./index.ts`
// re-exporta solo los tipos públicos (`VercelResult`, `VercelErrorReason`)
// vía `./domains.ts` y `./domains-config.ts`. Los helpers
// `readEnvAndHeaders` y `mapStatusToReason` NO se re-exportan.
//
// Por qué un archivo separado: el wrapper se divide en V9/V10
// (project-scoped: `addDomain`/`getDomainStatus`/`removeDomain`) y V6
// (root-scoped: `getDomainConfig`, ADR-0029). Para mantener cada
// archivo bajo el cap LOC ≤300, los helpers comunes viven acá.

/** Base URL de la REST API de Vercel — sin trailing slash. */
export const VERCEL_API_BASE = "https://api.vercel.com";

/**
 * Discriminated union de razones de error que el wrapper expone hacia
 * la capa caller (Server Actions). El slice de settings mapea cada
 * razón a copy en español (`docs/features/custom-domain/spec.md`
 * § "Errores enumerados").
 */
export type VercelErrorReason =
  | "not_configured"
  | "unauthorized"
  | "domain_already_in_use"
  | "rate_limited"
  | "vercel_error"
  | "network";

/** Resultado de cualquier llamada al wrapper. Nunca tira. */
export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: VercelErrorReason };

/**
 * Lee `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` del entorno y construye
 * los headers Bearer. Null si falta cualquiera de las dos (defensive:
 * console.error calmo, caller retorna `{ok: false, reason: "vercel_error"}`).
 *
 * Sin caching de módulo: facilita testing con `vi.stubEnv` y evita
 * surprise si rotan en runtime. El endpoint V6 (`getDomainConfig`) no
 * necesita `VERCEL_PROJECT_ID` pero lo exigimos igual por simetría —
 * en práctica si el token está, el project ID también, y reduce
 * superficie de error.
 */
export function readEnvAndHeaders():
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

/**
 * Mapea status code HTTP a `VercelErrorReason`. 401/403 ambos
 * unauthorized (la diferencia semántica no le interesa al consumidor
 * UI). 429 rate_limited. 404 not_configured. Resto (4xx/5xx)
 * vercel_error genérico.
 */
export function mapStatusToReason(status: number): VercelErrorReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_configured";
  if (status === 409) return "domain_already_in_use";
  if (status === 429) return "rate_limited";
  return "vercel_error";
}
