import {
  NoSessionError,
  getAuthenticatedDbForRequest,
} from "@/shared/lib/db-for-request";
import { lookupUserEmailById } from "@/shared/lib/user-email-by-id-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix (ADR-0046 §"Addendum
// operacional — Sesión D", 2026-05-27). Helper RSC zone-aware para resolver
// el email del user de la sesión vigente.
//
// ## Por qué existe (bug E2E V1.2 detectado 2026-05-27)
//
// Smoke matriz 2x2 V1.2 reveló bug: invite flow en place CON custom domain
// completa la cadena SSO chain (init→issue→redeem mintea cookie local en
// `nocodecompany.co`) pero el invite page renderiza variant "unauth" (CTAs
// login/signup) en lugar de variant "match" (CTA Aceptar). Causa raíz:
// `getCurrentUserEmail()` del page (pre-D.fix) usaba `getAuth().getSession()`
// (Neon Auth SDK) que SOLO lee la cookie cross-subdomain `Domain=.place.
// community` — NO la cookie local SSO `__Host-place_sso_session`. En custom
// domain → SDK retorna sesión vacía → email null → render "unauth".
//
// Detalle: gotcha `docs/gotchas/zone-aware-rsc-cookie-source.md` (paralelo a
// `zone-aware-db-cookie-source.md` que cubre el mismo patrón pero scoped a
// Server Actions, no a RSC readers).
//
// ## Fix arquitectónico (no parche)
//
// Versión RSC del coordinator `getAuthenticatedDbForRequest` (ADR-0034 zone-
// aware DB): abstrae el split apex/local del lookup de identidad sin obligar
// al caller a saber en qué zona corre. El coordinator detecta `HostZone`,
// lee la cookie correcta (Neon Auth cookie en apex/subdomain/inbox; SSO local
// cookie en custom domain), abre tx autenticada con claims tx-local, y nos
// pasa `claims.sub` al callback. Acá invocamos el DEFINER específico
// `app.lookup_user_email_by_id(sub)` (migration 0023) via el wrapper PURE
// `lookupUserEmailById`.
//
// El email vive en `neon_auth.user.email` (managed por Neon Auth, NO en
// `public.app_user` — esta última no existe pre-accept del invite, ver
// gotcha `accept-invitation-requires-ensure-app-user-tx1.md`). El DEFINER
// expone SÓLO email (no banned/role/image/createdAt) — defense-in-depth
// vs GRANT amplio.
//
// ## Continuidad RLS / continuidad de identidad
//
// `claims.sub` retorna el MISMO valor en custom domain que en apex (ADR-0032
// §6): el `sub` del local session JWT === `sub` del Neon Auth JWT que el
// apex verificó en `sso-issue`. Cero refactor de policies; el lookup matchea
// la misma row en `neon_auth.user` independientemente de la zona origen.
//
// ## Fail-closed semantics
//
// Cualquier error (NoSession, DB error, sub no encontrado) → `null`. Paridad
// con el callsite original del invite page (`getCurrentUserEmail` pre-D.fix):
// el page renderiza variant "unauth" cuando recibe null — UX coherente con
// el comportamiento pre-V1.2 (visitor anónimo o sesión rota ve CTAs).
//
// **Importante**: este helper NO es testeable vitest (seam-split canon —
// cruza `next/headers` + Neon Auth SDK + DB via coordinator). Cobertura:
//   - DEFINER tests integration: `src/db/__tests__/lookup-user-email-by-id.test.ts`
//   - Wrapper TS tests vitest: `src/shared/lib/__tests__/user-email-by-id-lookup.test.ts`
//   - Coordinator decision tests (puro): `src/shared/lib/__tests__/db-for-request-decision.test.ts`
//   - Este integrator: validado por smoke E2E V1.2 Sesión D.fix.2 (matriz 2x2).

export async function getCurrentUserEmailForRequest(): Promise<string | null> {
  try {
    return await getAuthenticatedDbForRequest((sql, claims) =>
      lookupUserEmailById(sql, claims.sub),
    );
  } catch (err) {
    // NoSessionError = visitor anónimo o sesión vencida → variant "unauth".
    // Otros errores (DB transport, drift de schema, JWT verifier fallido) =
    // degradación silenciosa al mismo variant, paridad con `getCurrentUser
    // Email` del invite page pre-D.fix (`try/catch → return null`).
    if (err instanceof NoSessionError) return null;
    return null;
  }
}
