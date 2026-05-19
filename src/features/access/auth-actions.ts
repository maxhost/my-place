"use server";

import { getAuth } from "@/shared/lib/auth";
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
 * Signup account-first (ADR-0008 §2): crea SÓLO la identidad (Neon Auth
 * `signUp`), que setea la cookie de sesión en su respuesta. NO crea
 * `app_user`: "cuenta sin place" es estado legítimo (ADR-0008 §4) y el
 * `ensureAppUser` es idempotente — lo asegura la TX 1 del create authed en
 * la request SIGUIENTE (donde la cookie ya viaja y `auth.token()` da el JWT).
 * Hacerlo acá rompía: `data.token` es token de SESIÓN opaco, no un JWT
 * (evidencia preview 2026-05-19) → `getAuthenticatedDb` fallaba y el signup
 * entero se reportaba como fallido aunque la cuenta SÍ se creaba.
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
    // `data.token` (token de sesión) presente = signUp OK + cookie seteada
    // en la respuesta; el JWT lo obtiene la request siguiente (create authed).
    if (error || !data?.token) return { status: "signup_failed" };
    return { status: "ok" };
  } catch {
    return { status: "signup_failed" };
  }
}
