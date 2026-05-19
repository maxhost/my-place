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

// place-first (CTA): `signUp` crea cuenta + sesión; el JWT NO sale de ahí
// (es token de sesión) sino de `auth.token()` sobre esa sesión. Falla de
// `signUp` → no se llega a la DB (nada creado, ADR-0005 §2/§4).
function placeFirstIdentity(c: PlaceFirstCredentials): AcquireIdentity {
  return async () => {
    let res: unknown;
    try {
      res = await getAuth().signUp.email({
        email: c.email,
        password: c.password,
        name: c.displayName,
      });
    } catch (err) {
      throw tagStep(err, "signup:threw");
    }
    const { data, error } = res as {
      data?: { token?: string | null } | null;
      error?: { status?: unknown; message?: string } | null;
    };
    if (!data?.token) {
      throw tagStep(
        new Error(
          `signUp falló data=${!!data} status=${String(error?.status ?? "")} msg=${error?.message ?? ""}`,
        ),
        "signup:failed",
      );
    }
    return {
      accessToken: await acquireSessionJwt(),
      email: c.email,
      displayName: c.displayName,
    };
  };
}

// authed (Acceso → "Crear mi place"): la sesión ya existe. El JWT viene de
// `auth.token()`; el perfil de `getSession()` (`ensureAppUser` es idempotente:
// el `app_user` ya existe, email/displayName sólo siembran si faltara).
function authedIdentity(): AcquireIdentity {
  return async () => {
    const { data } = await getAuth().getSession();
    if (!data?.session) {
      throw tagStep(new Error("getSession sin sesión vigente"), "authed:no-session");
    }
    return {
      accessToken: await acquireSessionJwt(),
      email: data.user.email ?? "",
      displayName: data.user.name ?? "",
    };
  };
}

/**
 * Crea un place. Con `credentials` → modo place-first (signUp). Sin ellas →
 * modo authed (sesión vigente). `input` se valida en el dominio (S5a) dentro
 * de la saga; payload inválido no crea cuenta.
 */
export async function createPlaceAction(
  input: unknown,
  credentials?: PlaceFirstCredentials,
): Promise<CreatePlaceResult> {
  try {
    return await createPlace(input, {
      acquireIdentity: credentials
        ? placeFirstIdentity(credentials)
        : authedIdentity(),
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
