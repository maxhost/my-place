import { afterAll, describe, expect, it } from "vitest";
import { ensureAppUser } from "@/shared/lib/ensure-app-user";
import { inTx, testPool } from "@/db/__tests__/db-test-pool";

// S4a: `ensureAppUser` es el guard JIT idempotente (ADR-0006). Se prueba el
// contrato de DB bajo `app_system` con claims inyectados (inTx, ROLLBACK) —
// nunca el rol admin (falso verde por BYPASSRLS). El INSERT de `app_user`
// está sujeto a su RLS self-only (`au_self`: WITH CHECK
// app.current_user_id() = auth_user_id).

afterAll(() => testPool.end());

const ident = (authUserId: string) => ({
  authUserId,
  email: `${authUserId}@example.com`,
  displayName: authUserId.toUpperCase(),
});

const countOf = async (
  q: (t: string, p?: unknown[]) => Promise<unknown[]>,
  authUserId: string,
) =>
  Number(
    (
      (await q(`SELECT count(*)::int n FROM app_user WHERE auth_user_id=$1`, [
        authUserId,
      ])) as Array<{ n: number }>
    )[0].n,
  );

describe("ensureAppUser — idempotencia (ADR-0006)", () => {
  it("dos llamadas con el mismo auth_user_id → un solo app_user, mismo id", async () => {
    await inTx(JSON.stringify({ sub: "authX" }), async (q) => {
      // objetos `ident` distintos por referencia → no los dedupea React.cache:
      // se prueba la idempotencia a nivel DB (ON CONFLICT), no la del cache.
      const id1 = await ensureAppUser(q, ident("authX"));
      const id2 = await ensureAppUser(q, ident("authX"));
      expect(id1).toBe(id2);
      expect(await countOf(q, "authX")).toBe(1);
    });
  });
});

describe("ensureAppUser — RLS self-only (au_self, ADR-0010/0011)", () => {
  it("con claim sub=X puede crear su propio app_user (X)", async () => {
    await inTx(JSON.stringify({ sub: "authA" }), async (q) => {
      const id = await ensureAppUser(q, ident("authA"));
      expect(typeof id).toBe("string");
      expect(await countOf(q, "authA")).toBe(1);
    });
  });

  it("con claim sub=Y NO puede crear el app_user de X (WITH CHECK deniega)", async () => {
    await inTx(JSON.stringify({ sub: "authY" }), async (q) => {
      await expect(ensureAppUser(q, ident("authX"))).rejects.toThrow();
    });
  });

  it("sin claim no puede crear ningún app_user (la policy deniega)", async () => {
    await inTx(null, async (q) => {
      await expect(ensureAppUser(q, ident("authZ"))).rejects.toThrow();
    });
  });
});
