import { afterAll, describe, expect, it } from "vitest";
import { inTx, testPool } from "./db-test-pool";

// S1: el schema `public` aplicado por la migración Drizzle == data-model.md.
// Introspección vía pg_catalog (visible a cualquier rol, no filtra por
// privilegios) bajo `app_system`, nunca el rol admin (CLAUDE.md / tests.md).

afterAll(() => testPool.end());

const CORE_TABLES = [
  "app_user",
  "place",
  "place_domain",
  "membership",
  "place_ownership",
  "invitation",
] as const;

async function rows(sql: string, params?: unknown[]) {
  return inTx(null, (q) => q(sql, params));
}

describe("S1 schema public — tablas del core", () => {
  it("existen las 6 tablas del core en public", async () => {
    const r = (await rows(
      `SELECT relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    )) as Array<{ relname: string }>;
    const names = r.map((x) => x.relname);
    for (const t of CORE_TABLES) expect(names).toContain(t);
  });

  it("las PK usan gen_random_uuid() como default (id TEXT)", async () => {
    const r = (await rows(
      `SELECT c.relname AS tbl,
              pg_get_expr(d.adbin, d.adrelid) AS def,
              format_type(a.atttypid, a.atttypmod) AS typ
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE n.nspname = 'public' AND a.attname = 'id'
         AND c.relname = ANY($1)`,
      [CORE_TABLES as unknown as string[]],
    )) as Array<{ tbl: string; def: string; typ: string }>;
    expect(r.length).toBe(CORE_TABLES.length);
    for (const row of r) {
      expect(row.def).toContain("gen_random_uuid()");
      expect(row.typ).toBe("text");
    }
  });
});

describe("S1 schema public — enums", () => {
  it("billing_mode tiene los 3 valores canónicos", async () => {
    const r = (await rows(
      `SELECT e.enumlabel FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'billing_mode' ORDER BY e.enumsortorder`,
    )) as Array<{ enumlabel: string }>;
    expect(r.map((x) => x.enumlabel)).toEqual([
      "OWNER_PAYS",
      "OWNER_PAYS_AND_CHARGES",
      "SPLIT_AMONG_MEMBERS",
    ]);
  });

  it("place_subscription_status tiene los 4 valores canónicos", async () => {
    const r = (await rows(
      `SELECT e.enumlabel FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'place_subscription_status' ORDER BY e.enumsortorder`,
    )) as Array<{ enumlabel: string }>;
    expect(r.map((x) => x.enumlabel)).toEqual([
      "ACTIVE",
      "PAYMENT_PENDING",
      "INACTIVATION_PROCESS",
      "INACTIVE",
    ]);
  });
});

describe("S1 schema public — constraints e invariantes estructurales", () => {
  async function uniques(table: string) {
    // string_agg (no array_agg): el driver Neon devuelve text[] como literal
    // de Postgres ('{a,b}'), no como array JS.
    const r = (await rows(
      `SELECT con.conname,
              string_agg(att.attname, ',' ORDER BY att.attnum) AS cols
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
       WHERE n.nspname = 'public' AND c.relname = $1 AND con.contype = 'u'
       GROUP BY con.conname`,
      [table],
    )) as Array<{ conname: string; cols: string }>;
    return r.map((x) => ({ conname: x.conname, cols: x.cols.split(",") }));
  }

  it("UNIQUE compuesto (user_id, place_id) en membership y place_ownership", async () => {
    for (const t of ["membership", "place_ownership"]) {
      const u = await uniques(t);
      const hasPair = u.some(
        (x) =>
          x.cols.length === 2 &&
          x.cols.includes("user_id") &&
          x.cols.includes("place_id"),
      );
      expect(hasPair, `${t} debe tener UNIQUE(user_id, place_id)`).toBe(true);
    }
  });

  it("columnas únicas de identidad (app_user, place, place_domain, invitation)", async () => {
    const single = async (table: string, col: string) => {
      const u = await uniques(table);
      return u.some((x) => x.cols.length === 1 && x.cols[0] === col);
    };
    expect(await single("app_user", "auth_user_id")).toBe(true);
    expect(await single("app_user", "email")).toBe(true);
    expect(await single("app_user", "handle")).toBe(true);
    expect(await single("place", "slug")).toBe(true);
    expect(await single("place_domain", "domain")).toBe(true);
    expect(await single("invitation", "token")).toBe(true);
  });

  it("FKs del core apuntan a place/app_user", async () => {
    const r = (await rows(
      `SELECT c.relname AS tbl, cf.relname AS ref
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_class cf ON cf.oid = con.confrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND con.contype = 'f'`,
    )) as Array<{ tbl: string; ref: string }>;
    const has = (tbl: string, ref: string) =>
      r.some((x) => x.tbl === tbl && x.ref === ref);
    expect(has("place_domain", "place")).toBe(true);
    expect(has("membership", "app_user")).toBe(true);
    expect(has("membership", "place")).toBe(true);
    expect(has("place_ownership", "app_user")).toBe(true);
    expect(has("place_ownership", "place")).toBe(true);
    expect(has("invitation", "place")).toBe(true);
  });

  it("defaults JSONB == data-model.md ('{}' / '[]')", async () => {
    const def = async (table: string, col: string) => {
      const r = (await rows(
        `SELECT pg_get_expr(d.adbin, d.adrelid) AS def
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE n.nspname = 'public' AND c.relname = $1 AND a.attname = $2`,
        [table, col],
      )) as Array<{ def: string }>;
      return r[0]?.def ?? "";
    };
    expect(await def("place", "theme_config")).toContain("'{}'");
    expect(await def("place", "opening_hours")).toContain("'{}'");
    expect(await def("place", "enabled_features")).toContain("'[]'");
  });
});

describe("S1 — app.current_user_id() versionada por la migración (ADR-0011)", () => {
  it("la función existe y lee el claim `sub`", async () => {
    const r = (await inTx('{"sub":"user-xyz"}', (q) =>
      q("SELECT app.current_user_id() AS who"),
    )) as Array<{ who: string | null }>;
    expect(r[0].who).toBe("user-xyz");
  });
});
