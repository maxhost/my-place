#!/usr/bin/env node
// Seed de desarrollo (Phase 3.D del tech-debt tracker, docs/tech-debt-pre-v1.3.md
// §777). Puebla un branch Neon de DESARROLLO con data observable de un comando:
// 1 owner + 1 place + 3 miembros + 2 invitaciones pendientes. Sirve para ver
// `/settings/members` sin tener que crear todo a mano tras cada reset del branch.
//
// ⚠️  SOLO DEV BRANCH — NUNCA PROD. Escribe con el rol admin `neondb_owner`
//     (BYPASSRLS) vía DATABASE_URL_MIGRATE. Los guards de abajo abortan en
//     Vercel/CI; igual, verificá el host que imprime antes de confirmar.
//
// ## Owner loginable — Opción 1 (bind a owner existente)
// La identidad de login vive en Neon Auth (`neon_auth.user`), NO en nuestras
// tablas — el script NO la crea (no replica el signup ni el hash de Better-Auth;
// ese seam se valida en preview, no en script — ver auth-actions.ts §50-59).
// Flujo: registrá el owner UNA vez por la UI real (`/login` → signup), después
// pasá su email en SEED_OWNER_EMAIL y el seed le cuelga place + miembros +
// invitaciones. El email del owner DEBE existir ya en `neon_auth.user`.
//
// Uso:
//   SEED_OWNER_EMAIL=ana@dev.local pnpm db:seed
//
// Sin test vitest (excepción justificada, igual que el seam de auth): es tooling
// dev que hace I/O contra Neon vivo + depende de `neon_auth.user` (managed
// externo). Verificación = run manual contra branch dev (ver README §Setup).

import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

config({ path: ".env.local" });
neonConfig.webSocketConstructor = ws;

// Slug fijo = marcador de seed. Re-run aborta si ya existe (no borra data).
const SEED_SLUG = "club-lectura-seed";
const SEED_PLACE_NAME = "Club de Lectura";

// 3 miembros (app_user + membership directos; no necesitan Neon Auth porque
// loadMembers joinea membership→app_user, load-members.ts §78-79). El owner ya
// queda como miembro vía app.create_place.
const SEED_MEMBERS = [
  { email: "beto@dev.local", displayName: "Beto Núñez" },
  { email: "carla@dev.local", displayName: "Carla Ortiz" },
  { email: "dario@dev.local", displayName: "Darío Paz" },
];

// 2 invitaciones pendientes → emails que todavía NO son miembros.
const SEED_INVITES = ["elena@dev.local", "fede@dev.local"];

// Handle random no-usado (espejo de ensure-app-user.ts §16-18).
function randomHandle() {
  return `u${randomBytes(8).toString("hex")}`;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// Host del connection string sin credenciales (para que sea evidente el target).
function redactedHost(connectionString) {
  try {
    const u = new URL(connectionString);
    return u.host;
  } catch {
    return "(host no parseable)";
  }
}

// Invite URL zone-aware en su forma de subdominio (espejo de auth-redirect.ts
// §123 buildSubdomainCanonicalUrl): {scheme}://{slug}.{host}/invite/{token}.
// En dev el proxy mapea *.localhost:3000 → zona-place.
function buildInviteUrl(slug, token) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) fail("NEXT_PUBLIC_APP_URL no configurada (necesaria para las invite URLs).");
  const u = new URL(appUrl);
  return `${u.protocol}//${slug}.${u.host}/invite/${token}`;
}

async function main() {
  // --- Guards de seguridad (acceptance: solo dev branch, NUNCA prod) ---
  if (process.env.VERCEL || process.env.CI) {
    fail("db:seed no corre en Vercel/CI (es tooling local de dev branch).");
  }
  const connectionString = process.env.DATABASE_URL_MIGRATE;
  if (!connectionString) {
    fail("DATABASE_URL_MIGRATE no configurada (rol neondb_owner del branch dev).");
  }
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  if (!ownerEmail) {
    fail(
      "SEED_OWNER_EMAIL no seteada. Registrá el owner una vez por la UI (/login → signup)\n" +
        "  y después: SEED_OWNER_EMAIL=ana@dev.local pnpm db:seed",
    );
  }

  console.log(`\n🌱 db:seed → target DB host: ${redactedHost(connectionString)}`);
  console.log(`   owner: ${ownerEmail}\n`);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    // 1. Resolver el owner en neon_auth.user (managed por Neon Auth). El email
    //    DEBE existir ya (Opción 1). `neon_auth."user"` con "user" quoted +
    //    columnas id (uuid), email, name (igual que migration 0024).
    const ownerRows = (
      await client.query(
        `SELECT id, email, name FROM neon_auth."user" WHERE email = $1 LIMIT 1`,
        [ownerEmail],
      )
    ).rows;
    if (ownerRows.length === 0) {
      fail(
        `No existe un usuario Neon Auth con email "${ownerEmail}".\n` +
          "  Registralo primero por la UI: pnpm dev → /<locale>/login → crear cuenta.",
      );
    }
    const owner = ownerRows[0];
    const ownerSub = owner.id; // = app_user.auth_user_id = claims.sub

    // 2. Pre-check de idempotencia: si el place del seed ya existe, abortar.
    const existing = (
      await client.query(`SELECT id FROM place WHERE slug = $1`, [SEED_SLUG])
    ).rows;
    if (existing.length > 0) {
      fail(
        `El place "${SEED_SLUG}" ya está sembrado. Para re-sembrar, borralo del\n` +
          "  branch dev (o reseteá el branch Neon) y volvé a correr db:seed.",
      );
    }

    // --- Todo lo que muta va en UNA tx (atómico: si algo falla, rollback). ---
    await client.query("BEGIN");

    // Claim tx-local para los DEFINER (espejo de db.ts §30). Las funciones leen
    // app.current_user_id() (->>'sub'), independiente del rol del caller.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: ownerSub }),
    ]);

    // 2b. app_user del owner (espejo de ensure-app-user.ts; idempotente por
    //     auth_user_id UNIQUE). create_place lo requiere (sino P0002).
    await client.query(
      `INSERT INTO app_user (auth_user_id, email, display_name, handle)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (auth_user_id) DO NOTHING`,
      [ownerSub, owner.email, (owner.name ?? "").trim() || owner.email.split("@")[0], randomHandle()],
    );

    // 3. Place vía DEFINER (crea place + place_ownership + membership del owner).
    const placeId = (
      await client.query(
        `SELECT app.create_place($1, $2, $3, $4::jsonb, $5::jsonb, $6) AS id`,
        [SEED_SLUG, SEED_PLACE_NAME, "Comunidad de ejemplo sembrada por db:seed.", "{}", "{}", "es"],
      )
    ).rows[0].id;

    // 4. 3 miembros: app_user (auth_user_id sintético — no loginables) + membership.
    const memberNames = [];
    for (const m of SEED_MEMBERS) {
      const memberRow = (
        await client.query(
          `INSERT INTO app_user (auth_user_id, email, display_name, handle)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [`seed:${m.email}`, m.email, m.displayName, randomHandle()],
        )
      ).rows[0];
      await client.query(
        `INSERT INTO membership (user_id, place_id) VALUES ($1, $2)`,
        [memberRow.id, placeId],
      );
      memberNames.push(m.displayName);
    }

    // 5. 2 invitaciones pendientes vía DEFINER (token real de 64 hex).
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const inviteUrls = [];
    for (const email of SEED_INVITES) {
      const payload = (
        await client.query(
          `SELECT app.create_invitation($1, $2, $3::timestamptz) AS payload`,
          [placeId, email, expiresAt],
        )
      ).rows[0].payload;
      inviteUrls.push({ email, url: buildInviteUrl(SEED_SLUG, payload.token) });
    }

    await client.query("COMMIT");

    // 6. Resumen.
    console.log("✓ Owner:", `${owner.email} (${(owner.name ?? "").trim() || "—"})`);
    console.log("✓ Place:", `"${SEED_PLACE_NAME}" (slug: ${SEED_SLUG})`);
    console.log("✓ Miembros:", memberNames.join(", "));
    console.log("✓ Invitaciones pendientes:");
    for (const inv of inviteUrls) {
      console.log(`    → ${inv.url}  (para ${inv.email})`);
    }
    console.log(
      `\nListo. Logueate como ${owner.email} y entrá a /settings/members del place.\n`,
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  fail(`db:seed falló: ${err?.message ?? err}`);
});
