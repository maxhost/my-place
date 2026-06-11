"use server";

import { getCurrentUserIdentityForRequest } from "@/shared/lib/current-user-identity";
import { getAuthenticatedDbForRequest } from "@/shared/lib/db-for-request";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";
import { type CreatePlaceResult, createPlace } from "./create-place";
import type { AcquireIdentity } from "./ports";

// Server Action de creación de place — los DOS modos de ADR-0008. Es el
// wiring VIVO del borde cross-system (Neon Auth SDK + DB zone-aware); su
// correctitud es de tipo/build + preview Vercel, NO vitest (arrastra
// `next/headers` + Neon vivo). La saga pura está testeada en
// `create-place.test.ts` con puertos.
//
// Phase 1.B — migración del último callsite del patrón pre-ADR-0034
// (`getAuth().getSession()` + `requireSessionJwt()` + `getAuthenticatedDb
// (token, fn)`). Ahora canon ADR-0034:
//
// 1. `getCurrentUserIdentityForRequest()` — helper UNIFICADO (RSC+Action)
//    zone-aware que resuelve `{authUserId, email, displayName}` via DEFINER
//    `app.lookup_user_identity_by_id` (migration 0024). Reemplaza el split
//    Neon Auth SDK (email/name) + `requireSessionJwt` (token), que rompía
//    en custom domains por RFC 6265 (cookie cross-subdomain `Domain=.place
//    .community` NO viaja). En la práctica `createPlaceAction` corre desde
//    apex (el wizard vive en `/{locale}/crear`), pero el coordinator
//    transversal mantiene paridad estructural con todas las Server Actions
//    del codebase y previene regresiones si el wizard se exporta a otra
//    zona en el futuro.
//
// 2. `getAuthenticatedDbForRequest` — coordinator zone-aware. Detecta la
//    zona del request internamente, abre tx autenticada con `claims.sub`
//    tx-local, y pasa al callback. No requiere que el caller le pase un
//    token — ese es exactamente el punto del helper.
//
// `acquireIdentity` lanza `NoSessionError`-equivalente si no hay sesión:
// `createPlace` no atrapa (la saga supone identidad resuelta) → la action
// falla con throw, que el caller (`<AccessFlow>` + `<PlaceWizard>`) atrapa
// en su try/catch y mapea a notice cozytech. Mismo fail-mode previo, sin
// cambio de UX.

export interface PlaceFirstCredentials {
  email: string;
  password: string;
  displayName: string;
}

// Adapter de identidad: leemos `{email, displayName}` del helper unificado.
// Si no hay sesión (NoSessionError + cualquier otro fallo → `null`),
// lanzamos: la saga no debe correr sin identidad — el caller decide UX.
function sessionIdentity(): AcquireIdentity {
  return async () => {
    const identity = await getCurrentUserIdentityForRequest();
    if (!identity) {
      throw new Error("Neon Auth: no hay sesión vigente (zone-aware lookup)");
    }
    return {
      email: identity.email,
      displayName: identity.displayName,
    };
  };
}

/**
 * Crea un place con la SESIÓN VIGENTE (siempre authed). Place-first establece
 * la sesión en una request previa (`signUpAccountAction`); "Acceso" ya la
 * tiene. `input` se valida en el dominio (S5a); payload inválido no toca DB.
 */
export async function createPlaceAction(
  input: unknown,
): Promise<CreatePlaceResult> {
  // Rate limit por IP (S2 hardening, 5/h): crear un place es la operación
  // más pesada del sistema (cuenta + app_user + place + theme) y no tenía
  // freno. El gate corre ANTES de la saga: bloqueado no toca DB ni identidad.
  // El wizard mapea `rate_limited` a su aviso calmo dedicado.
  const ip = await getRequestIp();
  const gate = await enforceRateLimit("create_place", ip);
  if (!gate.success) return { status: "rate_limited" };

  return createPlace(input, {
    acquireIdentity: sessionIdentity(),
    runAuthedTx: getAuthenticatedDbForRequest,
  });
}
