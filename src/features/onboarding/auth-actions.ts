"use server";

import { getAuth } from "@/shared/lib/auth";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";
import type { AccessCredentials, AccessResult } from "./ui/access-labels";

// Borde cross-system de la vía "Acceso" (S9, ADR-0008/0009). Es el wiring
// VIVO del SDK Neon Auth; su correctitud es de tipo/build + preview Vercel,
// NO vitest (arrastra `next/headers` + Neon vivo). La máquina pura del form
// está testeada en `access-flow.test.tsx` con puertos inyectados.
//
// Avisos calmos y honestos (cozytech): no se expone el detalle del SDK ni se
// afirma un código de error no verificado. `login` falla → causa abrumadora
// = credenciales; `signUp` falla → causa más probable = email ya registrado
// (el aviso sugiere iniciar sesión). El código exacto del SDK es TBD
// verificado en preview (mismo estatus que el método de token, S4b/S5b).

/**
 * Login account-first: establece la sesión vigente (cookie first-party vía
 * el route handler). Tras esto el modo authed de creación de place usa
 * `getSession` (ya re-legible en la siguiente request).
 */
export async function loginAction(
  email: string,
  password: string,
): Promise<AccessResult> {
  try {
    const { error } = await getAuth().signIn.email({ email, password });
    if (error) return { status: "login_failed" };
    return { status: "ok" };
  } catch {
    return { status: "login_failed" };
  }
}

/**
 * Signup account-first (ADR-0008 §2): crea la identidad (Neon Auth `signUp`)
 * + `app_user` SIN place — "cuenta sin place" es estado legítimo (ADR-0008
 * §4). El token sale de la RESPUESTA de `signUp` (la cookie no es re-legible
 * en la misma invocación — mismo TBD que la saga place-first, S5b). El
 * `ensureAppUser` acá es idempotente: si se difiere, el modo authed lo
 * re-asegura en su TX 1 — no es gap, es defensa por construcción.
 */
export async function signUpAccountAction(
  c: AccessCredentials,
): Promise<AccessResult> {
  try {
    const { data, error } = await getAuth().signUp.email({
      email: c.email,
      password: c.password,
      name: c.displayName,
    });
    if (error || !data?.token) return { status: "signup_failed" };
    await getAuthenticatedDb(data.token, (sql, claims) =>
      ensureAppUser(sql, {
        authUserId: claims.sub,
        email: c.email,
        displayName: c.displayName,
      }),
    );
    return { status: "ok" };
  } catch {
    return { status: "signup_failed" };
  }
}
