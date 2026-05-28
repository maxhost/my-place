import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pool } from "@/db/client";

import { lookupPlaceLocaleBySlug } from "../place-locale-lookup";

// Feature B — Tests del wrapper TS sobre `app.lookup_place_locale_by_slug`
// (S4b). ESTOS TESTS NO VALIDAN LA SQL FUNCTION. La validación de la función
// SQL (RLS bypass controlado, filtro archived, ACL, DEFINER bypass) vive en
// `src/db/__tests__/lookup-place-locale-by-slug.test.ts` (corre `inRlsTx`
// contra la DB real, branch test). Acá testeamos exclusivamente la FRONTERA
// TS: normalización del slug pre-query, Zod parse del enum locale, fail-safe
// a `null` ante cualquier error de DB, prefix correcto del log estructurado,
// y skip short-circuit cuando el slug normalizado queda vacío.

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

describe("lookupPlaceLocaleBySlug — frontera TS sobre app.lookup_place_locale_by_slug", () => {
  it("happy path: locale válido → retorna el string del enum", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ locale: "pt" }],
    } as never);

    const result = await lookupPlaceLocaleBySlug("mi-place");

    expect(result).toBe("pt");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain("app.lookup_place_locale_by_slug");
    expect(params).toEqual(["mi-place"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("locale NULL (SQL function no encontró match) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ locale: null }] } as never);

    const result = await lookupPlaceLocaleBySlug("desconocido");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin filas (defensa, no debería ocurrir) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await lookupPlaceLocaleBySlug("vacio");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("DB error (connection terminated) → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await lookupPlaceLocaleBySlug("mi-place");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): log.error emite JSON structured + el err raw
    // como segundo arg.
    const args = vi.mocked(console.error).mock.calls[0]!;
    const payload = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(payload.scope).toBe("place-locale-lookup");
    expect(payload.message).toBe("DB query falló");
    expect(payload.slug).toBe("mi-place");
    expect(args[1]).toBeInstanceOf(Error);
  });

  it("timeout simulado → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("timeout"));

    const result = await lookupPlaceLocaleBySlug("lento");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): ver test anterior.
    const args = vi.mocked(console.error).mock.calls[0]!;
    const payload = JSON.parse(args[0] as string) as Record<string, unknown>;
    expect(payload.scope).toBe("place-locale-lookup");
    expect(payload.message).toBe("DB query falló");
    expect(payload.slug).toBe("lento");
    expect(args[1]).toBeInstanceOf(Error);
  });

  it("slug uppercase: normaliza a lowercase ANTES de query (defense-in-depth)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ locale: null }] } as never);

    await lookupPlaceLocaleBySlug("Mi-Place");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["mi-place"]);
  });

  it("slug con whitespace alrededor: trim ANTES de query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ locale: null }] } as never);

    await lookupPlaceLocaleBySlug("  mi-place  ");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["mi-place"]);
  });

  it("slug vacío / whitespace → null SIN llamar a pool.query", async () => {
    expect(await lookupPlaceLocaleBySlug("")).toBeNull();
    expect(await lookupPlaceLocaleBySlug("   ")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("locale fuera del enum (drift TS↔SQL) → null + log con prefix de locale inválido", async () => {
    // Defense-in-depth ante el caso teórico de que la DB tenga un locale
    // que el front no conoce (e.g., el día que el CHECK constraint se
    // expanda antes que el enum del front). Mejor degradar a fallback que
    // renderear `<html lang="xx">`.
    mockQuery.mockResolvedValueOnce({
      rows: [{ locale: "xx" }],
    } as never);

    const result = await lookupPlaceLocaleBySlug("drifted-place");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    // Post Phase 0.E (ADR-0047): el wrapper usa log.error que emite JSON
    // structured a console.error. Verificamos el shape (scope + message)
    // sin acoplarnos al orden de keys.
    const firstArg = vi.mocked(console.error).mock.calls[0]![0] as string;
    const payload = JSON.parse(firstArg) as Record<string, unknown>;
    expect(payload.level).toBe("error");
    expect(payload.scope).toBe("place-locale-lookup");
    expect(payload.message).toBe("locale inválido");
    expect(payload.slug).toBe("drifted-place");
  });

  it("locale con tipo no-string (drift extremo) → null + log con prefix de locale inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ locale: 123 }],
    } as never);

    const result = await lookupPlaceLocaleBySlug("typed-drifted");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("retorna el enum válido para cada uno de los 6 locales operativos (ADR-0024)", async () => {
    // Paridad explícita: el wrapper acepta todos los locales del enum del
    // CHECK constraint (place_default_locale_check). Si un día se agrega
    // un locale, este test recuerda actualizar el Zod `localeSchema`.
    const locales = ["es", "en", "fr", "pt", "de", "ca"] as const;
    for (const loc of locales) {
      mockQuery.mockResolvedValueOnce({ rows: [{ locale: loc }] } as never);
      const result = await lookupPlaceLocaleBySlug(`slug-${loc}`);
      expect(result).toBe(loc);
    }
    expect(console.error).not.toHaveBeenCalled();
  });
});
