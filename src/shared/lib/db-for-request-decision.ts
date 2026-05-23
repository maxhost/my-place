import type { HostZone } from "@/shared/lib/host-routing";
import { LOCAL_SESSION_COOKIE_NAME } from "@/shared/lib/sso";

// Feature C · S11.2.A · pure decision helper: parte vitest-testeable de
// `db-for-request.ts`. Split estructural sobre seam-split del codebase
// (canon en `update-default-locale.ts:13`): el integrador async importa
// `next/headers` + Neon Auth SDK → no vitest-testeable; este módulo NO
// importa nada de eso → sí.
//
// Mismo precedente que `host-routing.ts` (puro) vs `_lib/get-place-for-
// zone.ts` (impuro, consumer): el puro se reusa desde el impuro + tests.
//
// Nota: `LOCAL_SESSION_COOKIE_NAME` se importa del barrel `sso/`, que es
// puro a este nivel (la constante es solo un string literal del módulo
// `sso-session.ts`). El barrel completo tira import-chain a Neon Auth solo
// si algún consumer toca verifiers async — `LOCAL_SESSION_COOKIE_NAME`
// como literal export NO los activa.

/**
 * Resultado de la decisión PURA del branch de auth. Discriminado por `kind`
 * para que el integrador haga exhaustive switching.
 *
 * - `'sso-local'`: el host es custom domain y hay cookie host-only presente.
 *   `token` se pasa a `verifyLocalSession({token, expectedHost})`. `expected
 *   Host` se reusa para el check `host` claim post-verify.
 * - `'neon-auth-needed'`: el host NO es custom domain (apex/subdomain/inbox/
 *   marketing). El integrador debe llamar `getSessionJwt()` para obtener el
 *   token Neon Auth (async, SDK call). Si retorna `null` → `NoSessionError`.
 * - `'no-session'`: el host es custom domain pero la cookie SSO está ausente
 *   o vacía. El integrador tira `NoSessionError` directo (no tiene sentido
 *   intentar Neon Auth en custom domain — su cookie no existe ahí).
 */
export type AuthBranchDecision =
  | { kind: "sso-local"; token: string; expectedHost: string }
  | { kind: "neon-auth-needed" }
  | { kind: "no-session" };

/**
 * Mínima superficie de `cookies()` que el helper consume: solo `.get(name)`.
 * Estructural por design para que los tests usen un mock simple sin importar
 * `ReadonlyRequestCookies` de Next.
 */
export interface CookieJarLike {
  get: (name: string) => { value: string } | undefined;
}

/**
 * Función PURA que decide qué branch aplicar. Sin efectos: dado `HostZone`
 * + cookies del request + host actual → la decisión.
 *
 * No normaliza el host: la responsabilidad es del integrador
 * (`getAuthenticatedDbForRequest` hace lowercase + trim de puerto). El
 * `expectedHost` se pasa verbatim al verifier — `verifyLocalSession` chequea
 * `host` claim === expectedHost con strict equality.
 */
export function decideAuthBranch(
  hostZone: HostZone,
  cookieJar: CookieJarLike,
  expectedHost: string,
): AuthBranchDecision {
  if (hostZone.zone !== "custom-domain") {
    return { kind: "neon-auth-needed" };
  }
  const cookie = cookieJar.get(LOCAL_SESSION_COOKIE_NAME);
  const value = cookie?.value;
  if (!value || value.length === 0) {
    return { kind: "no-session" };
  }
  return { kind: "sso-local", token: value, expectedHost };
}

/**
 * Error fail-closed cuando no hay sesión vigente. Server Actions catchean
 * y retornan `{status: 'error'}` (mismo trato UX que cualquier otro fallo
 * de auth — el page del settings ya redirige al login si la sesión expiró
 * entre render del form y submit). No discrimina causa para no doxxear
 * (`no-session` custom-domain vs `null` Neon Auth) — UX-equivalente.
 */
export class NoSessionError extends Error {
  constructor() {
    super("Sin sesión vigente para el host actual");
    this.name = "NoSessionError";
  }
}
