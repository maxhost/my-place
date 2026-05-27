import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pool } from "@/db/client";

import { lookupCustomDomainBySlug } from "../custom-domain-by-slug-lookup";

// Feature E — Invite Accept Flow V1.2 · Sesión A. Tests del wrapper TS sobre
// `app.lookup_custom_domain_by_slug` (migration 0022). ESTOS TESTS NO VALIDAN
// LA SQL FUNCTION. La validación de la función SQL (RLS bypass controlado,
// filtros verified/archived, payload text, ACL EXECUTE) vive en
// `src/db/__tests__/lookup-custom-domain-by-slug.test.ts` (corre `inRlsTx`
// contra la DB real). Acá testeamos exclusivamente la FRONTERA TS:
// normalización del slug pre-query, Zod parse del payload text, fail-safe a
// `null` ante cualquier error de DB, prefix correcto del log estructurado, y
// skip short-circuit cuando el slug normalizado queda vacío.

vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

// Mock de React.cache: el wrapper está envuelto en `cache()` para memoización
// per-render (ver header del módulo). Para tests unitarios, mock identity:
// `cache(fn) = fn`. Los tests reflejan así el comportamiento de la frontera
// SIN heisenbug por memoización entre `it`s.
vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

const mockQuery = vi.mocked(pool.query);

beforeEach(() => {
  mockQuery.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lookupCustomDomainBySlug — frontera TS sobre app.lookup_custom_domain_by_slug", () => {
  it("happy path: domain válido → retorna el string", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ domain: "nocodecompany.co" }],
    } as never);

    const result = await lookupCustomDomainBySlug("mi-place");

    expect(result).toBe("nocodecompany.co");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toContain("app.lookup_custom_domain_by_slug");
    expect(params).toEqual(["mi-place"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("domain NULL (SQL function no encontró match) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: null }] } as never);

    const result = await lookupCustomDomainBySlug("sin-domain");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sin filas (defensa, no debería ocurrir) → null, sin log de error", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await lookupCustomDomainBySlug("vacio");

    expect(result).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("DB error (connection terminated) → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const result = await lookupCustomDomainBySlug("mi-place");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[custom-domain-by-slug-lookup] DB query falló para slug=",
      "mi-place",
      expect.any(Error),
    );
  });

  it("timeout simulado → null + log con prefix de DB falló", async () => {
    mockQuery.mockRejectedValueOnce(new Error("timeout"));

    const result = await lookupCustomDomainBySlug("lento");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[custom-domain-by-slug-lookup] DB query falló para slug=",
      "lento",
      expect.any(Error),
    );
  });

  it("slug uppercase: normaliza a lowercase ANTES de query (defense-in-depth + cache key uniformity)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: null }] } as never);

    await lookupCustomDomainBySlug("Mi-Place");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["mi-place"]);
  });

  it("slug con whitespace alrededor: trim ANTES de query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ domain: null }] } as never);

    await lookupCustomDomainBySlug("  mi-place  ");

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0]!;
    expect(params).toEqual(["mi-place"]);
  });

  it("slug vacío / whitespace → null SIN llamar a pool.query", async () => {
    expect(await lookupCustomDomainBySlug("")).toBeNull();
    expect(await lookupCustomDomainBySlug("   ")).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("domain con tipo no-string (drift extremo) → null + log con prefix de domain inválido", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ domain: 123 }],
    } as never);

    const result = await lookupCustomDomainBySlug("typed-drift");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    const firstArg = vi.mocked(console.error).mock.calls[0]![0];
    expect(firstArg).toBe(
      "[custom-domain-by-slug-lookup] domain inválido para slug=",
    );
  });

  it("domain string vacío (drift extremo) → null + log con prefix de domain inválido", async () => {
    // El min(1) del Zod evita propagar un domain vacío al helper consumer
    // (que generaría URL `https:///path` inválida). Mejor degradar a fallback.
    mockQuery.mockResolvedValueOnce({
      rows: [{ domain: "" }],
    } as never);

    const result = await lookupCustomDomainBySlug("empty-drift");

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("happy path: retorna domains realistas (lowercase, multi-label, TLD largo)", async () => {
    const cases = [
      "nocodecompany.co",
      "place.example.com",
      "mi-comunidad.org",
      "subdomain.parent.community",
    ];
    for (const dom of cases) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ domain: dom }],
      } as never);
      const result = await lookupCustomDomainBySlug(`slug-for-${dom}`);
      expect(result).toBe(dom);
    }
    expect(console.error).not.toHaveBeenCalled();
  });
});
