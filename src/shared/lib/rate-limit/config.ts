import type { RateLimitKind } from "./types";

// Config canónica de límites por endpoint (Phase 0.D). Tabla pura (sin
// dependencias) para que sea testeable y revisable de un solo vistazo.
//
// ## Criterio de thresholds
//
// Cada kind tiene `tokens` por `window`. Conservadores:
//   - Endpoints de auth/anti-brute-force: ventana corta + tokens bajos.
//   - Endpoints de signup/anti-spam: ventana larga + tokens muy bajos
//     (usuario real signupea 1×/vida típica).
//   - Endpoints SSO: ventana corta + tokens moderados (silent SSO chain hace
//     2 GETs por session start; allow legit retries con queda margen).
//   - Endpoint owner-only (createInvitation): ventana larga + tokens
//     generosos (owners legítimos pueden batchear invites).
//
// ## Window format
//
// Strings parseables por `@upstash/ratelimit` (`Duration`): "10 s", "1 m",
// "1 h", "1 d". Validado al startup (Upstash throws si no parsea).
//
// ## Override por env (NO implementado V1)
//
// Si en producción se observa friction excesiva en algún kind, ajustar acá
// y re-deploy. V2 podríamos exponer override por env var — hoy NO es necesario.

export interface RateLimitConfig {
  /** Cantidad de requests permitidas por `window`. */
  tokens: number;
  /** Ventana sliding — formato `@upstash/ratelimit` Duration. */
  window: `${number} ${"s" | "m" | "h" | "d"}`;
}

export const RATE_LIMITS: Record<RateLimitKind, RateLimitConfig> = {
  // Brute force defense: 5 intentos/min/IP. Atacante con script queda en
  // ~5×10⁵ intentos al año, vs ~10⁹ sin rate limit. Ratio crítico.
  login: { tokens: 5, window: "1 m" },

  // Anti-spam signup: 3/h/IP. Usuario legítimo signupea 1×/vida típica;
  // 3/h cubre intentos legítimos por fallos transitorios + tests humanos.
  signup: { tokens: 3, window: "1 h" },

  // Accept invite: usuario legítimo lo hace 1× por invitación. 5/min/IP
  // tolera retries por flaky network sin afectar UX.
  accept_invitation: { tokens: 5, window: "1 m" },

  // Create invite: owner-only via DEFINER + cookie. 30/h/(IP+placeId) tolera
  // batches legítimos del owner (importar lista de 30 emails) sin abrir
  // vector spam (owner comprometido con script lanza 30/h máx, no 10k).
  create_invitation: { tokens: 30, window: "1 h" },

  // SSO init/issue: silent SSO chain hace 1 GET cada uno por session start.
  // 10/min/IP cubre retries + multi-tab simultáneos del mismo user.
  sso_init: { tokens: 10, window: "1 m" },
  sso_issue: { tokens: 10, window: "1 m" },

  // ── S2 hardening post-review 2026-06-11: endpoints de COSTO ──
  // Cada call de los 4 kinds siguientes gasta recursos externos (AI Gateway
  // u API de Vercel) — sin límite, un user autenticado con script amplifica
  // costo sin fricción.

  // Asistencia LLM del wizard: cada call paga tokens del Gateway. 10/h/IP
  // cubre a un owner iterando la descripción varias veces; bloqueado degrada
  // a `unavailable` (la asistencia es opcional, ADR-0005 §5).
  suggest_style: { tokens: 10, window: "1 h" },

  // Creación de place: operación pesada (cuenta + app_user + place + theme).
  // User legítimo crea 1-2 en su vida; 5/h cubre retries por fallos
  // transitorios sin abrir vector de spam de places.
  create_place: { tokens: 5, window: "1 h" },

  // Registro de custom domain: cada call pega a la API de Vercel (addDomain
  // + getDomainConfig) + INSERT. Owner configurando DNS con retries queda
  // holgado con 10/h/IP.
  register_domain: { tokens: 10, window: "1 h" },

  // Lazy poll del page /settings/domain: 2 calls Vercel por carga, y la UI
  // pending auto-refresca cada 30s (2/min/tab). 60/10min/IP tolera 2-3 tabs
  // del mismo owner; bloqueado degrada al notice `vercelUnavailable` calmo
  // sin perder el estado de DB.
  domain_status_poll: { tokens: 60, window: "10 m" },
};
