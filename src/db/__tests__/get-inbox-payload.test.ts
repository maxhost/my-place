import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, type RlsTx } from "./db-test-pool";

// Sesión 2 del Hub V1 (docs/features/inbox/): `app.get_inbox_payload()`
// retorna el payload completo del hub en UNA sola call (perfil + places),
// SECURITY INVOKER bajo RLS extendida por ADR-0021 (migration 0004 + 0005).
// Se siembra como dueño (RLS no aplica) y se baja a `app_system` con el
// claim del caller, igual al patrón canónico de `accept-invitation.test.ts`
// y `create-place.test.ts`. La función es la única fuente de verdad del shape
// del hub; el wrapper TS sólo mapea snake_case → camelCase + tipos.

afterAll(() => endRlsAdminPool());

interface InboxPlaceRow {
  id: string;
  slug: string;
  name: string;
  theme_accent: string | null;
  status: string;
  is_owner: boolean;
  joined_at: string;
}

interface InboxPayloadRow {
  displayName: string | null;
  places: InboxPlaceRow[];
}

// Helpers de seed: corren como dueño (RESET ROLE en `tx.seed`). En runtime
// real estas filas las crearía `app.create_place` / `app.accept_invitation` —
// acá las sembramos directo para construir el escenario sin pasar por las
// funciones (más rápido y enfocado en el shape del payload, no en la creación).

async function seedUser(tx: RlsTx, auth: string, displayName: string) {
  const [{ id }] = (await tx.seed(
    `INSERT INTO app_user (auth_user_id,email,display_name,handle)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [auth, `${auth}@x.com`, displayName, `h_${auth}`],
  )) as Array<{ id: string }>;
  return id;
}

async function seedPlace(
  tx: RlsTx,
  opts: {
    slug: string;
    name: string;
    themeAccent?: string;
    status?: "ACTIVE" | "PAYMENT_PENDING" | "INACTIVATION_PROCESS" | "INACTIVE";
    archived?: boolean;
  },
) {
  const theme = opts.themeAccent
    ? JSON.stringify({ colors: { accent: opts.themeAccent, bg: "#FFF", ink: "#000" } })
    : "{}";
  const [{ id }] = (await tx.seed(
    `INSERT INTO place (slug,name,billing_mode,theme_config,subscription_status,archived_at)
     VALUES ($1,$2,'OWNER_PAYS',$3::jsonb,$4::place_subscription_status,$5)
     RETURNING id`,
    [
      opts.slug,
      opts.name,
      theme,
      opts.status ?? "ACTIVE",
      opts.archived ? new Date().toISOString() : null,
    ],
  )) as Array<{ id: string }>;
  return id;
}

async function makeOwner(tx: RlsTx, userId: string, placeId: string) {
  await tx.seed(`INSERT INTO place_ownership (user_id,place_id) VALUES ($1,$2)`, [
    userId,
    placeId,
  ]);
  // Owner también es miembro (precedente: app.create_place crea ambos).
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [userId, placeId]);
}

async function makeMember(tx: RlsTx, userId: string, placeId: string) {
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [userId, placeId]);
}

// Invoca la función y parsea el JSONB. La columna llega como objeto JS porque
// node-postgres deserializa jsonb por default; tipamos al shape esperado.
async function callGetInboxPayload(tx: RlsTx): Promise<InboxPayloadRow> {
  const [{ payload }] = (await tx.q(
    `SELECT app.get_inbox_payload() AS payload`,
  )) as Array<{ payload: InboxPayloadRow }>;
  return payload;
}

describe("app.get_inbox_payload — shape canónico del Hub (sesión 2, ADR-0021)", () => {
  it("user sin places → {displayName, places: []}", async () => {
    await inRlsTx(async (tx) => {
      await seedUser(tx, "authA", "Ana");
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      expect(payload.displayName).toBe("Ana");
      expect(payload.places).toEqual([]);
    });
  });

  it("user con 2 places owner → alfabético + isOwner:true en ambos", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const pidBosque = await seedPlace(tx, { slug: "bosque", name: "Bosque" });
      const pidAcuario = await seedPlace(tx, { slug: "acuario", name: "Acuario" });
      await makeOwner(tx, uA, pidBosque);
      await makeOwner(tx, uA, pidAcuario);
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      expect(payload.places.map((p) => p.name)).toEqual(["Acuario", "Bosque"]);
      expect(payload.places.every((p) => p.is_owner)).toBe(true);
    });
  });

  it("user miembro (no owner) de 1 place → isOwner:false y joined_at presente", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authO", "Owner");
      const uMember = await seedUser(tx, "authM", "Miembro");
      const pid = await seedPlace(tx, { slug: "yoga", name: "Yoga" });
      await makeOwner(tx, uOwner, pid);
      await makeMember(tx, uMember, pid);
      await tx.as("authM");
      const payload = await callGetInboxPayload(tx);
      expect(payload.places).toHaveLength(1);
      expect(payload.places[0].name).toBe("Yoga");
      expect(payload.places[0].is_owner).toBe(false);
      // joined_at viene como ISO string del JSONB; lo importante es que exista.
      expect(payload.places[0].joined_at).toBeTruthy();
      expect(new Date(payload.places[0].joined_at).getTime()).not.toBeNaN();
    });
  });

  it("mixto owner+miembro → owner-first y alfabético DENTRO de cada grupo", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const uOwnerExt = await seedUser(tx, "authX", "Otro");
      const pidAcuario = await seedPlace(tx, { slug: "acuario", name: "Acuario" });
      const pidZoom = await seedPlace(tx, { slug: "zoom", name: "Zoom" });
      const pidBosque = await seedPlace(tx, { slug: "bosque", name: "Bosque" });
      await makeOwner(tx, uA, pidAcuario);
      await makeOwner(tx, uA, pidZoom);
      await makeOwner(tx, uOwnerExt, pidBosque);
      await makeMember(tx, uA, pidBosque); // uA es miembro (no owner) de Bosque
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      // Owner first (Acuario, Zoom — alfabético), después miembro (Bosque).
      expect(payload.places.map((p) => p.name)).toEqual(["Acuario", "Zoom", "Bosque"]);
      expect(payload.places.map((p) => p.is_owner)).toEqual([true, true, false]);
    });
  });

  it("places archivados (archived_at NOT NULL) NO aparecen", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const pidActivo = await seedPlace(tx, { slug: "activo", name: "Activo" });
      const pidArchivado = await seedPlace(tx, {
        slug: "archivado",
        name: "Archivado",
        archived: true,
      });
      await makeOwner(tx, uA, pidActivo);
      await makeOwner(tx, uA, pidArchivado);
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      expect(payload.places.map((p) => p.name)).toEqual(["Activo"]);
    });
  });

  it("theme_accent se extrae de theme_config.colors.accent", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const pid = await seedPlace(tx, {
        slug: "mi-club",
        name: "Mi Club",
        themeAccent: "#aabbcc",
      });
      await makeOwner(tx, uA, pid);
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      expect(payload.places[0].theme_accent).toBe("#aabbcc");
    });
  });

  it("status viene como string del enum (ACTIVE / PAYMENT_PENDING / INACTIVATION_PROCESS / INACTIVE)", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const pidA = await seedPlace(tx, { slug: "a", name: "AAA", status: "ACTIVE" });
      const pidB = await seedPlace(tx, { slug: "b", name: "BBB", status: "PAYMENT_PENDING" });
      const pidC = await seedPlace(tx, {
        slug: "c",
        name: "CCC",
        status: "INACTIVATION_PROCESS",
      });
      const pidD = await seedPlace(tx, { slug: "d", name: "DDD", status: "INACTIVE" });
      await makeOwner(tx, uA, pidA);
      await makeOwner(tx, uA, pidB);
      await makeOwner(tx, uA, pidC);
      await makeOwner(tx, uA, pidD);
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      const byName = Object.fromEntries(payload.places.map((p) => [p.name, p.status]));
      expect(byName).toEqual({
        AAA: "ACTIVE",
        BBB: "PAYMENT_PENDING",
        CCC: "INACTIVATION_PROCESS",
        DDD: "INACTIVE",
      });
    });
  });

  it("places no-ACTIVE aparecen igual (el filtro de acciones es del frontend)", async () => {
    await inRlsTx(async (tx) => {
      const uA = await seedUser(tx, "authA", "Ana");
      const pid = await seedPlace(tx, {
        slug: "pago-pendiente",
        name: "Pago Pendiente",
        status: "PAYMENT_PENDING",
      });
      await makeOwner(tx, uA, pid);
      await tx.as("authA");
      const payload = await callGetInboxPayload(tx);
      expect(payload.places).toHaveLength(1);
      expect(payload.places[0].status).toBe("PAYMENT_PENDING");
    });
  });

  it("sin claim (no autenticado) → lanza excepción SQLSTATE 28000", async () => {
    await inRlsTx(async (tx) => {
      await seedUser(tx, "authA", "Ana");
      await tx.as(null);
      expect(await tx.denied(`SELECT app.get_inbox_payload()`)).toBe(true);
    });
  });

  it("claim válido pero sin app_user → displayName:null, places:[]", async () => {
    await inRlsTx(async (tx) => {
      // No seed de app_user; el claim 'ghost' no matchea ningún auth_user_id.
      await tx.as("ghost");
      const payload = await callGetInboxPayload(tx);
      expect(payload.displayName).toBeNull();
      expect(payload.places).toEqual([]);
    });
  });

  it("EXECUTE concedido a app_system y denegado a PUBLIC", async () => {
    await inRlsTx(async (tx) => {
      const sig = "app.get_inbox_payload()";
      const [acl] = (await tx.seed(
        `SELECT has_function_privilege('app_system',$1,'EXECUTE') AS sys,
                has_function_privilege('public',$1,'EXECUTE') AS pub`,
        [sig],
      )) as Array<{ sys: boolean; pub: boolean }>;
      expect(acl.sys).toBe(true);
      expect(acl.pub).toBe(false);
    });
  });
});
