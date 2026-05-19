"use server";

import { headers } from "next/headers";
import { getAuth } from "@/shared/lib/auth";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { obs, obsErr } from "@/shared/lib/obs";
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

// El token que `getAuthenticatedDb` verifica contra el JWKS de Neon Auth
// (`verifyAccessToken` → `jwtVerify`). DIAGNÓSTICO (no asumido): el método
// tipado `auth.getAccessToken()` exige un `providerId` OAuth (token de cuenta
// externa, otro concepto); el JWT de backend RLS-utilizable sale del token de
// sesión de Neon Auth. Cuál de los dos tokens es JWKS-verificable (token de
// `signUp`/`getSession` vs endpoint `get-access-token`) es un TBD de impl de
// ADR-0006 que se VERIFICA EN PREVIEW Vercel, NO en vitest/typecheck — mismo
// estatus que `getAccessToken` vs `getSession` y la cookie en S4b. Fail-closed.
function requireToken(token: string | null | undefined): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Neon Auth no devolvió token de sesión");
  }
  return token;
}

// place-first (CTA): `signUp` crea la cuenta; el token sale de la RESPUESTA
// de signUp porque la cookie que éste setea NO es re-legible en la misma
// invocación del Server Action (ADR-0005 §S5b). Falla de signUp (`error` o
// sin token) → la saga no llega a la DB (nada creado).
function placeFirstIdentity(c: PlaceFirstCredentials): AcquireIdentity {
  return async () => {
    obs("signup:start", { emailLen: c.email.length });
    let res: unknown;
    try {
      res = await getAuth().signUp.email({
        email: c.email,
        password: c.password,
        name: c.displayName,
      });
    } catch (err) {
      obsErr("signup:threw", err);
      throw err;
    }
    const { data, error } = res as {
      data?: { token?: string | null } | null;
      error?: { status?: unknown; message?: string } | null;
    };
    obs("signup:result", {
      dataPresent: !!data,
      tokenPresent: !!data?.token,
      tokenLen: data?.token?.length ?? 0,
      errorStatus: error?.status,
      errorMessage: error?.message,
    });
    return {
      accessToken: requireToken(data?.token),
      email: c.email,
      displayName: c.displayName,
    };
  };
}

// authed (Acceso → "Crear mi place"): la sesión ya existe; token + perfil
// salen de la sesión vigente (`ensureAppUser` es idempotente: el `app_user`
// ya existe, email/displayName sólo siembran si faltara).
function authedIdentity(): AcquireIdentity {
  return async () => {
    const { data } = await getAuth().getSession();
    obs("authed:session", {
      sessionPresent: !!data?.session,
      tokenPresent: !!data?.session.token,
      tokenLen: data?.session.token?.length ?? 0,
    });
    return {
      accessToken: requireToken(data?.session.token),
      email: data?.user.email ?? "",
      displayName: data?.user.name ?? "",
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
    const h = await headers();
    obs("action:invoked", {
      mode: credentials ? "place-first" : "authed",
      host: h.get("host"),
      xfHost: h.get("x-forwarded-host"),
      origin: h.get("origin"),
      hasDbUrl: !!process.env.DATABASE_URL,
      hasJwks: !!process.env.NEON_AUTH_JWKS_URL,
      hasBaseUrl: !!process.env.NEON_AUTH_BASE_URL,
    });
  } catch (err) {
    obsErr("action:headers", err);
  }
  try {
    const result = await createPlace(input, {
      acquireIdentity: credentials
        ? placeFirstIdentity(credentials)
        : authedIdentity(),
      runAuthedTx: getAuthenticatedDb,
    });
    obs("action:result", { status: result.status });
    return result;
  } catch (err) {
    obsErr("action:threw", err);
    throw err;
  }
}
