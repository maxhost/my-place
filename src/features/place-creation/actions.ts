"use server";

import { getAuth } from "@/shared/lib/auth";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { onbLine, tagStep } from "@/shared/lib/obs";
import { type CreatePlaceResult, createPlace } from "./create-place";
import type { AcquireIdentity } from "./ports";

// Server Action de creación de place — los DOS modos de ADR-0008. Es el
// wiring VIVO del borde cross-system (Neon Auth SDK); su correctitud es de
// tipo/build + preview Vercel, NO vitest (arrastra `next/headers` + Neon
// vivo). La saga pura está testeada en `create-place.test.ts` con puertos.

export interface PlaceFirstCredentials {
  email: string;
  password: string;
  displayName: string;
}

// TBD de ADR-0006/S5b RESUELTO POR EVIDENCIA (preview Vercel, 2026-05-19):
// `signUp.email().data.token` y `getSession().session.token` son el TOKEN DE
// SESIÓN OPACO de Neon Auth (Better Auth) — NO un JWT. Pasárselo a
// `verifyAccessToken`/`jwtVerify` da `ERR_JWS_INVALID`. El JWT que el JWKS
// verifica (y que RLS lee en `request.jwt.claims.sub`) se emite por el
// endpoint `/token` del plugin JWT → método server `auth.token()`
// (`get-access-token` es OAuth, otro concepto; el SDK server no expone
// `getJWTToken`). La correctitud del wiring vivo es de tipo/build + preview,
// NO vitest (seam-split: arrastra el SDK + red).
//
// El SDK tipa la acción del plugin con `fetchOptions?: any` y devuelve
// `{ data, error }` (`fetchOptions.throw:false` en NeonAuthAdapterCore); se
// lee `data.token` defensivamente — la forma exacta es del SDK, no nuestra.
type SessionJwtResult = {
  data?: { token?: string | null } | null;
  error?: { status?: unknown; message?: string } | null;
};

// Adquiere el JWT JWKS-verificable de la sesión vigente (cookie del request,
// que la cubre el adapter Next del SDK como en `getSession()`). Fail-closed:
// sin JWT no se llega a la DB.
async function acquireSessionJwt(): Promise<string> {
  const res = (await (
    getAuth() as unknown as {
      token: (fetchOptions?: unknown) => Promise<SessionJwtResult>;
    }
  ).token()) as SessionJwtResult;
  const token = res.data?.token;
  if (typeof token !== "string" || token.length === 0) {
    throw tagStep(
      new Error(
        `auth.token sin JWT data=${!!res.data} status=${String(res.error?.status ?? "")} msg=${res.error?.message ?? ""}`,
      ),
      "jwt:token-endpoint",
    );
  }
  return token;
}

// Identidad de la sesión VIGENTE (la request ya trae la cookie: authed por
// "Acceso", o place-first tras la request previa de `signUp`). El JWT sale
// de `auth.token()` (NO de `getSession().session.token`, que es opaco); el
// perfil de `getSession()` para sembrar `app_user` (`ensureAppUser` es
// idempotente: sólo siembra si faltara — "cuenta sin place" legítimo).
function sessionIdentity(): AcquireIdentity {
  return async () => {
    const { data } = await getAuth().getSession();
    if (!data?.session) {
      throw tagStep(
        new Error("getSession sin sesión vigente"),
        "authed:no-session",
      );
    }
    return {
      accessToken: await acquireSessionJwt(),
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
  try {
    return await createPlace(input, {
      acquireIdentity: sessionIdentity(),
      runAuthedTx: getAuthenticatedDb,
    });
  } catch (err) {
    // DIAGNÓSTICO TEMPORAL: única línea, veredicto adelante (el visor de
    // Vercel trunca ~30 chars y muestra solo la 1ª línea del request).
    console.error(
      `${onbLine(err)} | envs db=${!!process.env.DATABASE_URL} jwks=${!!process.env.NEON_AUTH_JWKS_URL} base=${!!process.env.NEON_AUTH_BASE_URL}`,
    );
    throw err;
  }
}
