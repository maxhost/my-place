import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlExecutor } from "@/shared/lib/db";
import { lookupUserIdentityById } from "../user-identity-by-id-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix.3. Tests del wrapper TS
// sobre `app.lookup_user_identity_by_id` (migration 0024). ESTOS TESTS NO
// VALIDAN LA SQL FUNCTION. La validación de la función SQL (DEFINER bypass,
// LIMIT 1, GRANTs regression, payload mínimo, ACL EXECUTE) vive en
// `src/db/__tests__/lookup-user-identity-by-id.test.ts` (corre `inRlsTx`
// contra la DB real). Acá testeamos exclusivamente la FRONTERA TS: bind del
// cast `::uuid`, Zod parse del payload jsonb, fail-soft a `null` para drift
// de payload (NULL/objeto inválido/faltan campos), fail-throw para errores
// de DB (drift de schema, sub UUID inválido) que deben bubblear al integrator.
//
// Espejo estructural de `user-email-by-id-lookup.test.ts` (D.fix.1) — sólo
// difiere en el shape del payload (jsonb objeto en lugar de text escalar).

let mockSql: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSql = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupUserIdentityById — frontera TS sobre app.lookup_user_identity_by_id", () => {
  it("happy path: payload válido → retorna el objeto {email, name}", async () => {
    mockSql.mockResolvedValueOnce([
      { payload: { email: "alice@nocodecompany.co", name: "Alice" } },
    ]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toEqual({
      email: "alice@nocodecompany.co",
      name: "Alice",
    });
    expect(mockSql).toHaveBeenCalledTimes(1);
    const [sqlText, params] = mockSql.mock.calls[0]!;
    expect(sqlText).toContain("app.lookup_user_identity_by_id");
    expect(sqlText).toContain("::uuid");
    expect(params).toEqual(["11111111-2222-3333-4444-555555555555"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("payload NULL (SQL function no encontró match) → null, sin log de error", async () => {
    mockSql.mockResolvedValueOnce([{ payload: null }]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin filas (defensa, no debería ocurrir) → null, sin log de error", async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("payload con email vacío (drift extremo) → null + log con prefix de payload inválido", async () => {
    // El min(1) del email Zod evita propagar un email vacío al integrator
    // (que lo pasaría al action como string vacío, rompiendo `ensureAppUser`
    // o el accept_invitation DEFINER). Mejor degradar a null → caller
    // recibe `unauthenticated`.
    mockSql.mockResolvedValueOnce([{ payload: { email: "", name: "X" } }]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]![0];
    expect(firstArg).toBe(
      "[user-identity-by-id-lookup] payload inválido para id=",
    );
  });

  it("payload con name no-string (drift extremo de schema Neon Auth) → null + log", async () => {
    mockSql.mockResolvedValueOnce([
      { payload: { email: "a@b.co", name: 42 } },
    ]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("payload sin campo `name` (drift de schema Neon Auth) → null + log", async () => {
    // Si Neon Auth removiera `name` del schema base, el migration 0024
    // necesitaría re-deploy. Mientras tanto, Zod fail-soft → null → caller
    // recibe `unauthenticated` en lugar de crash.
    mockSql.mockResolvedValueOnce([{ payload: { email: "a@b.co" } }]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("payload tipo no-objeto (drift extremo) → null + log", async () => {
    mockSql.mockResolvedValueOnce([{ payload: "not-an-object" }]);

    const result = await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("DB error (drift de schema, función no existe) → BUBBLES al caller (no silencia)", async () => {
    // Fail-throw deliberado. El integrator `getCurrentUserIdentityForRequest`
    // decide si silenciar (sí, para invite page reader; sí también para
    // Server Action via NoSessionError); pero el wrapper no puede distinguir
    // "drift de schema" de "user no existe" — la primera es bug detectable,
    // la segunda es flujo normal. Bubblear preserva la señal.
    mockSql.mockRejectedValueOnce(
      new Error('function app.lookup_user_identity_by_id(uuid) does not exist'),
    );

    await expect(
      lookupUserIdentityById(
        mockSql as unknown as SqlExecutor,
        "11111111-2222-3333-4444-555555555555",
      ),
    ).rejects.toThrow("does not exist");
  });

  it("sub UUID inválido (drift de coordinator) → BUBBLES (Postgres syntax error)", async () => {
    // Defense-in-depth: el coordinator garantiza claims.sub válido, pero si
    // por bug futuro un sub no-UUID llega acá, Postgres tira syntax error.
    // Bubblear permite detectar el bug; silenciar lo escondería.
    mockSql.mockRejectedValueOnce(
      new Error('invalid input syntax for type uuid: ""'),
    );

    await expect(
      lookupUserIdentityById(mockSql as unknown as SqlExecutor, ""),
    ).rejects.toThrow("invalid input syntax");
  });

  it("pasa sub verbatim sin trim/normalización (UUID canon es lowercase, sin whitespace)", async () => {
    // Diferencia vs `lookupCustomDomainBySlug` que normaliza con trim().
    // toLowerCase(): UUIDs ya son canon-formed y vienen del JWT claim
    // verificado (sin whitespace).
    mockSql.mockResolvedValueOnce([
      { payload: { email: "a@b.co", name: "X" } },
    ]);

    await lookupUserIdentityById(
      mockSql as unknown as SqlExecutor,
      "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    );

    const [, params] = mockSql.mock.calls[0]!;
    expect(params).toEqual(["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"]);
  });
});
