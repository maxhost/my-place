// Barrel del slice `src/shared/lib/sso/` — primitivos del Signed Ticket
// pattern (ADR-0032). Consumido por:
//   - `/api/auth/sso-jwks/route.ts` (S5) — apex public JWKS.
//   - `/api/auth/sso-issue/route.ts` (S7) — apex ticket issuer.
//   - `/api/auth/sso-init/route.ts`, `/api/auth/sso-redeem/route.ts` (S8)
//     — custom domain init + redeem.
//   - `getSessionTokenForZone` (S9) — bridge a RLS via `db-with-verifier`.
//
// Los imports externos consumen `@/shared/lib/sso`, nunca los archivos
// individuales — libertad para reorganizar internamente sin tocar
// consumers. Sub-cap propio 800 LOC (ADR-0032 §"Organización").

export * from "./db-with-verifier";
export * from "./sso-jti-consume";
export * from "./sso-jwks-fetcher";
export * from "./sso-keys";
export * from "./sso-session";
export * from "./sso-state";
export * from "./sso-ticket";
