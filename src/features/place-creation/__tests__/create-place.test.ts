import { describe, expect, it, vi } from "vitest";
import { createPlace } from "../create-place";
import type { CreatePlacePorts } from "../ports";
import type { SqlExecutor } from "@/shared/lib/db";

// S5b: la SAGA es orquestación pura. El borde cross-system (signUp/token de
// Neon Auth — ADR-0005 §2) y la DB se inyectan como PUERTOS (mismo seam-split
// que S4b: el wiring vivo del SDK se verifica en preview, no en vitest).
//
// Fake DB con semántica de TX POR invocación: cada `runAuthedTx` es una tx
// independiente que commitea al volver o rollbackea si `fn` lanza. Así la
// frontera two-tx de ADR-0005 §4 se expresa estructuralmente (dos
// invocaciones = dos commits separados; el rollback de la 2ª no toca la 1ª).
// Modela `au_self` (INSERT de app_user sólo con auth_user_id === claims.sub),
// P0002 (app_user del caller inexistente) y UNIQUE(slug) (→ '23505').
//
// Phase 1.B — el port `runAuthedTx` ya no recibe `accessToken` (el
// coordinator zone-aware `getAuthenticatedDbForRequest` lo lee internamente).
// El FakeDb expone `setSub(sub)` para que cada test configure el `claims.sub`
// que el callback recibe — equivalente al token-as-claims-vehicle previo,
// sin el dead field `accessToken` en `AcquiredIdentity`.

interface PlaceRow {
  id: string;
  ownerAuth: string;
  members: string[];
  /** S2a.2: 6º arg de `app.create_place` — valida que la saga propaga el
   *  locale del payload hasta el SP (zod default 'es' → caller → SP).
   *  `undefined` significa que la saga llamó al overload 5-arg viejo. */
  defaultLocale: string | undefined;
}

class FakeDb {
  appUsers = new Map<string, { id: string; email: string }>(); // key auth_user_id
  places = new Map<string, PlaceRow>(); // key slug
  txCount = 0;
  calls: string[] = [];
  /** `claims.sub` que el coordinator inyecta al callback. Configurable por
   *  test antes de invocar `createPlace` — análogo al `JSON.parse(accessToken)`
   *  del fake previo, sin el bridge via port. */
  currentSub = "auth-default";
  private seq = 0;

  private exec(
    appUsers: Map<string, { id: string; email: string }>,
    places: Map<string, PlaceRow>,
    claims: { sub: string },
  ): SqlExecutor {
    return async (text, params = []) => {
      if (text.includes("INSERT INTO app_user")) {
        this.calls.push("ensureAppUser");
        const [authUserId, email] = params as string[];
        // au_self: WITH CHECK app.current_user_id() = auth_user_id.
        if (authUserId !== claims.sub) {
          throw Object.assign(new Error("au_self deniega"), { code: "42501" });
        }
        if (appUsers.has(authUserId)) return []; // ON CONFLICT DO NOTHING
        const id = `user-${++this.seq}`;
        appUsers.set(authUserId, { id, email });
        return [{ id }];
      }
      if (text.includes("SELECT id FROM app_user")) {
        const [authUserId] = params as string[];
        const row = appUsers.get(authUserId);
        return row ? [{ id: row.id }] : [];
      }
      if (text.includes("app.create_place")) {
        this.calls.push("create_place");
        // S2a.2: overload 6-arg de migration 0007. El 6º param es
        // `default_locale`; se preserva en el row para que los tests assertten
        // que la saga lo propaga desde el zod (default 'es' o el explícito).
        const [slug, , , , , defaultLocale] = params as string[];
        const caller = appUsers.get(claims.sub);
        if (!caller) {
          throw Object.assign(new Error("app_user inexistente"), {
            code: "P0002",
          });
        }
        if (places.has(slug)) {
          throw Object.assign(new Error("slug duplicado"), { code: "23505" });
        }
        const id = `place-${++this.seq}`;
        // mín 1 owner: la función crea ownership+membership del caller, atómico.
        places.set(slug, {
          id,
          ownerAuth: claims.sub,
          members: [claims.sub],
          defaultLocale,
        });
        return [{ place_id: id }];
      }
      throw new Error(`query no modelada: ${text}`);
    };
  }

  runAuthedTx: CreatePlacePorts["runAuthedTx"] = async (fn) => {
    this.txCount += 1;
    const claims = { sub: this.currentSub };
    const stagedUsers = new Map(this.appUsers);
    const stagedPlaces = new Map(this.places);
    const result = await fn(this.exec(stagedUsers, stagedPlaces, claims), claims);
    // COMMIT: recién al volver sin lanzar se publica el estado.
    this.appUsers = stagedUsers;
    this.places = stagedPlaces;
    return result;
  };
}

const VALID_INPUT = {
  name: "Mi Comunidad",
  slug: "mi-comunidad",
  ownerTimezone: "America/Argentina/Buenos_Aires",
};

describe("createPlace — saga de orquestación (ADR-0005/0008/0012)", () => {
  it("happy path place-first: dominio → ensureAppUser → create_place, dos tx", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-1";
    const acquireIdentity = vi.fn(async () => ({
      email: "ana@example.com",
      displayName: "Ana",
    }));
    const res = await createPlace(VALID_INPUT, {
      acquireIdentity,
      runAuthedTx: db.runAuthedTx,
    });

    expect(res.status).toBe("created");
    if (res.status !== "created") throw new Error("unreachable");
    expect(res.slug).toBe("mi-comunidad");
    expect(res.placeId).toMatch(/^place-/);
    expect(db.calls).toEqual(["ensureAppUser", "create_place"]); // orden
    expect(db.txCount).toBe(2); // frontera two-tx (ADR-0005 §4)
    expect(db.appUsers.get("auth-1")?.email).toBe("ana@example.com");
    expect(db.places.get("mi-comunidad")?.ownerAuth).toBe("auth-1");
  });

  it("happy path authed (idempotente): app_user ya existe → no se duplica", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-7";
    db.appUsers.set("auth-7", { id: "user-pre", email: "leo@example.com" });
    const res = await createPlace(VALID_INPUT, {
      acquireIdentity: async () => ({
        email: "leo@example.com",
        displayName: "Leo",
      }),
      runAuthedTx: db.runAuthedTx,
    });

    expect(res.status).toBe("created");
    expect(db.appUsers.size).toBe(1); // ON CONFLICT DO NOTHING → sin duplicado
    expect(db.appUsers.get("auth-7")?.id).toBe("user-pre");
  });

  it("identidad = claim VERIFICADO (claims.sub), no el user.id de signUp", async () => {
    const db = new FakeDb();
    // El coordinator inyecta el sub REAL; `acquireIdentity` solo trae
    // email/displayName (NO authUserId). Si la saga usara algo distinto a
    // `claims.sub`, `au_self` la rechazaría con 42501.
    db.currentSub = "auth-real";
    const res = await createPlace(VALID_INPUT, {
      acquireIdentity: async () => ({
        email: "z@example.com",
        displayName: "Z",
      }),
      runAuthedTx: db.runAuthedTx,
    });
    expect(res.status).toBe("created");
    expect([...db.appUsers.keys()]).toEqual(["auth-real"]);
  });

  it("payload inválido → status invalid; NO se toca identidad ni DB", async () => {
    const db = new FakeDb();
    const acquireIdentity = vi.fn();
    const res = await createPlace(
      { ...VALID_INPUT, slug: "ab" },
      { acquireIdentity, runAuthedTx: db.runAuthedTx },
    );

    expect(res.status).toBe("invalid");
    if (res.status !== "invalid") throw new Error("unreachable");
    expect(res.fields).toContain("slug");
    expect(acquireIdentity).not.toHaveBeenCalled();
    expect(db.txCount).toBe(0);
  });

  it("falla de signUp (acquireIdentity lanza) → nada creado, no llega a DB", async () => {
    const db = new FakeDb();
    await expect(
      createPlace(VALID_INPUT, {
        acquireIdentity: async () => {
          throw new Error("signUp falló");
        },
        runAuthedTx: db.runAuthedTx,
      }),
    ).rejects.toThrow("signUp falló");
    expect(db.txCount).toBe(0);
    expect(db.appUsers.size).toBe(0);
    expect(db.places.size).toBe(0);
  });

  it("slug ocupado → 'slug_taken'; cuenta+app_user QUEDA (cuenta sin place)", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-9";
    db.places.set("mi-comunidad", {
      id: "place-x",
      ownerAuth: "otro",
      members: ["otro"],
      defaultLocale: "es",
    });
    const res = await createPlace(VALID_INPUT, {
      acquireIdentity: async () => ({
        email: "n@example.com",
        displayName: "N",
      }),
      runAuthedTx: db.runAuthedTx,
    });

    expect(res.status).toBe("slug_taken");
    // TX 1 commiteó: la cuenta persiste pese al rollback de TX 2.
    expect(db.appUsers.get("auth-9")?.email).toBe("n@example.com");
    // Atomicidad: ni place propio ni ownership/membership huérfanos.
    expect(db.places.get("mi-comunidad")?.ownerAuth).toBe("otro");
    expect(db.places.size).toBe(1);
  });

  // S2a.2 (ADR-0022/0024): `defaultLocale` viaja del payload del wizard al SP.
  // Zod default 'es' si el campo no aparece; el caller envía SIEMPRE el overload
  // 6-arg de migration 0007. El zod cierra el set a los 6 locales operativos.

  it("defaultLocale: zod default 'es' cuando el payload no lo especifica", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-loc-1";
    const res = await createPlace(VALID_INPUT, {
      acquireIdentity: async () => ({
        email: "l@example.com",
        displayName: "L",
      }),
      runAuthedTx: db.runAuthedTx,
    });
    expect(res.status).toBe("created");
    expect(db.places.get("mi-comunidad")?.defaultLocale).toBe("es");
  });

  it("defaultLocale: 'de' explícito en payload se propaga al SP (6º arg)", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-loc-2";
    const res = await createPlace(
      { ...VALID_INPUT, defaultLocale: "de" },
      {
        acquireIdentity: async () => ({
          email: "d@example.com",
          displayName: "D",
        }),
        runAuthedTx: db.runAuthedTx,
      },
    );
    expect(res.status).toBe("created");
    expect(db.places.get("mi-comunidad")?.defaultLocale).toBe("de");
  });

  it("error DB inesperado en create_place → propaga; cuenta persiste igual", async () => {
    const db = new FakeDb();
    db.currentSub = "auth-5";
    const boom: CreatePlacePorts["runAuthedTx"] = async (fn) => {
      if (db.txCount === 0) return db.runAuthedTx(fn); // TX 1 ok
      db.txCount += 1;
      throw Object.assign(new Error("conexión caída"), { code: "08006" });
    };
    await expect(
      createPlace(VALID_INPUT, {
        acquireIdentity: async () => ({
          email: "e@example.com",
          displayName: "E",
        }),
        runAuthedTx: boom,
      }),
    ).rejects.toThrow("conexión caída");
    expect(db.appUsers.get("auth-5")?.email).toBe("e@example.com");
    expect(db.places.size).toBe(0);
  });
});
