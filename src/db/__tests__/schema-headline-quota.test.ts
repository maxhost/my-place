import { afterAll, describe, expect, it } from "vitest";
import { endRlsAdminPool, inRlsTx, inTx, testPool } from "./db-test-pool";

// Feature E · S1 (ADR-0036 §1 + ADR-0037 §1, 2026-05-24) — tests
// estructurales del schema delta de la migration 0017. Verifica las 2
// columnas nuevas (`membership.headline` + `place.member_invite_quota`)
// con sus CHECK constraints + defaults.
//
// Patrón: introspección vía pg_catalog (`inTx`) para existencia / typing /
// defaults; `inRlsTx.seed` (admin bypass) para INSERT/UPDATE bajo CHECK
// constraint (queremos verificar el rechazo del constraint, no la RLS).
//
// Mapping 1:1 con `docs/features/members/tests.md` §S1 (12 tests).

afterAll(async () => {
  await testPool.end();
  await endRlsAdminPool();
});

async function rows(sql: string, params?: unknown[]) {
  return inTx(null, (q) => q(sql, params));
}

// Captura el error de una query bajo SAVEPOINT (un stmt fallido aborta la tx
// en Postgres; el savepoint preserva el resto). Mismo helper que
// `elevate-to-owner.test.ts` — `tx.seed` para ejecutar como dueño y poder
// triggerar el CHECK constraint (no la RLS).
async function captureSeedError(
  tx: {
    seed: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
    q: (s: string, p?: unknown[]) => Promise<Record<string, unknown>[]>;
  },
  sql: string,
  params?: unknown[],
): Promise<{ code: string | null; message: string | null }> {
  // RESET ROLE explícito al admin para poder bypassar RLS y ejercer CHECK.
  await tx.q("SAVEPOINT sp_err");
  let result: { code: string | null; message: string | null } = {
    code: null,
    message: null,
  };
  try {
    await tx.seed(sql, params);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    result = { code: err.code ?? null, message: err.message ?? null };
  }
  await tx.q("ROLLBACK TO SAVEPOINT sp_err");
  await tx.q("RELEASE SAVEPOINT sp_err");
  return result;
}

const APP_USER = `INSERT INTO app_user (auth_user_id,email,display_name,handle)
                  VALUES ($1,$2,'X',$3) RETURNING id`;
const PLACE = `INSERT INTO place (slug,name,billing_mode,founder_user_id)
               VALUES ($1,$2,'OWNER_PAYS',$3) RETURNING id`;
const MEMBERSHIP = `INSERT INTO membership (user_id,place_id) VALUES ($1,$2) RETURNING id`;

describe("S1 schema — membership.headline column (ADR-0036)", () => {
  it("existe con tipo text y NULL aceptado", async () => {
    const r = (await rows(
      `SELECT format_type(a.atttypid, a.atttypmod) AS typ,
              a.attnotnull AS notnull
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'membership' AND a.attname = 'headline'`,
    )) as Array<{ typ: string; notnull: boolean }>;
    expect(r).toHaveLength(1);
    expect(r[0].typ).toBe("text");
    expect(r[0].notnull).toBe(false);
  });

  it("CHECK constraint rechaza string de 281 chars (23514 check_violation)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const [{ id: mid }] = (await tx.seed(MEMBERSHIP, [uid, pid])) as Array<{ id: string }>;
      const tooLong = "x".repeat(281);
      const err = await captureSeedError(
        tx,
        `UPDATE membership SET headline = $1 WHERE id = $2`,
        [tooLong, mid],
      );
      expect(err.code).toBe("23514");
      expect((err.message ?? "").toLowerCase()).toContain("headline");
    });
  });

  it("CHECK acepta exactly 280 chars (boundary)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const [{ id: mid }] = (await tx.seed(MEMBERSHIP, [uid, pid])) as Array<{ id: string }>;
      const exact = "x".repeat(280);
      await tx.seed(`UPDATE membership SET headline = $1 WHERE id = $2`, [exact, mid]);
      const r = (await tx.seed(`SELECT length(headline) AS n FROM membership WHERE id = $1`, [mid])) as Array<{ n: number }>;
      expect(r[0].n).toBe(280);
    });
  });

  it("CHECK acepta NULL explícito", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const [{ id: mid }] = (await tx.seed(MEMBERSHIP, [uid, pid])) as Array<{ id: string }>;
      // Set a value first, then reset to NULL — exercises CHECK NULL path
      await tx.seed(`UPDATE membership SET headline = 'foo' WHERE id = $1`, [mid]);
      await tx.seed(`UPDATE membership SET headline = NULL WHERE id = $1`, [mid]);
      const r = (await tx.seed(`SELECT headline FROM membership WHERE id = $1`, [mid])) as Array<{ headline: string | null }>;
      expect(r[0].headline).toBeNull();
    });
  });

  it("CHECK acepta empty string '' (length 0)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const [{ id: mid }] = (await tx.seed(MEMBERSHIP, [uid, pid])) as Array<{ id: string }>;
      await tx.seed(`UPDATE membership SET headline = '' WHERE id = $1`, [mid]);
      const r = (await tx.seed(`SELECT headline FROM membership WHERE id = $1`, [mid])) as Array<{ headline: string }>;
      expect(r[0].headline).toBe("");
    });
  });

  it("UPDATE 280→500 chars falla 23514 (no shrink-only path)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const [{ id: mid }] = (await tx.seed(MEMBERSHIP, [uid, pid])) as Array<{ id: string }>;
      await tx.seed(`UPDATE membership SET headline = $1 WHERE id = $2`, ["x".repeat(280), mid]);
      const err = await captureSeedError(
        tx,
        `UPDATE membership SET headline = $1 WHERE id = $2`,
        ["y".repeat(500), mid],
      );
      expect(err.code).toBe("23514");
    });
  });
});

describe("S1 schema — place.member_invite_quota column (ADR-0037)", () => {
  it("existe con tipo int y NOT NULL", async () => {
    const r = (await rows(
      `SELECT format_type(a.atttypid, a.atttypmod) AS typ,
              a.attnotnull AS notnull
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'place' AND a.attname = 'member_invite_quota'`,
    )) as Array<{ typ: string; notnull: boolean }>;
    expect(r).toHaveLength(1);
    expect(r[0].typ).toBe("integer");
    expect(r[0].notnull).toBe(true);
  });

  it("DEFAULT 0 — INSERT INTO place sin la columna aplica 0", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const r = (await tx.seed(
        `SELECT member_invite_quota FROM place WHERE id = $1`,
        [pid],
      )) as Array<{ member_invite_quota: number }>;
      expect(r[0].member_invite_quota).toBe(0);
    });
  });

  it("CHECK rechaza -1 (23514)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      const err = await captureSeedError(
        tx,
        `UPDATE place SET member_invite_quota = -1 WHERE id = $1`,
        [pid],
      );
      expect(err.code).toBe("23514");
      expect((err.message ?? "").toLowerCase()).toContain("member_invite_quota");
    });
  });

  it("CHECK acepta 0 (boundary)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      await tx.seed(`UPDATE place SET member_invite_quota = 0 WHERE id = $1`, [pid]);
      const r = (await tx.seed(
        `SELECT member_invite_quota FROM place WHERE id = $1`,
        [pid],
      )) as Array<{ member_invite_quota: number }>;
      expect(r[0].member_invite_quota).toBe(0);
    });
  });

  it("CHECK acepta valores grandes (1000, 1000000)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      await tx.seed(`UPDATE place SET member_invite_quota = 1000 WHERE id = $1`, [pid]);
      await tx.seed(`UPDATE place SET member_invite_quota = 1000000 WHERE id = $1`, [pid]);
      const r = (await tx.seed(
        `SELECT member_invite_quota FROM place WHERE id = $1`,
        [pid],
      )) as Array<{ member_invite_quota: number }>;
      expect(r[0].member_invite_quota).toBe(1000000);
    });
  });

  it("UPDATE 0→5 succeeds (placeholder de editabilidad V2+)", async () => {
    await inRlsTx(async (tx) => {
      const [{ id: uid }] = (await tx.seed(APP_USER, [
        "authA",
        "a@x.com",
        "h_a",
      ])) as Array<{ id: string }>;
      const [{ id: pid }] = (await tx.seed(PLACE, ["p-a", "Place A", uid])) as Array<{ id: string }>;
      await tx.seed(`UPDATE place SET member_invite_quota = 5 WHERE id = $1`, [pid]);
      const r = (await tx.seed(
        `SELECT member_invite_quota FROM place WHERE id = $1`,
        [pid],
      )) as Array<{ member_invite_quota: number }>;
      expect(r[0].member_invite_quota).toBe(5);
    });
  });
});
