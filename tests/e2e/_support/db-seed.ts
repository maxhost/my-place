import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Importación RELATIVA (no alias `@/`) de código de producción a propósito:
// `sso-session.ts` + su único import `./sso-keys` son self-contained (sólo
// `jose` + `process.env`), sin `next/headers` ni DB → seguros de transpilar en
// el runner Playwright. El relativo elimina cualquier riesgo de resolución del
// path alias en el loader de Playwright.
import {
  LOCAL_SESSION_COOKIE_NAME,
  mintLocalSession,
} from "../../../src/shared/lib/sso/sso-session";

import { E2E_EMAIL_PATTERN } from "./db-cleanup";

// Seed admin de la Phase 2.B.2 (E2E accept invite cross-domain). Espejo de
// `db-cleanup.ts`: conecta con el rol admin (`neondb_owner`, BYPASSRLS, dueño
// de las tablas Y de las funciones DEFINER) vía `DATABASE_URL_MIGRATE`. El rol
// `app_system` NO podría — `place_domain` es RLS owner-only y `app.create_
// invitation` está GRANTeada sólo a `app_system` con gate de ownership.
//
// ## Qué siembra (precondiciones del flujo accept)
//
// 1. `place_domain` verified+activo (verified_at=NOW(), archived_at NULL) →
//    `app.lookup_place_by_domain` (0009) clasifica el host como custom-domain y
//    `app.lookup_custom_domain_by_slug` (0022) hace zone-aware los invite URLs.
// 2. Una invitación pendiente vía la DEFINER canónica `app.create_invitation`
//    (migration 0018) — NO un INSERT directo: ejercemos el path real de
//    generación de token + invariantes. El gate `current_user_owns_place` lee
//    `app.current_user_id()` = `request.jwt.claims->>'sub'`; la conexión admin
//    no trae claim, así que lo seteamos tx-local con `set_config(...)` al
//    `auth_user_id` del owner (forma estándar de invocar una función
//    SECURITY DEFINER como un usuario concreto en seeds). `neondb_owner` es
//    dueño de la función → puede ejecutarla pese al REVOKE FROM PUBLIC.
//
// Toda la data sembrada matchea el patrón de email de test (owner+invitee con
// prefijo `e2e-`), así que el barrido de `db-cleanup.ts` la limpia sin tocar
// data real (incluye `place_domain` + `invitation` + `membership`).

neonConfig.webSocketConstructor = ws;

function adminUrl(): string {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) {
    throw new Error(
      "DATABASE_URL_MIGRATE ausente — requerida para el seed E2E. " +
        "Copiá .env.e2e.example a .env.e2e y completá las creds del branch test.",
    );
  }
  return url;
}

export interface SeededCustomDomainInvite {
  placeId: string;
  /** Token URL-safe (64 hex) generado por `app.create_invitation`. */
  token: string;
}

/**
 * Siembra `place_domain` verified + una invitación pendiente para `inviteeEmail`
 * en el place del owner. Todo en una sola tx admin (el `set_config` local sólo
 * surte efecto dentro de un bloque transaccional).
 */
export async function seedCustomDomainInvite(opts: {
  ownerEmail: string;
  placeSlug: string;
  inviteeEmail: string;
  customDomain: string;
}): Promise<SeededCustomDomainInvite> {
  const pool = new Pool({ connectionString: adminUrl() });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const placeRes = await client.query(
      `SELECT id FROM place WHERE lower(slug) = lower($1) AND archived_at IS NULL`,
      [opts.placeSlug],
    );
    const placeId = placeRes.rows[0]?.id as string | undefined;
    if (!placeId) {
      throw new Error(
        `seed: place no encontrado para slug "${opts.placeSlug}" ` +
          "(¿signUpOwner falló o el slug cambió?)",
      );
    }

    const ownerRes = await client.query(
      `SELECT auth_user_id FROM app_user WHERE email = $1`,
      [opts.ownerEmail],
    );
    const ownerSub = ownerRes.rows[0]?.auth_user_id as string | undefined;
    if (!ownerSub) {
      throw new Error(
        `seed: app_user del owner no encontrado para "${opts.ownerEmail}"`,
      );
    }

    // (1) place_domain verified. id/created_at toman sus DEFAULTs del schema.
    // El índice único `place_domain_domain_active_unq` es POR DOMINIO GLOBAL
    // (WHERE archived_at IS NULL): como el custom domain del E2E es constante,
    // primero barremos cualquier fila ACTIVA de ese dominio (leftover de un run
    // crasheado o de un retry cuyo place previo sigue activo) para que el INSERT
    // no colisione. Safe: el dominio es E2E-only, nunca un place real.
    await client.query(
      `DELETE FROM place_domain
        WHERE lower(domain) = lower($1) AND archived_at IS NULL`,
      [opts.customDomain],
    );
    await client.query(
      `INSERT INTO place_domain (place_id, domain, verified_at)
         VALUES ($1, $2, now())`,
      [placeId, opts.customDomain],
    );

    // (2) Invitación vía DEFINER canónica con claim spoofeado tx-local al owner.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ownerSub }),
    ]);
    const invRes = await client.query(
      `SELECT app.create_invitation($1, $2, now() + interval '7 days') AS result`,
      [placeId, opts.inviteeEmail],
    );
    const result = invRes.rows[0]?.result as { token?: string } | undefined;
    const token = result?.token;
    if (!token) {
      throw new Error("seed: app.create_invitation no devolvió token");
    }

    await client.query("COMMIT");
    return { placeId, token };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * `sub` (= `neon_auth.user.id` = JWT `sub` = `app.current_user_id()`) del user
 * con ese email. Lo usamos tras el signup real del invitee para mintear su
 * sesión local. Retorna `null` si todavía no existe (poll-able).
 */
export async function lookupAuthUserIdByEmail(
  email: string,
): Promise<string | null> {
  const pool = new Pool({ connectionString: adminUrl() });
  try {
    const res = await pool.query(
      `SELECT id FROM neon_auth."user" WHERE email = $1`,
      [email],
    );
    return (res.rows[0]?.id as string | undefined) ?? null;
  } finally {
    await pool.end();
  }
}

/**
 * Mintea la cookie `__Host-place_sso_session` que el `sso-redeem` (S8) habría
 * emitido al final de la cadena init→issue→redeem, y la devuelve en el shape
 * de `context.addCookies`. Substituye SÓLO los 3 hops del redirect SSO (que en
 * el harness local `:3000` son intratables porque las rutas SSO reconstruyen el
 * host del custom domain sin puerto — correcto para prod `:443`; los 3 hops ya
 * están cubiertos por sus `route.test.ts`). El resto del flujo (routing custom-
 * domain, `verifyLocalSession`, accept, Hub) corre real. Ver docs/testing.md.
 *
 * `host` (claim del JWT) debe ser el host pelado del custom domain — `verify
 * LocalSession` lo compara contra el `Host` del request. El `__Host-` prefix
 * exige Secure + Path=/ + sin Domain: Playwright los deriva del `url`.
 */
export async function mintLocalSessionCookie(opts: {
  sub: string;
  customDomain: string;
}): Promise<{
  name: string;
  value: string;
  url: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax";
}> {
  if (!process.env.PLACE_SSO_SIGNING_KEY) {
    throw new Error(
      "PLACE_SSO_SIGNING_KEY ausente en el entorno del runner — requerida " +
        "para mintear la sesión local SSO del E2E cross-domain. Agregala a " +
        ".env.e2e (ver .env.e2e.example).",
    );
  }
  const value = await mintLocalSession({
    sub: opts.sub,
    host: opts.customDomain,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return {
    name: LOCAL_SESSION_COOKIE_NAME,
    value,
    // Puerto en el url para que el cookie store la asocie al dev server E2E;
    // los cookies son port-agnostic, pero Playwright deriva domain/path de acá.
    url: `https://${opts.customDomain}:3000/`,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

/**
 * ¿Existe la membership del invitee en el place? Prueba directa (independiente
 * del estado del browser) de que `app.accept_invitation` corrió cross-domain.
 */
export async function membershipExists(opts: {
  inviteeEmail: string;
  placeId: string;
}): Promise<boolean> {
  const pool = new Pool({ connectionString: adminUrl() });
  try {
    const res = await pool.query(
      `SELECT 1
         FROM membership m
         JOIN app_user au ON au.id = m.user_id
        WHERE au.email = $1 AND m.place_id = $2
        LIMIT 1`,
      [opts.inviteeEmail, opts.placeId],
    );
    return (res.rowCount ?? 0) > 0;
  } finally {
    await pool.end();
  }
}

/** Guard de invariante de cleanup: el email DEBE matchear el patrón de test. */
export function assertCleanupSafeEmail(email: string): void {
  const [prefix, suffix] = E2E_EMAIL_PATTERN.split("%");
  if (!(email.startsWith(prefix) && email.endsWith(suffix))) {
    throw new Error(
      `seed: email "${email}" no matchea el patrón de cleanup ` +
        `"${E2E_EMAIL_PATTERN}" — el teardown no lo barrería.`,
    );
  }
}
