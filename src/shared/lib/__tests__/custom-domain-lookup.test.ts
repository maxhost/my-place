import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pool } from "@/db/client";

import { lookupPlaceByDomain } from "../custom-domain-lookup";

// Feature B — Tests del wrapper TS sobre `app.lookup_place_by_domain` (S1).
// ESTOS TESTS NO VALIDAN LA SQL FUNCTION. La validación de la función SQL
// (RLS bypass controlado, filtros verified/archived, payload jsonb) vive en
// `src/db/__tests__/lookup-place-by-domain.test.ts` (corre `inRlsTx` contra
// la DB real, branches dev/test). Acá testeamos exclusivamente la FRONTERA TS:
// normalización del host pre-query, Zod parse del payload, fail-safe a `null`
// ante cualquier error de DB, prefix correcto del log estructurado, y skip
// short-circuit cuando el host normalizado queda vacío.

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

describe("lookupPlaceByDomain — frontera TS sobre app.lookup_place_by_domain", () => {
  it("happy path: payload válido → renombra snake_case → camelCase", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          payload: {
            place_id: "11111111-2222-4333-8444-555555555555",
            slug: "mi-place",
            default_locale: "pt",
          },
        },
      ],
            } as never);

    const result = await lookupPlaceByDomain("nocodecompany.co");

    expect(result).toEqual({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "pt",
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain("app.lookup_place_by_domain");
    expect(params).toEqual(["nocodecompany.co"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("payload NULL (SQL function no encontró match) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ payload: null }] } as never);

    const result = await lookupPlaceByDomain("desconocido.com");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin filas (defensa, no debería ocurrir) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await lookupPlaceByDomain("vacio.com");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("DB error (connection terminated) → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await lookupPlaceByDomain("empresa.com");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): log.error emite JSON structured.
    const args = vi.mocked(console.error).mock.calls[0]!;
    const payload = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(payload.scope).toBe("custom-domain-lookup");
    expect(payload.message).toBe("DB query falló");
    expect(payload.host).toBe("empresa.com");
    expect(args[1]).toBeInstanceOf(Error);
  });

  it("timeout simulado → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("timeout"));

    const result = await lookupPlaceByDomain("lento.com");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): ver test anterior.
    const args = vi.mocked(console.error).mock.calls[0]!;
    const payload = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(payload.scope).toBe("custom-domain-lookup");
    expect(payload.message).toBe("DB query falló");
    expect(payload.host).toBe("lento.com");
    expect(args[1]).toBeInstanceOf(Error);
  });

  it("host uppercase: normaliza a lowercase ANTES de query (defense-in-depth)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ payload: null }] } as never);

    await lookupPlaceByDomain("NoCodeCompany.CO");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["nocodecompany.co"]);
  });

  it("host con :port → strippea puerto antes de query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ payload: null }] } as never);

    await lookupPlaceByDomain("empresa.com:443");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["empresa.com"]);
  });

  it("host vacío / whitespace → null SIN llamar a pool.query", async () => {
    expect(await lookupPlaceByDomain("")).toBeNull();
    expect(await lookupPlaceByDomain("   ")).toBeNull();
    expect(await lookupPlaceByDomain(":443")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("payload mal formado (Zod fail) → null + log con prefix de payload inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          payload: {
            place_id: "no-uuid",
            slug: 123,
            default_locale: "xx",
          },
        },
      ],
    } as never);

    const result = await lookupPlaceByDomain("driftedplace.com");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): el wrapper usa log.error que emite JSON
    // structured a console.error.
    const firstArg = vi.mocked(console.error).mock.calls[0]![0] as string;
    const payload = JSON.parse(firstArg) as Record<string, unknown>;
    expect(payload.level).toBe("error");
    expect(payload.scope).toBe("custom-domain-lookup");
    expect(payload.message).toBe("payload inválido");
    expect(payload.host).toBe("driftedplace.com");
  });
});
