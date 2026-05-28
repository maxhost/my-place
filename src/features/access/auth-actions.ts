"use server";

import { z } from "zod";
import { getAuth } from "@/shared/lib/auth";
import { enforceRateLimit, getRequestIp } from "@/shared/lib/rate-limit";
import type { AccessCredentials, AccessResult } from "./ui/access-labels";

// Phase 0.D — rate limit por IP. `loginAction` 5/min (anti-brute-force);
// `signUpAccountAction` 3/h (anti-spam signup). El identifier es la IP del
// `x-forwarded-for` (Vercel siempre lo setea); fallback `"unknown"` colapsa
// a 1 bucket compartido (defense-in-depth si el header falta).
//
// `retryAfterSeconds` = ceil((resetAt - now) / 1000) → la UI muestra "esperá
// X seg". Cap a 3600s (1h) para no mostrar números absurdos por edge cases.
function buildRetryAfter(resetAt: number): number {
  const seconds = Math.ceil((resetAt - Date.now()) / 1000);
  return Math.max(1, Math.min(3600, seconds));
}

// Phase 1.B — Zod sobre el input de Server Actions (CLAUDE.md §"Zod para todo
// input externo"). Defense-in-depth: la máquina del form ya valida cliente-
// side (`use-access-form.ts:21-55`), pero los Server Actions son endpoints
// HTTP — payload curl/devtools/replay puede saltearse el cliente. Sin Zod, un
// email malformado o un password vacío llega crudo al SDK de Neon Auth (NO
// idempotente: el SDK puede crear estado parcial o lanzar errores que el
// outer catch colapsa silenciosamente). Con Zod, payload inválido = misma UX
// que credenciales rotas (cozytech, ADR-0009: avisos calmos y honestos, sin
// doxxear el detalle del SDK ni del schema).
//
// Reglas idénticas al cliente (single source = misma UX silenciosa cliente/
// servidor): email regex laxo (`[^\s@]+@[^\s@]+\.[^\s@]+`), password mín 8
// chars (canon Neon Auth default), displayName 1-80 después de trim.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginInputSchema = z.object({
  email: z.string().regex(EMAIL_RE),
  password: z.string().min(8),
});

const signupInputSchema = z.object({
  email: z.string().regex(EMAIL_RE),
  password: z.string().min(8),
  displayName: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(80)),
});

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
  const parsed = loginInputSchema.safeParse({ email, password });
  if (!parsed.success) return { status: "login_failed" };

  const ip = await getRequestIp();
  const gate = await enforceRateLimit("login", ip);
  if (!gate.success) {
    return {
      status: "rate_limited",
      retryAfterSeconds: buildRetryAfter(gate.resetAt),
    };
  }

  try {
    const { error } = await getAuth().signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
    });
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
  const parsed = signupInputSchema.safeParse(c);
  if (!parsed.success) return { status: "signup_failed" };

  const ip = await getRequestIp();
  const gate = await enforceRateLimit("signup", ip);
  if (!gate.success) {
    return {
      status: "rate_limited",
      retryAfterSeconds: buildRetryAfter(gate.resetAt),
    };
  }

  try {
    const { data, error } = await getAuth().signUp.email({
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.displayName,
    });
    // `data.token` (token de sesión) presente = signUp OK + cookie seteada
    // en la respuesta; el JWT lo obtiene la request siguiente (create authed).
    if (error || !data?.token) return { status: "signup_failed" };
    return { status: "ok" };
  } catch {
    return { status: "signup_failed" };
  }
}
