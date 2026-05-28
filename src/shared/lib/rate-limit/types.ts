// SoT de tipos del módulo `rate-limit/` (Phase 0.D — wrapper sobre
// `@upstash/ratelimit` + Upstash Redis serverless). El módulo expone una
// API minimal estable: `enforceRateLimit(kind, identifier)` + `getRequestIp()`.
//
// Discriminated union `RateLimitResult` permite a callers (Server Actions,
// route handlers) distinguir 3 estados:
//   - `enforced` con `success: true` → limiter activo, request OK.
//   - `enforced` con `success: false` → limiter activo, request DENEGADA.
//   - `skipped` → dev sin creds, no se enforció (warn loggeado al startup).
//
// `RateLimitKind` enumera los endpoints rate-limited (config en `config.ts`).
// Agregar un nuevo kind requiere: (a) entry en `RATE_LIMITS` (config.ts),
// (b) wiring del caller, (c) test de smoke. NO requiere re-deploy de wrapper.

export type RateLimitKind =
  | "login"
  | "signup"
  | "accept_invitation"
  | "create_invitation"
  | "sso_init"
  | "sso_issue";

export type RateLimitResult =
  | {
      mode: "enforced";
      success: true;
      remaining: number;
      /** Unix ms del próximo reset de la ventana. */
      resetAt: number;
    }
  | {
      mode: "enforced";
      success: false;
      remaining: 0;
      /** Unix ms del próximo reset de la ventana — cuánto esperar. */
      resetAt: number;
    }
  | {
      /** Dev/local sin creds Upstash — request permitida silently. */
      mode: "skipped";
      success: true;
    };
