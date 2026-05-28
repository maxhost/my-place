import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { log } from "@/shared/lib/observability/log";

import { RATE_LIMITS } from "./config";
import type { RateLimitKind, RateLimitResult } from "./types";

// Wrapper sobre `@upstash/ratelimit` + Upstash Redis (Phase 0.D). API pública
// minimal: `enforceRateLimit(kind, identifier)`. Una sola export-fn cubre los
// 6 callers (Server Actions + route handlers).
//
// ## Behavior por entorno (decisión Sesión 0.D)
//
// - **Production (`NODE_ENV === "production"`) sin creds Upstash** → throw al
//   startup. NO permitimos deploy silencioso sin rate limit (fail-loud). El
//   crash bloquea el deploy → operador NOTA + setea creds + re-deploy.
// - **Dev/local sin creds** → skip + log.warn 1× al startup. Local sigue
//   funcionando sin Upstash account (developer ergonomics).
// - **Cualquier entorno con creds** → enforce normal via Upstash sliding window.
//
// ## Singleton + lazy init
//
// `Ratelimit` instances son caras de crear (cada una abre cliente Redis).
// Inicializamos lazy en el primer call + cache en módulo-scope. El cliente
// Redis es 1 (compartido entre todos los limiters), las instances Ratelimit
// son 1 por `RateLimitKind`.
//
// ## Failure modes runtime
//
// Si Upstash tiene un blip transitorio mid-request (network, throttle), el
// SDK `@upstash/ratelimit` retorna `success: true` por default — fail-open
// per-request. Trade-off explícito: bajo ataque preferimos rechazar legit
// users por unos segundos vs dejar pasar atacante; bajo blip transitorio
// preferimos no romper login para legit users. La decisión del SDK upstream
// es razonable para nuestro threat model V1.
//
// ## Identifier convention
//
// Caller arma `<kind>:<identifier>` (e.g. `login:1.2.3.4`). El módulo
// internamente prefija `place:rl:` para no colisionar con otros consumidores
// del mismo Redis (si lo hubiera, e.g. compartir con BotID en V2).

const UPSTASH_URL_ENV = "UPSTASH_REDIS_REST_URL";
const UPSTASH_TOKEN_ENV = "UPSTASH_REDIS_REST_TOKEN";

let limitersCache: Record<RateLimitKind, Ratelimit> | "skipped" | null = null;

/**
 * Inicializa (lazy + idempotente) los limiters Upstash. Retorna `"skipped"`
 * cuando no hay creds en dev (warn 1×). Throws en prod sin creds.
 */
function ensureLimiters(): Record<RateLimitKind, Ratelimit> | "skipped" {
  if (limitersCache !== null) return limitersCache;

  const url = process.env[UPSTASH_URL_ENV];
  const token = process.env[UPSTASH_TOKEN_ENV];
  const isProd = process.env.NODE_ENV === "production";

  if (url === undefined || url === "" || token === undefined || token === "") {
    if (isProd) {
      throw new Error(
        `[rate-limit] Missing ${UPSTASH_URL_ENV} or ${UPSTASH_TOKEN_ENV} in production. ` +
          `Rate limiting cannot be enforced without Upstash credentials. ` +
          `Configure them in Vercel env vars (Production + Preview scopes). ` +
          `See docs/stack.md §"Variables de entorno".`,
      );
    }
    log.warn(
      { scope: "rate-limit" },
      `${UPSTASH_URL_ENV}/${UPSTASH_TOKEN_ENV} not set — skipping rate limits in dev. ` +
        `Set them in .env.local to test enforcement locally.`,
    );
    limitersCache = "skipped";
    return limitersCache;
  }

  const redis = new Redis({ url, token });
  const entries = Object.entries(RATE_LIMITS).map(([kind, cfg]) => {
    const instance = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(cfg.tokens, cfg.window),
      prefix: "place:rl",
      analytics: false,
    });
    return [kind, instance] as const;
  });
  limitersCache = Object.fromEntries(entries) as Record<RateLimitKind, Ratelimit>;
  return limitersCache;
}

/**
 * Chequea + consume 1 token para el `identifier` bajo el bucket `kind`.
 * Retorna `RateLimitResult` discriminated:
 *   - `{mode: "skipped", success: true}` → dev sin creds.
 *   - `{mode: "enforced", success: true}` → request permitida.
 *   - `{mode: "enforced", success: false}` → request bloqueada, `resetAt` tiene
 *      el unix-ms del próximo reset.
 *
 * El caller decide UX del bloqueo: route handler retorna 429 con `Retry-After`
 * header; Server Action retorna `{status: "rate_limited"}` y la UI muestra
 * mensaje calmo.
 */
export async function enforceRateLimit(
  kind: RateLimitKind,
  identifier: string,
): Promise<RateLimitResult> {
  const limiters = ensureLimiters();
  if (limiters === "skipped") {
    return { mode: "skipped", success: true };
  }
  const limiter = limiters[kind];
  const res = await limiter.limit(`${kind}:${identifier}`);
  if (res.success) {
    return {
      mode: "enforced",
      success: true,
      remaining: res.remaining,
      resetAt: res.reset,
    };
  }
  return {
    mode: "enforced",
    success: false,
    remaining: 0,
    resetAt: res.reset,
  };
}

/**
 * Reset de cache — sólo para tests, que necesitan re-inicializar entre cases
 * con distinto env. NO usar en código de producción.
 */
export function _resetLimitersCacheForTests(): void {
  limitersCache = null;
}

export { getRequestIp, parseForwardedIp } from "./get-request-ip";
export type { RateLimitKind, RateLimitResult } from "./types";
