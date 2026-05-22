import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextResponse } from "next/server";

// Feature B S3 (ADR-0031 §3) — Integration tests del proxy host-based con la
// resolución async de custom domains. Cobertura del CONTRATO del routing:
// (a) zonas estructurales conocidas NO consultan lookup (cost budget V1 §
// "Lookup query cost"); (b) custom domain verified rewrite-ea al árbol
// `/place/{slug}` SIN componer intl; (c) host desconocido cae al fallback
// marketing (fail-safe del wrapper). Los tests del wrapper SYNC + ASYNC
// puro viven en `shared/lib/__tests__/host-routing.test.ts`; éste cubre la
// composición del proxy: intl + rewrite + custom-domain.

// `vi.hoisted` garantiza que los mocks queden definidos ANTES de los
// `vi.mock` hoisted (que a su vez se ejecutan ANTES del `import proxy`).
// Sin hoisted la factory del mock referencia variables en TDZ → ReferenceError.
const { mockLookup, intlInnerCall } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  intlInnerCall: vi.fn(),
}));

vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: mockLookup,
}));

// `createMiddleware(routing)` corre 1 vez al cargar el módulo `proxy.ts`. La
// factory retorna `intlInnerCall` — la fn que el proxy invoca por request.
// Reset/configurar `intlInnerCall` por test; `createMiddleware` queda fijo.
vi.mock("next-intl/middleware", () => ({
  default: () => intlInnerCall,
}));

// Import DESPUÉS de los mocks (vitest hoists `vi.mock` pero NO los `import`).
const { default: proxy } = await import("../proxy");

// Construye un `NextRequest` con un `host` arbitrario en el header. URL real
// usa `localhost` para que el constructor de URL no normalice el host del
// argumento (URL normaliza hostnames a lowercase per spec, lo que rompería el
// test de uppercase). Headers de Request son mutables en Node runtime.
async function makeRequest(
  host: string,
  pathname: string = "/",
  search: string = "",
): Promise<import("next/server").NextRequest> {
  // Dynamic import para asegurar que NextRequest viene del mismo módulo que
  // el proxy resolvió (importante con el patching de Next 16).
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(new URL(`http://localhost${pathname}${search}`));
  req.headers.set("host", host);
  return req;
}

beforeEach(() => {
  mockLookup.mockReset();
  intlInnerCall.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("proxy — Feature B routing async (ADR-0031 §3)", () => {
  it("apex `place.community` → marketing: delega al intlMiddleware sin tocar lookup", async () => {
    intlInnerCall.mockReturnValueOnce(NextResponse.next());
    const req = await makeRequest("place.community");

    const res = await proxy(req);

    expect(intlInnerCall).toHaveBeenCalledTimes(1);
    expect(intlInnerCall).toHaveBeenCalledWith(req);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(res).toBeInstanceOf(NextResponse);
  });

  it("`app.<root>` → inbox rewrite (no consulta lookup; compone intl + propaga rewrite)", async () => {
    intlInnerCall.mockReturnValueOnce(NextResponse.next());
    const req = await makeRequest("app.place.community", "/conversations");

    const res = await proxy(req);

    expect(intlInnerCall).toHaveBeenCalledTimes(1);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/inbox\/conversations$/,
    );
  });

  it("`<slug>.<root>` → place rewrite (no consulta lookup; sin intl composition)", async () => {
    const req = await makeRequest("mi-place.place.community", "/settings");

    const res = await proxy(req);

    expect(mockLookup).not.toHaveBeenCalled();
    expect(intlInnerCall).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/place\/mi-place\/settings$/,
    );
  });

  it("custom-domain verified → rewrite a `/place/{slug}` sin invocar intl", async () => {
    mockLookup.mockResolvedValueOnce({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "pt",
    });
    const req = await makeRequest("nocodecompany.co");

    const res = await proxy(req);

    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith("nocodecompany.co");
    expect(intlInnerCall).not.toHaveBeenCalled();
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/place\/mi-place$/,
    );
  });

  it("custom-domain con query string → preserva los search params en el rewrite", async () => {
    mockLookup.mockResolvedValueOnce({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "es",
    });
    const req = await makeRequest("nocodecompany.co", "/", "?from=email&utm=launch");

    const res = await proxy(req);

    const rewrite = res.headers.get("x-middleware-rewrite") ?? "";
    expect(rewrite).toMatch(/\/place\/mi-place(\?|$)/);
    expect(rewrite).toContain("from=email");
    expect(rewrite).toContain("utm=launch");
  });

  it("custom-domain con pathname `/settings/domain` → rewrite preserva sub-paths anidados", async () => {
    mockLookup.mockResolvedValueOnce({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "es",
    });
    const req = await makeRequest("nocodecompany.co", "/settings/domain");

    const res = await proxy(req);

    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/place\/mi-place\/settings\/domain$/,
    );
  });

  it("host desconocido (lookup retorna null) → fallback marketing — NO rompe el proxy", async () => {
    mockLookup.mockResolvedValueOnce(null);
    intlInnerCall.mockReturnValueOnce(NextResponse.next());
    const req = await makeRequest("random-crawler.example.com");

    await proxy(req);

    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith("random-crawler.example.com");
    expect(intlInnerCall).toHaveBeenCalledWith(req);
  });

  it("host uppercase: el lookup recibe valor normalizado a lowercase ANTES de la query", async () => {
    mockLookup.mockResolvedValueOnce({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "es",
    });
    const req = await makeRequest("NoCodeCompany.CO");

    const res = await proxy(req);

    // resolveHostWithCustomDomains normaliza ANTES de invocar lookup;
    // defense-in-depth en custom-domain-lookup.ts re-normaliza igual (S2).
    expect(mockLookup).toHaveBeenCalledWith("nocodecompany.co");
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/place\/mi-place$/,
    );
  });
});
