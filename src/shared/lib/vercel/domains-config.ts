import { z } from "zod";
import {
  VERCEL_API_BASE,
  mapStatusToReason,
  readEnvAndHeaders,
  type VercelResult,
} from "./domains-shared";

// Wrapper del endpoint root-scoped `GET /v6/domains/{domain}/config`
// (ADR-0029). Complementa `getDomainStatus` (V9, project-scoped):
//
// - V9 `verified`: bool sticky/append-only. Refleja "ownership
//   challenge completado" — nadie más en Vercel reclama el domain.
//   Una vez true queda true para siempre, no detecta regresiones.
//
// - V6 `misconfigured`: bool dinámico. Refleja "DNS apunta a Vercel
//   AHORA + TLS cert se puede emitir AHORA". Si DNS se rompe en
//   cualquier momento, este campo vuelve a true.
//
// Vercel recomienda explícitamente para multi-tenant chequear ambos
// (`verified && !misconfigured`). El lazy poll de `getCustomDomainStatus`
// usa el AND lógico para decidir si la UI muestra verified o pending.
//
// SHAPE VERIFICADO contra docs Vercel REST 2026-05-22:
// `https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration`
//
// ```json
// {
//   "configuredBy": "CNAME" | "A" | "http" | "dns-01" | null,
//   "acceptedChallenges": ["dns-01" | "http-01"],
//   "recommendedIPv4": [{ "rank": number, "value": string[] }],
//   "recommendedCNAME": [{ "rank": number, "value": string }],
//   "misconfigured": boolean
// }
// ```
//
// NORMALIZACIÓN: el shape oficial es asimétrico — IPv4 items tienen
// `value: string[]` (Vercel anticipa múltiples IPs por record), CNAME
// items tienen `value: string` (un solo target). El wrapper extrae
// solo items con `rank === 1` (los preferidos por Vercel) y aplana
// ambos a `string[]` para que el consumidor no tenga que conocer la
// asimetría. Si no hay items rank=1, retorna `[]` — defensive.
//
// ENDPOINT root-scoped (no lleva `projectId` en path) — Vercel infiere
// el contexto del Bearer token. Aún así pedimos `VERCEL_PROJECT_ID`
// en env por simetría con el resto del wrapper (en práctica si el
// token está, el project ID también).

/**
 * Configuración DNS actual del dominio según Vercel V6. Pieza clave
 * del fix ADR-0029: `misconfigured` detecta DNS-roto en cualquier
 * momento, complementando el `verified` sticky de V9.
 *
 * Campos normalizados:
 * - `configuredBy`: cómo Vercel ve el DNS hoy. `null` significa
 *   "no resuelve a Vercel todavía".
 * - `acceptedChallenges`: tipos de challenge cert disponibles.
 * - `recommendedIPv4`/`CNAME`: aplanado a `string[]` de items rank=1
 *   (preferidos por Vercel). El consumidor los muestra al user
 *   directamente como records que debe configurar en su registrar.
 * - `misconfigured`: false ↔ DNS apunta a Vercel + TLS emisible AHORA.
 */
export type DomainConfig = {
  configuredBy: "A" | "CNAME" | "http" | "dns-01" | null;
  acceptedChallenges: ("dns-01" | "http-01")[];
  recommendedIPv4: string[];
  recommendedCNAME: string[];
  misconfigured: boolean;
};

// ─── Zod schemas ────────────────────────────────────────────────────

/** Item raw de `recommendedIPv4[]` en V6 — `value` es array. */
const RecommendedIPv4ItemSchema = z.object({
  rank: z.number(),
  value: z.array(z.string()),
});

/** Item raw de `recommendedCNAME[]` en V6 — `value` es string. */
const RecommendedCNAMEItemSchema = z.object({
  rank: z.number(),
  value: z.string(),
});

/** Shape raw de `GET /v6/domains/{domain}/config` 200. */
const DomainConfigPayloadSchema = z.object({
  configuredBy: z.enum(["A", "CNAME", "http", "dns-01"]).nullable(),
  acceptedChallenges: z.array(z.enum(["dns-01", "http-01"])),
  recommendedIPv4: z.array(RecommendedIPv4ItemSchema),
  recommendedCNAME: z.array(RecommendedCNAMEItemSchema),
  misconfigured: z.boolean(),
});

// ─── helpers privados ───────────────────────────────────────────────

/**
 * Parsea + normaliza la response raw de V6 a `DomainConfig`. Filtra
 * items por `rank === 1` y aplana `value` a string[] (IPv4: flatMap
 * sobre arrays, CNAME: map sobre strings). Null si Zod falla.
 */
function parseDomainConfigPayload(raw: unknown): DomainConfig | null {
  const parsed = DomainConfigPayloadSchema.safeParse(raw);
  if (!parsed.success) return null;
  const {
    configuredBy,
    acceptedChallenges,
    recommendedIPv4,
    recommendedCNAME,
    misconfigured,
  } = parsed.data;
  return {
    configuredBy,
    acceptedChallenges,
    recommendedIPv4: recommendedIPv4
      .filter((item) => item.rank === 1)
      .flatMap((item) => item.value),
    recommendedCNAME: recommendedCNAME
      .filter((item) => item.rank === 1)
      .map((item) => item.value),
    misconfigured,
  };
}

// ─── API pública ────────────────────────────────────────────────────

/**
 * GET `/v6/domains/{encodedDomain}/config`. Defensive: nunca tira.
 * Errores HTTP → `VercelErrorReason`; network fail → `network`;
 * JSON corrupto o Zod shape inválido → `vercel_error`; env vars
 * missing → `vercel_error`.
 *
 * El lazy poll en `getCustomDomainStatus` (ADR-0029 §1) decide la
 * UX basada en este resultado + el de `getDomainStatus` (V9):
 *
 * | V6 misconfigured | V9 verified | UX |
 * |---|---|---|
 * | false | true | verified, SSL activo |
 * | true | any | pending con `recommendedIPv4`/`CNAME` |
 * | false | false | pending con `verification[]` TXT challenge |
 */
export async function getDomainConfig(
  domain: string,
): Promise<VercelResult<DomainConfig>> {
  const env = readEnvAndHeaders();
  if (!env) return { ok: false, reason: "vercel_error" };

  let response: Response;
  try {
    response = await fetch(
      `${VERCEL_API_BASE}/v6/domains/${encodeURIComponent(domain)}/config`,
      { method: "GET", headers: env.headers },
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    return { ok: false, reason: mapStatusToReason(response.status) };
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = parseDomainConfigPayload(body);
  if (!parsed) return { ok: false, reason: "vercel_error" };
  return { ok: true, data: parsed };
}
