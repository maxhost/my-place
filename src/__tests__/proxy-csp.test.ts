import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextResponse } from "next/server";

// Phase 2.I — Integration tests del CSP strict (nonce-based) compuesto por el
// proxy. Cubren el CONTRATO de aplicación de la política:
//   (a) en producción, TODA zona retorna el header `Content-Security-Policy`
//       con un nonce per-request + `'strict-dynamic'`;
//   (b) el nonce de la política coincide con el `x-nonce` propagado al render
//       (mutación de `req.headers`) → los `<script>` de framework que Next
//       nonce-a desde el header de request forwardeado matchean la respuesta;
//   (c) fuera de producción (dev/test) NO se emite CSP (HMR de `next dev` usa
//       `eval` + ws; la suite E2E corre sobre `next dev`) — guard de regresión.
// La construcción pura de la política vive en
// `shared/lib/security/__tests__/content-security-policy.test.ts`.

const { mockLookup, intlInnerCall } = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  intlInnerCall: vi.fn(),
}));

vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: mockLookup,
}));

vi.mock("next-intl/middleware", () => ({
  default: () => intlInnerCall,
}));

const { default: proxy } = await import("../proxy");

async function makeRequest(
  host: string,
  pathname: string = "/",
): Promise<import("next/server").NextRequest> {
  const { NextRequest } = await import("next/server");
  const req = new NextRequest(new URL(`http://localhost${pathname}`));
  req.headers.set("host", host);
  return req;
}

beforeEach(() => {
  mockLookup.mockReset();
  intlInnerCall.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("proxy CSP — producción", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("place: emite CSP con nonce + strict-dynamic y propaga el nonce al render", async () => {
    const req = await makeRequest("mi-place.place.community", "/settings");

    const res = await proxy(req);

    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");

    // El nonce propagado al render (req.headers, forwardeado vía el rewrite)
    // debe ser el mismo que el de la política → los scripts de framework matchean.
    const nonce = req.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(req.headers.get("content-security-policy")).toBe(csp);
  });

  it("custom-domain: emite CSP con nonce", async () => {
    mockLookup.mockResolvedValueOnce({
      placeId: "11111111-2222-4333-8444-555555555555",
      slug: "mi-place",
      defaultLocale: "es",
    });
    const req = await makeRequest("nocodecompany.co", "/");

    const res = await proxy(req);

    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain(`'nonce-${req.headers.get("x-nonce")}'`);
    // El rewrite del routing sigue intacto (regresión Feature B).
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/place\/mi-place$/);
  });

  it("marketing: aplica CSP sobre la respuesta de intl", async () => {
    intlInnerCall.mockReturnValueOnce(NextResponse.next());
    const req = await makeRequest("place.community");

    const res = await proxy(req);

    expect(res.headers.get("content-security-policy")).toContain(
      "'strict-dynamic'",
    );
    // intl recibió el req con el nonce ya mutado (lo copia a su forward).
    expect(req.headers.get("x-nonce")).toBeTruthy();
  });

  it("inbox: aplica CSP sobre el rewrite compuesto", async () => {
    intlInnerCall.mockReturnValueOnce(NextResponse.next());
    const req = await makeRequest("app.place.community", "/conversations");

    const res = await proxy(req);

    expect(res.headers.get("content-security-policy")).toContain(
      "'strict-dynamic'",
    );
    // El rewrite a `/inbox/...` se preserva.
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/inbox\/conversations$/,
    );
  });

  it("la política incluye connect-src a Sentry (beacons de error no rompen)", async () => {
    const req = await makeRequest("mi-place.place.community");

    const res = await proxy(req);

    expect(res.headers.get("content-security-policy")).toContain(
      "https://*.sentry.io",
    );
  });
});

describe("proxy CSP — dev/test (guard de regresión)", () => {
  it("NO emite CSP fuera de producción (HMR/eval + E2E sobre next dev)", async () => {
    // NODE_ENV = "test" por defecto en vitest → no producción.
    const req = await makeRequest("mi-place.place.community", "/settings");

    const res = await proxy(req);

    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(req.headers.get("x-nonce")).toBeNull();
    // El routing no cambia: el rewrite sigue intacto.
    expect(res.headers.get("x-middleware-rewrite")).toMatch(
      /\/place\/mi-place\/settings$/,
    );
  });
});
