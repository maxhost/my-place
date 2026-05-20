import { getAuth } from "./auth";

// Sesión del request: helpers compartidos para obtener el JWT JWKS-verificable
// de la sesión vigente. Extraído de `features/place-creation/actions.ts` (S5
// del Hub) porque ahora hay dos consumers con semántica distinta:
//
// - **`getSessionJwt`** (S5b: page del Hub) → `Promise<string | null>`.
//   El page del Hub usa el resultado como guard: `null` = no logueado →
//   redirect cross-subdomain al login del apex. NO lanza ante ausencia de
//   sesión (es estado legítimo del flujo); SÍ propaga excepciones del SDK
//   (transport / fallo inesperado), porque ahí algo está roto.
//
// - **`requireSessionJwt`** (Server Actions autenticados, e.g. el wizard
//   create authed) → `Promise<string>`, fail-closed: lanza si no hay sesión.
//   Equivalente exacto al patrón previo de place-creation — sin cambio de
//   comportamiento para sus callers.
//
// Wrapper del SDK Neon Auth → la correctitud del wiring vivo es tipo/build +
// preview Vercel (no vitest-testeable, arrastra `next/headers` + Neon Auth).
// Mismo trato que el resto de wrappers del SDK en `shared/lib/auth.ts` y los
// helpers eliminados de `place-creation/actions.ts`.

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

/**
 * JWT requerido para Server Actions autenticados: retorna `string` o lanza
 * si no hay sesión. Fail-closed para que el caller NO llegue a la DB sin
 * identidad verificable.
 */
export async function requireSessionJwt(): Promise<string> {
  const token = await getSessionJwt();
  if (token === null) {
    throw new Error("Neon Auth no devolvió JWT (sin sesión vigente)");
  }
  return token;
}
