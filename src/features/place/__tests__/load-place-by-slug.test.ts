import { afterAll, describe, expect, it } from "vitest";
import {
  endRlsAdminPool,
  inRlsTx,
  type RlsTx,
} from "@/db/__tests__/db-test-pool";
import {
  loadPlaceBySlug,
  PLACE_LOCALES,
  type PlaceLocale,
} from "@/features/place/public";

// S3 del feature `settings` (`docs/features/settings/spec.md` + plan-sesiones).
// `loadPlaceBySlug` retorna `PlaceData | null` filtrado por la RLS owner-only
// del SELECT en `place` (policy `place_sel`, `schema/index.ts:121`). El page
// del settings (S6) lo invoca dentro de `getAuthenticatedDb(...)` — el claim
// del caller activa la policy.
//
// Patrón de seed: idéntico a `get-inbox-payload.test.ts` (siembra como dueño
// vía `tx.seed`, baja a `app_system` con `tx.as(claim)`, aserta vía el
// wrapper TS que recibe `tx.q` como `SqlExecutor`). Eso valida el wrapper
// real (no SQL inline) y la RLS al mismo tiempo.

afterAll(() => endRlsAdminPool());

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
    defaultLocale?: PlaceLocale;
    themeAccent?: string;
    archived?: boolean;
  },
) {
  const theme = opts.themeAccent
    ? JSON.stringify({
        colors: { accent: opts.themeAccent, bg: "#FFFFFF", ink: "#111111" },
      })
    : "{}";
  const [{ id }] = (await tx.seed(
    `INSERT INTO place (slug,name,billing_mode,theme_config,default_locale,archived_at)
     VALUES ($1,$2,'OWNER_PAYS',$3::jsonb,$4,$5)
     RETURNING id`,
    [
      opts.slug,
      opts.name,
      theme,
      opts.defaultLocale ?? "es",
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
  // Owner también es miembro (precedente: app.create_place siembra ambos).
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    userId,
    placeId,
  ]);
}

async function makeMember(tx: RlsTx, userId: string, placeId: string) {
  await tx.seed(`INSERT INTO membership (user_id,place_id) VALUES ($1,$2)`, [
    userId,
    placeId,
  ]);
}

describe("loadPlaceBySlug — RLS owner-only del settings (S3, ADR-0010 + ADR-0022)", () => {
  it("owner del place → retorna PlaceData con todos los campos", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const pid = await seedPlace(tx, {
        slug: "mi-club",
        name: "Mi Club",
        themeAccent: "#aabbcc",
      });
      await makeOwner(tx, uOwner, pid);
      await tx.as("authOwner");

      const place = await loadPlaceBySlug(tx.q, "mi-club");

      expect(place).not.toBeNull();
      if (place === null) return; // type-narrow para el resto
      expect(place.id).toBe(pid);
      expect(place.slug).toBe("mi-club");
      expect(place.name).toBe("Mi Club");
      expect(place.themeConfig).toEqual({
        colors: { accent: "#aabbcc", bg: "#FFFFFF", ink: "#111111" },
      });
      // defaultLocale default es 'es' cuando no se pasa al seed.
      expect(place.defaultLocale).toBe("es");
    });
  });

  it("defaultLocale viene como PlaceLocale literal (validar contra PLACE_LOCALES)", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const pid = await seedPlace(tx, {
        slug: "ein-platz",
        name: "Ein Platz",
        defaultLocale: "de",
      });
      await makeOwner(tx, uOwner, pid);
      await tx.as("authOwner");

      const place = await loadPlaceBySlug(tx.q, "ein-platz");

      expect(place).not.toBeNull();
      if (place === null) return;
      expect(place.defaultLocale).toBe("de");
      // El valor debe pertenecer al universo cerrado del slice — defense-in-depth
      // contra drift entre el CHECK constraint de la DB y `PLACE_LOCALES`.
      expect((PLACE_LOCALES as readonly string[]).includes(place.defaultLocale)).toBe(
        true,
      );
    });
  });

  it("no-owner, no-member → retorna null (RLS filtra)", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const uOutsider = await seedUser(tx, "authOutsider", "Outsider");
      const pid = await seedPlace(tx, { slug: "ajeno", name: "Ajeno" });
      await makeOwner(tx, uOwner, pid);
      // uOutsider NO tiene ownership ni membership.
      void uOutsider;
      await tx.as("authOutsider");

      const place = await loadPlaceBySlug(tx.q, "ajeno");

      expect(place).toBeNull();
    });
  });

  it("member no-owner → retorna null (settings es owner-only, NO usa member-read)", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const uMember = await seedUser(tx, "authMember", "Member");
      const pid = await seedPlace(tx, { slug: "yoga", name: "Yoga" });
      await makeOwner(tx, uOwner, pid);
      await makeMember(tx, uMember, pid);
      await tx.as("authMember");

      const place = await loadPlaceBySlug(tx.q, "yoga");

      expect(place).toBeNull();
    });
  });

  it("slug inexistente → retorna null", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const pid = await seedPlace(tx, { slug: "mio", name: "Mio" });
      await makeOwner(tx, uOwner, pid);
      await tx.as("authOwner");

      const place = await loadPlaceBySlug(tx.q, "no-existo");

      expect(place).toBeNull();
    });
  });

  it("place archived_at NOT NULL → retorna null (lifecycle: archivados no son servibles)", async () => {
    await inRlsTx(async (tx) => {
      const uOwner = await seedUser(tx, "authOwner", "Owner");
      const pid = await seedPlace(tx, {
        slug: "archivado",
        name: "Archivado",
        archived: true,
      });
      await makeOwner(tx, uOwner, pid);
      await tx.as("authOwner");

      const place = await loadPlaceBySlug(tx.q, "archivado");

      expect(place).toBeNull();
    });
  });
});
