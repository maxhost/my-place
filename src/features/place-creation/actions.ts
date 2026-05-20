"use server";

import { getAuth } from "@/shared/lib/auth";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { requireSessionJwt } from "@/shared/lib/session";
import { type CreatePlaceResult, createPlace } from "./create-place";
import type { AcquireIdentity } from "./ports";

// Server Action de creación de place — los DOS modos de ADR-0008. Es el
// wiring VIVO del borde cross-system (Neon Auth SDK); su correctitud es de
// tipo/build + preview Vercel, NO vitest (arrastra `next/headers` + Neon
// vivo). La saga pura está testeada en `create-place.test.ts` con puertos.
//
// El JWT JWKS-verificable de la sesión vigente (ADR-0018) se obtiene vía
// `requireSessionJwt()` (`shared/lib/session.ts`) — extraído del local
// `acquireSessionJwt` en S5a del Hub para compartirlo con el guard del page
// del Hub (semántica distinta: el Hub usa `getSessionJwt()` que retorna
// `null` si no hay sesión). El comportamiento fail-closed acá es idéntico al
// previo: sin JWT no se llega a la DB.

export interface PlaceFirstCredentials {
  email: string;
  password: string;
  displayName: string;
}

// Identidad de la sesión VIGENTE (la request ya trae la cookie: authed por
// "Acceso", o place-first tras la request previa de `signUp`). El JWT sale
// de `auth.token()` vía `requireSessionJwt` (NO de `getSession().session.token`,
// que es opaco); el perfil de `getSession()` para sembrar `app_user`
// (`ensureAppUser` es idempotente: sólo siembra si faltara — "cuenta sin
// place" legítimo).
function sessionIdentity(): AcquireIdentity {
  return async () => {
    const { data } = await getAuth().getSession();
    if (!data?.session) {
      throw new Error("Neon Auth: no hay sesión vigente (getSession)");
    }
    return {
      accessToken: await requireSessionJwt(),
      email: data.user.email ?? "",
      displayName: data.user.name ?? "",
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
  return createPlace(input, {
    acquireIdentity: sessionIdentity(),
    runAuthedTx: getAuthenticatedDb,
  });
}
