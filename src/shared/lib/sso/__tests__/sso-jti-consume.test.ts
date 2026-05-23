import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pool } from "@/db/client";

import { consumeSsoJti } from "../sso-jti-consume";

// Feature C · S8 · sso-jti-consume: tests del wrapper TS sobre
// `app.consume_sso_jti` (SECURITY DEFINER, migration 0011). ESTOS TESTS NO
// VALIDAN LA SQL FUNCTION. La validación de la función SQL (atomic INSERT
// + ON CONFLICT, GC oportunista, REVOKE PUBLIC) vive en
// `src/db/__tests__/consume-sso-jti.test.ts` (corre `inRlsTx` contra Neon
// branch test). Acá testeamos la FRONTERA TS:
//   1. Happy path → mapping del `consume_sso_jti` boolean a return.
//   2. Replay (segunda consume del mismo jti) → `false` legítimo SIN log
//      de error (la falsedad es resultado de negocio, no fallo).
//   3. DB error (fail-secure) → `false` + `console.error` estructurado.
//      Defense-in-depth: el `jti` NO debe aparecer en el log (mitigation
//      contra log scraping de tickets fallidos mid-flow).
//   4. Empty rows defense (no debería ocurrir si la SQL function vive) →
//      `false` + log con prefix específico.
//   5. Schema drift (Zod fail por cambio de payload shape) → `false` +
//      log con prefix específico.
//
// Pattern paralelo a `src/shared/lib/__tests__/custom-domain-lookup.test.ts`:
// mock `pool.query` por test, spy de `console.error` en beforeEach,
// `vi.restoreAllMocks()` en afterEach.

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  mockQuery.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeSsoJti — frontera TS sobre app.consume_sso_jti", () => {
  it("happy path primer consume: SQL retorna true → wrapper retorna true (sin log de error)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ consume_sso_jti: true }],
    } as never);

    const jti = "11111111-2222-4333-8444-555555555555";
    const exp = new Date("2026-05-23T10:30:00.000Z");

    const result = await consumeSsoJti(jti, exp);

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    // Contrato canónico: `SELECT app.consume_sso_jti($1, $2) AS consume_sso_jti`
    // — el AS hace que la row venga con la key estable que el Zod schema
    // del wrapper espera, independiente del nombre de columna que postgres
    // asigne por default a una function call.
    expect(sql).toBe(
      "SELECT app.consume_sso_jti($1, $2) AS consume_sso_jti",
    );
    expect(params).toEqual([jti, exp.toISOString()]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("replay (segundo consume mismo jti): SQL retorna false → wrapper retorna false SIN log de error", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ consume_sso_jti: false }],
    } as never);

    const result = await consumeSsoJti(
      "11111111-2222-4333-8444-555555555555",
      new Date("2026-05-23T10:30:00.000Z"),
    );

    // false legítimo de negocio (replay), NO un fallo del wrapper. El handler
    // S8 mapea este `false` a `?sso_error=replay`, no a un log de DB error.
    expect(result).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("DB error (connection terminated): wrapper retorna false + console.error con prefix DB query failed, y el jti NO aparece en el log", async () => {
    const dbErr = new Error("connection terminated");
    mockQuery.mockRejectedValueOnce(dbErr);

    const jti = "secret-jti-do-not-leak-aaaa-bbbb-cccc-dddddddddddd";
    const exp = new Date("2026-05-23T10:30:00.000Z");

    const result = await consumeSsoJti(jti, exp);

    // Fail-secure: ante DB error, asumimos que el anti-replay NO se ejecutó
    // correctamente → `false`. El handler responde `?sso_error=replay` y el
    // ticket NO se redime. Mejor false-negative que fail-open.
    expect(result).toBe(false);

    expect(console.error).toHaveBeenCalledTimes(1);
    const args = vi.mocked(console.error).mock.calls[0]!;
    // El prefix canónico identifica el módulo + tipo de fallo en logs Vercel.
    expect(args[0]).toBe("[sso-jti-consume] DB query failed");
    // El segundo argumento debe ser el Error real para que ops vea el stack
    // trace (timeout, network, pool exhaustion).
    expect(args[1]).toBe(dbErr);

    // Defense-in-depth: log scraping NO debe poder reconstruir tickets que
    // fallaron mid-flow. El jti raw NO aparece en NINGUNA posición del log.
    for (const arg of args) {
      if (typeof arg === "string") {
        expect(arg.includes(jti)).toBe(false);
      }
    }
  });

  it("empty rows (defensa, no debería ocurrir): wrapper retorna false + console.error con prefix empty result rows", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await consumeSsoJti(
      "11111111-2222-4333-8444-555555555555",
      new Date("2026-05-23T10:30:00.000Z"),
    );

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]![0];
    expect(firstArg).toBe("[sso-jti-consume] empty result rows");
  });

  it("schema drift (Zod fail — boolean expected pero string llegó): wrapper retorna false + console.error con prefix payload schema drift", async () => {
    // Hipotético: si V2 cambia el `RETURNS boolean` a `RETURNS text` (e.g.
    // `'ok' | 'replay'`), el wrapper NO debe interpretar `'yes'` como
    // truthy — debe fail-secure y alertar.
    mockQuery.mockResolvedValueOnce({
      rows: [{ consume_sso_jti: "yes" }],
    } as never);

    const result = await consumeSsoJti(
      "11111111-2222-4333-8444-555555555555",
      new Date("2026-05-23T10:30:00.000Z"),
    );

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]![0];
    expect(firstArg).toBe("[sso-jti-consume] payload schema drift");
  });
});
