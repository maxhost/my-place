import {
  NoSessionError,
  getAuthenticatedDbForRequest,
} from "@/shared/lib/db-for-request";
import { lookupUserIdentityById } from "@/shared/lib/user-identity-by-id-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix.3 (ADR-0046 §"Addendum
// operacional — Sesión D.fix.3", 2026-05-27). Helper UNIFICADO (Server Action
// + RSC) zone-aware para resolver la identidad mínima (`{authUserId, email,
// displayName}`) del user de la sesión vigente. Supersede al integrator de
// D.fix.1 `getCurrentUserEmailForRequest`: este es estrictamente más
// expresivo (email + displayName + authUserId) sin overhead extra (mismo
// coordinator pass, payload jsonb en lugar de text escalar).
//
// ## Por qué existe (bug B confirmado smoke V1.2 Sesión D)
//
// Smoke matriz 2x2 V1.2 2026-05-27 reveló bug B: en place CON custom domain,
// el invite page render OK (D.fix.2 cerró el reader RSC), pero al hacer
// click en "Aceptar invitación" → action retorna "Algo salió mal". Causa
// raíz: `acceptInvitationAction` (`src/features/invitations/actions/accept-
// invitation.ts:66-71`) lee identidad via `getAuth().getSession()` que SOLO
// lee la cookie cross-subdomain `Domain=.place.community` — NO la cookie
// local SSO `__Host-place_sso_session`. En custom domain → SDK retorna
// sesión vacía → action retorna `unauthenticated`.
//
// Mismo gap arquitectónico que D.fix.1 cerró para el reader RSC, ahora
// replicado en una Server Action que ejecuta desde custom domain. Path A
// retroactiva: en lugar de un parche local en la action, abrimos un
// integrator UNIFICADO que cualquier caller (RSC o Action) puede usar — y
// supersedemos el helper email-only de D.fix.1.
//
// ## Por qué `{authUserId, email, displayName}`
//
// Shape que cubre los 2 callsites V1.2 + es genérico para futuros:
//   - `acceptInvitationAction`: necesita `email` + `displayName` para
//     `ensureAppUser`, y `authUserId` para invocar `app.accept_invitation
//     (token, sub)`. Antes leía `email` + `displayName` desde Neon Auth SDK
//     y `authUserId` desde `claims.sub` del coordinator — 2 fuentes. Ahora 1
//     sola (este integrator + coordinator del action).
//   - `invite/[token]/page.tsx` RSC: necesita SÓLO `email` para el match
//     check pre-action. Lee `.email` y descarta el resto — overhead nulo.
//
// `displayName` = `name` raw de `neon_auth.user` (NO se aplica fallback acá).
// El fallback `displayName.trim() || ident.email.split("@")[0]` vive en
// `ensureAppUser` (`shared/lib/ensure-app-user.ts`), paridad con el callsite
// pre-D.fix que también delegaba el fallback al `ensureAppUser`.
//
// ## Fix arquitectónico (no parche)
//
// Versión RSC+Action del coordinator `getAuthenticatedDbForRequest` (ADR-0034
// zone-aware DB): abstrae el split apex/local del lookup de identidad sin
// obligar al caller a saber en qué zona corre. El coordinator detecta
// `HostZone`, lee la cookie correcta (Neon Auth cookie en apex/subdomain/
// inbox; SSO local cookie en custom domain), abre tx autenticada con claims
// tx-local, y nos pasa `claims.sub` al callback. Acá invocamos el DEFINER
// específico `app.lookup_user_identity_by_id(sub)` (migration 0024) via el
// wrapper PURE `lookupUserIdentityById`.
//
// El email + name viven en `neon_auth.user` (managed por Neon Auth, NO en
// `public.app_user` — esta última no existe pre-accept del invite, ver
// gotcha `accept-invitation-requires-ensure-app-user-tx1.md`). El DEFINER
// expone SÓLO email + name — defense-in-depth vs GRANT amplio.
//
// ## Continuidad RLS / continuidad de identidad
//
// `claims.sub` retorna el MISMO valor en custom domain que en apex (ADR-0032
// §6): el `sub` del local session JWT === `sub` del Neon Auth JWT que el
// apex verificó en `sso-issue`. Cero refactor de policies; el lookup matchea
// la misma row en `neon_auth.user` independientemente de la zona origen.
//
// ## Fail semantics
//
// 2 modos por separación de concerns:
//   - `getCurrentUserIdentityForRequest()` (este export): fail-soft a `null`
//     para cualquier error (NoSessionError, DB transport, drift de schema,
//     payload Zod inválido). Pensado para callers que tratan "sin identidad"
//     == flujo legítimo (RSC reader del invite page → variant "unauth").
//   - `requireCurrentUserIdentityForRequest()` (helper sibling, futuro):
//     no se exporta acá porque NO hay caller V1.2 que lo necesite —
//     `acceptInvitationAction` usa fail-soft + mapea `null` →
//     `unauthenticated` en el discriminated union de su return type. Si
//     futura feature necesita fail-throw, se agrega como sibling.
//
// **Importante**: este helper NO es testeable vitest (seam-split canon —
// cruza `next/headers` + Neon Auth SDK + DB via coordinator). Cobertura:
//   - DEFINER tests integration: `src/db/__tests__/lookup-user-identity-by-id.test.ts`
//   - Wrapper TS tests vitest: `src/shared/lib/__tests__/user-identity-by-id-lookup.test.ts`
//   - Coordinator decision tests (puro): `src/shared/lib/__tests__/db-for-request-decision.test.ts`
//   - Este integrator: validado por smoke E2E V1.2 Sesión D.fix.3 (matriz 2x2).

export type CurrentUserIdentity = {
  authUserId: string;
  email: string;
  displayName: string;
};

export async function getCurrentUserIdentityForRequest(): Promise<CurrentUserIdentity | null> {
  try {
    return await getAuthenticatedDbForRequest(async (sql, claims) => {
      const identity = await lookupUserIdentityById(sql, claims.sub);
      if (identity === null) return null;
      return {
        authUserId: claims.sub,
        email: identity.email,
        displayName: identity.name,
      };
    });
  } catch (err) {
    // NoSessionError = visitor anónimo o sesión vencida → caller decide
    // (RSC reader: variant "unauth"; Server Action: `unauthenticated` code).
    // Otros errores (DB transport, drift de schema, JWT verifier fallido) =
    // degradación silenciosa al mismo null, paridad con el pattern fail-soft
    // de `getCurrentUserEmailForRequest` (D.fix.1).
    if (err instanceof NoSessionError) return null;
    return null;
  }
}
