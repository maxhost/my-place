import { afterAll, describe, expect, it } from "vitest";
import { type RlsTx, endRlsAdminPool, inRlsTx } from "./db-test-pool";

// S6: invitación token-link (ADR-0010 §2). Dos funciones `SECURITY DEFINER`
// (dueño neondb_owner, EXECUTE solo app_system), mismo hardening que S3:
//   - `app.invitation_preview(token)`  → solo-lectura, SIN claim (el token ES
//     la capability; la fila `invitation` es owner-only por RLS → el invitado
//     no la escanea bajo su rol). Valida existe/no vencido/no usado.
//   - `app.accept_invitation(token)`   → atómico, requiere caller (claim):
//     valida + email-match estricto + test-and-set de `accepted_at`
//     (`UPDATE … WHERE accepted_at IS NULL`) + crea `membership` (SIN place).
//     El cap de 150 miembros murió con ADR-0053 §6 (migration 0030).
// `ensureAppUser` corre app-side ANTES (como en S5b); la función exige que el
// `app_user` del caller exista (P0002 si no). Concurrencia wall-clock real =
// preview/integración; acá el PREDICADO test-and-set se unit-testea de forma
// determinista (mismo precedente que el UNIQUE secuencial de S3).

afterAll(() => endRlsAdminPool());

async function seedUser(tx: RlsTx, auth: string, email: string) {
  const [{ id }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [auth, email, auth.toUpperCase(), `h_${auth}`],
  )) as Array<{ id: string }>;
  return id;
}

// Owner + place vía la ÚNICA vía de creación (S3). Devuelve place id/slug.
async function seedPlace(tx: RlsTx, slug: string) {
  const ownerId = await seedUser(tx, "owner", "owner@x.com");
  await tx.as("owner");
  const [{ pid }] = (await tx.q(
    `SELECT app.create_place($1,'Place','d','{}'::jsonb,'{}'::jsonb) AS pid`,
    [slug],
  )) as Array<{ pid: string }>;
  return { placeId: pid, slug, ownerId };
}

// Inserta una invitación como dueño de la tabla (en runtime la crea el owner
// por la base owner-only de S2, ya cubierto en rls.test.ts).
async function seedInvitation(
  tx: RlsTx,
  placeId: string,
  email: string,
  opts: { expiresInDays?: number; acceptedAt?: string | null } = {},
) {
  const { expiresInDays = 7, acceptedAt = null } = opts;
  const [{ token }] = (await tx.seed(
    `INSERT INTO invitation (place_id,email,invited_by,expires_at,accepted_at,token)
     VALUES ($1,$2,'owner', now() + ($3 || ' days')::interval, $4,
             'tok_' || gen_random_uuid()::text)
     RETURNING token`,
    [placeId, email, String(expiresInDays), acceptedAt],
  )) as Array<{ token: string }>;
  return token;
}

const preview = (tx: RlsTx, token: string) =>
  tx.q("SELECT * FROM app.invitation_preview($1)", [token]);
const accept = (tx: RlsTx, token: string) =>
  tx.q("SELECT app.accept_invitation($1) AS slug", [token]);

describe("S6 app.invitation_preview — display solo-lectura (ADR-0010 §2.1)", () => {
  it("token válido (sin claim) → place + email del invitado, nada se muta", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const token = await seedInvitation(tx, placeId, "guest@x.com");
      await tx.as(null); // sin claim: el token ES la autorización
      const [row] = (await preview(tx, token)) as Array<Record<string, unknown>>;
      expect(row).toMatchObject({
        place_slug: "place-a",
        place_name: "Place",
        invitee_email: "guest@x.com",
      });
      const [{ n }] = (await tx.seed(
        `SELECT count(*)::int n FROM invitation WHERE token=$1 AND accepted_at IS NULL`,
        [token],
      )) as Array<{ n: number }>;
      expect(n).toBe(1);
    });
  });

  it("token inexistente → rechaza", async () => {
    await inRlsTx(async (tx) => {
      await seedPlace(tx, "place-a");
      await tx.as(null);
      expect(await tx.denied("SELECT * FROM app.invitation_preview('nope')")).toBe(true);
    });
  });

  it("token vencido → rechaza", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const token = await seedInvitation(tx, placeId, "g@x.com", { expiresInDays: -1 });
      await tx.as(null);
      expect(await tx.denied("SELECT * FROM app.invitation_preview($1)", [token])).toBe(true);
    });
  });

  it("token ya usado → rechaza", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const token = await seedInvitation(tx, placeId, "g@x.com", {
        acceptedAt: new Date().toISOString(),
      });
      await tx.as(null);
      expect(await tx.denied("SELECT * FROM app.invitation_preview($1)", [token])).toBe(true);
    });
  });
});

describe("S6 app.accept_invitation — aceptación atómica (ADR-0010 §2.2)", () => {
  it("éxito: crea membership (SIN place), test-and-set accepted_at, devuelve slug", async () => {
    await inRlsTx(async (tx) => {
      const { placeId, slug } = await seedPlace(tx, "place-a");
      const uid = await seedUser(tx, "guest", "guest@x.com");
      const token = await seedInvitation(tx, placeId, "guest@x.com");
      const placesBefore = (await tx.seed(`SELECT count(*)::int n FROM place`)) as Array<{
        n: number;
      }>;
      await tx.as("guest");
      const [{ slug: out }] = (await accept(tx, token)) as Array<{ slug: string }>;
      expect(out).toBe(slug);
      const [chk] = (await tx.seed(
        `SELECT
           (SELECT count(*)::int FROM membership WHERE user_id=$1 AND place_id=$2) AS mem,
           (SELECT count(*)::int FROM place_ownership WHERE user_id=$1) AS owns,
           (SELECT count(*)::int FROM place) AS places,
           (SELECT accepted_at IS NOT NULL FROM invitation WHERE token=$3) AS used`,
        [uid, placeId, token],
      )) as Array<Record<string, unknown>>;
      expect(chk).toMatchObject({ mem: 1, owns: 0, used: true });
      expect(chk.places).toBe(placesBefore[0].n); // no crea place
    });
  });

  it("sin claim → rechaza (no autenticado)", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const token = await seedInvitation(tx, placeId, "g@x.com");
      await tx.as(null);
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
    });
  });

  it("app_user inexistente para el caller → rechaza (ensureAppUser corre antes)", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const token = await seedInvitation(tx, placeId, "g@x.com");
      await tx.as("ghost"); // claim válido pero sin app_user
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
    });
  });

  it("email NO coincide con invitation.email → rechaza, nada en DB", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      await seedUser(tx, "guest", "otro@x.com");
      const token = await seedInvitation(tx, placeId, "guest@x.com");
      await tx.as("guest");
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
      const [{ n }] = (await tx.seed(
        `SELECT count(*)::int n FROM membership m
           JOIN app_user u ON u.id=m.user_id
          WHERE u.auth_user_id='guest' AND m.place_id=$1`,
        [placeId],
      )) as Array<{ n: number }>;
      expect(n).toBe(0);
    });
  });

  it("token vencido → rechaza", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      await seedUser(tx, "guest", "g@x.com");
      const token = await seedInvitation(tx, placeId, "g@x.com", { expiresInDays: -1 });
      await tx.as("guest");
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
    });
  });

  it("test-and-set un solo uso: 2ª aceptación → rechaza, 1 sola membership", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      const uid = await seedUser(tx, "guest", "g@x.com");
      const token = await seedInvitation(tx, placeId, "g@x.com");
      await tx.as("guest");
      await accept(tx, token); // gana
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
      const [{ n }] = (await tx.seed(
        `SELECT count(*)::int n FROM membership WHERE user_id=$1 AND place_id=$2`,
        [uid, placeId],
      )) as Array<{ n: number }>;
      expect(n).toBe(1); // UNIQUE(user_id,place_id) + test-and-set respaldan
    });
  });

  it("sin cap de miembros (ADR-0053 §6, migration 0030): el cuerpo del DEFINER no contiene el check 150/P0009", async () => {
    // Test estructural por ausencia: sembrar 150 memberships para probar que
    // el 151 entra sería caro y frágil; alcanza con verificar que el cuerpo
    // vigente de la función ya no expresa el cap (removido en migration 0030).
    await inRlsTx(async (tx) => {
      const [{ def }] = (await tx.seed(
        `SELECT pg_get_functiondef('app.accept_invitation(text)'::regprocedure) AS def`,
      )) as Array<{ def: string }>;
      expect(def).not.toContain("150");
      expect(def).not.toContain("P0009");
    });
  });

  it("re-validación display↔submit: válido al preview, vencido antes del submit → rechaza", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      await seedUser(tx, "guest", "g@x.com");
      const token = await seedInvitation(tx, placeId, "g@x.com");
      await tx.as(null);
      await preview(tx, token); // display OK
      await tx.seed(`UPDATE invitation SET expires_at = now() - interval '1 s' WHERE token=$1`, [
        token,
      ]);
      await tx.as("guest");
      expect(await tx.denied("SELECT app.accept_invitation($1)", [token])).toBe(true);
    });
  });
});

describe("S6 invitación — RLS owner-only + EXECUTE", () => {
  it("el invitado NO escanea `invitation` bajo su rol (owner-only, S2)", async () => {
    await inRlsTx(async (tx) => {
      const { placeId } = await seedPlace(tx, "place-a");
      await seedUser(tx, "guest", "g@x.com");
      await seedInvitation(tx, placeId, "g@x.com");
      await tx.as("guest");
      const rows = await tx.q("SELECT * FROM invitation");
      expect(rows).toHaveLength(0); // RLS invitation_all es owner-only
    });
  });

  it("EXECUTE concedido a app_system y denegado a PUBLIC en ambas funciones", async () => {
    await inRlsTx(async (tx) => {
      for (const sig of [
        "app.invitation_preview(text)",
        "app.accept_invitation(text)",
      ]) {
        const [acl] = (await tx.seed(
          `SELECT has_function_privilege('app_system',$1,'EXECUTE') AS sys,
                  has_function_privilege('public',$1,'EXECUTE') AS pub`,
          [sig],
        )) as Array<{ sys: boolean; pub: boolean }>;
        expect(acl.sys).toBe(true);
        expect(acl.pub).toBe(false);
      }
    });
  });
});
