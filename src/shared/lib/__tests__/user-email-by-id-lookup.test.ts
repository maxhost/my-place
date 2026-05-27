import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlExecutor } from "@/shared/lib/db";
import { lookupUserEmailById } from "../user-email-by-id-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión D.fix. Tests del wrapper TS
// sobre `app.lookup_user_email_by_id` (migration 0023). ESTOS TESTS NO
// VALIDAN LA SQL FUNCTION. La validación de la función SQL (DEFINER bypass,
// LIMIT 1 escalar, GRANTs regression, payload mínimo, ACL EXECUTE) vive en
// `src/db/__tests__/lookup-user-email-by-id.test.ts` (corre `inRlsTx` contra
// la DB real). Acá testeamos exclusivamente la FRONTERA TS: bind del cast
// `::uuid`, Zod parse del payload text, fail-soft a `null` para drift de
// payload (NULL/string vacío/tipo no-string), fail-throw para errores de DB
// (drift de schema, sub UUID inválido por bug del coordinator) que deben
// bubblear al integrator.
//
// Diferencia vs `custom-domain-by-slug-lookup.test.ts` (Sesión A): éste NO
// mockea `pool.query` ni `react.cache` — el wrapper recibe el `SqlExecutor`
// inyectado (sin global state). Los tests son unidad pura sobre la frontera.

let mockSql: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSql = vi.fn();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupUserEmailById — frontera TS sobre app.lookup_user_email_by_id", () => {
  it("happy path: email válido → retorna el string", async () => {
    mockSql.mockResolvedValueOnce([
      { email: "alice@nocodecompany.co" },
    ]);

    const result = await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBe("alice@nocodecompany.co");
    expect(mockSql).toHaveBeenCalledTimes(1);
    const [sqlText, params] = mockSql.mock.calls[0]!;
    expect(sqlText).toContain("app.lookup_user_email_by_id");
    expect(sqlText).toContain("::uuid");
    expect(params).toEqual(["11111111-2222-3333-4444-555555555555"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("email NULL (SQL function no encontró match) → null, sin log de error", async () => {
    mockSql.mockResolvedValueOnce([{ email: null }]);

    const result = await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "00000000-0000-0000-0000-000000000000",
    );

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin filas (defensa, no debería ocurrir) → null, sin log de error", async () => {
    mockSql.mockResolvedValueOnce([]);

    const result = await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("email string vacío (drift extremo) → null + log con prefix de email inválido", async () => {
    // El min(1) del Zod evita propagar un email vacío al integrator (que lo
    // pasaría al panel como string vacío, rompiendo el match check). Mejor
    // degradar a null → variant "unauth" (UX coherente).
    mockSql.mockResolvedValueOnce([{ email: "" }]);

    const result = await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]![0];
    expect(firstArg).toBe(
      "[user-email-by-id-lookup] email inválido para id=",
    );
  });

  it("email con tipo no-string (drift extremo) → null + log con prefix de email inválido", async () => {
    mockSql.mockResolvedValueOnce([{ email: 42 }]);

    const result = await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "11111111-2222-3333-4444-555555555555",
    );

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("DB error (drift de schema, función no existe) → BUBBLES al caller (no silencia)", async () => {
    // Fail-throw deliberado (diferencia vs `custom-domain-by-slug-lookup`
    // que fail-safe a null). El integrator `getCurrentUserEmailForRequest`
    // decide si silenciar (sí, para invite page); pero el wrapper no puede
    // distinguir "drift de schema" de "user no existe" — la primera es bug
    // detectable, la segunda es flujo normal. Bubblear preserva la señal.
    mockSql.mockRejectedValueOnce(
      new Error('function app.lookup_user_email_by_id(uuid) does not exist'),
    );

    await expect(
      lookupUserEmailById(
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
      lookupUserEmailById(mockSql as unknown as SqlExecutor, ""),
    ).rejects.toThrow("invalid input syntax");
  });

  it("pasa sub verbatim sin trim/normalización (UUID canon es lowercase, sin whitespace)", async () => {
    // Diferencia vs `lookupCustomDomainBySlug` que normaliza con trim().
    // toLowerCase(): UUIDs ya son canon-formed (representación estándar
    // lowercase + dashes) y vienen del JWT claim verificado (sin whitespace
    // por el verifier). Acá no agregamos normalización defense-in-depth
    // porque sería ceremony injustificada.
    mockSql.mockResolvedValueOnce([{ email: "a@b.co" }]);

    await lookupUserEmailById(
      mockSql as unknown as SqlExecutor,
      "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    );

    const [, params] = mockSql.mock.calls[0]!;
    // Preserva uppercase tal cual viene; Postgres lo normaliza internamente
    // al cast a uuid (acepta mixed-case en input, almacena lowercase).
    expect(params).toEqual(["AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"]);
  });
});
