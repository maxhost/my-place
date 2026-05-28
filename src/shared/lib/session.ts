import { getAuth } from "./auth";

// Sesión del request: helper compartido para obtener el JWT JWKS-verificable
// de la sesión vigente Neon Auth (apex/subdomain/inbox). Único consumer
// vivo: `db-for-request.ts:getAuthenticatedDbForRequest` (rama `neon-auth-
// needed` del coordinator zone-aware, ADR-0034). Server Actions y RSC
// pasan por el coordinator — NO leen directamente este helper.
//
// El page del Hub (S5b de Inbox V1) lo usa como guard de redirect: `null` =
// no logueado → redirect cross-subdomain al login del apex. NO lanza ante
// ausencia de sesión (estado legítimo); SÍ propaga excepciones del SDK
// (transport / fallo inesperado), porque ahí algo está roto.
//
// Wrapper del SDK Neon Auth → la correctitud del wiring vivo es tipo/build +
// preview Vercel (no vitest-testeable, arrastra `next/headers` + Neon Auth).
// Mismo trato que el resto de wrappers del SDK en `shared/lib/auth.ts`.
//
// Phase 1.B — se dropeó `requireSessionJwt` (Promise<string>, fail-throw):
// su único caller (`features/place-creation/actions.ts`) migró al coordinator
// zone-aware. Si en el futuro un Server Action necesita el JWT crudo, debe
// pasar por `getAuthenticatedDbForRequest` (consistencia ADR-0034) y no
// reintroducir el patrón de leer token directo.

// El SDK tipa `auth.token()` con `fetchOptions?: any` y devuelve `{ data, error }`
// (`fetchOptions.throw:false` en el adapter). La forma exacta es del SDK; la
// leemos defensivamente y centralizamos la "es JWT válido" en un solo lugar.
type SessionJwtResult = {
  data?: { token?: string | null } | null;
  error?: { status?: unknown; message?: string } | null;
};

/**
 * JWT JWKS-verificable de la sesión vigente o `null` si no hay sesión.
 *
 * Apto para guards en Server Components: el caller decide redirect vs
 * continuar. Solo propaga excepciones del SDK (error de transport o estado
 * inesperado del adapter); el caso "no logueado" → `null`.
 */
export async function getSessionJwt(): Promise<string | null> {
  const res = (await (
    getAuth() as unknown as {
      token: (fetchOptions?: unknown) => Promise<SessionJwtResult>;
    }
  ).token()) as SessionJwtResult;
  const token = res.data?.token;
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  return token;
}
