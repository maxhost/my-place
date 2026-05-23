import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature C · S11.1 · sso-jwks-fetcher: `makeSafeRedirectFollowingFetch`
// es el `customFetch` que pasamos a `createRemoteJWKSet` para que el JWKS
// fetch sobreviva al redirect plataforma (Vercel apex→www, HTTP 307).
//
// Por defecto jose v6 hardcodea `redirect: 'manual'` en su `fetchJwks`
// interno (línea 19 de `dist/webapi/jwks/remote.js`) — defensa anti
// JWKS-hijack-via-redirect. El smoke production de S11-T1.1 demostró que
// esa defensa choca con el redirect plataforma `place.community →
// www.place.community` y el redeem aterriza en `signature_invalid` aunque
// la firma del ticket sea matemáticamente correcta.
//
// Este helper restaura la capacidad de seguir redirects sin perder la
// defensa: same-registrable-domain only, https-only, ≤3 hops. Anything
// fuera de esa policy throws `SsoJwksRedirectError` con `code` mapeado,
// que el `customFetch` propaga y jose convierte en `JOSEError` → el
// pipeline del redeem cae en `signature_invalid` (correcto: cualquier
// redirect anómalo = "no pudimos establecer trust con el apex").
//
// Cobertura (10 tests, plan-sesiones §S11.1.1):
// 1. No-redirect 200 → pass-through del response (zero-overhead happy).
// 2. 307 same host (path distinto) → sigue.
// 3. 307 apex → www mismo registrable (Vercel pattern real) → sigue.
// 4. 307 subdomain → otro subdomain mismo registrable → sigue.
// 5. 307 → host distinto (`evil.com`) → throws `cross_registrable_domain`.
// 6. 307 https → http (downgrade) → throws `protocol_downgrade`.
// 7. Chain >3 redirects → throws `too_many_redirects`.
// 8. Headers (Accept, User-Agent custom) propagan al follow request.
// 9. AbortSignal propaga al follow request.
// 10. 200 final tras 1 hop → response.json() del target consumible.

import {
  SsoJwksRedirectError,
  makeSafeRedirectFollowingFetch,
} from "../sso-jwks-fetcher";

type FetchCall = { url: string; init: RequestInit | undefined };

// Mock fetch que enrutea por URL exacta. Cada test arma su tabla de
// (url → Response). Capturamos calls para asertar headers/signal/etc.
function makeMockFetch(routes: Record<string, () => Response>): {
  fetchImpl: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const factory = routes[url];
    if (!factory) {
      throw new Error(`mock-fetch: unexpected URL ${url}`);
    }
    return factory();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function redirectResponse(status: 301 | 302 | 303 | 307 | 308, location: string): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

function jwksResponse(): Response {
  return new Response(
    JSON.stringify({
      keys: [
        {
          kty: "EC",
          crv: "P-256",
          x: "0u9SsfyjzFaDXQ93aA2tTXfnyUL0bQizgUYgQuAxzNE",
          y: "3on1lIjrEB4_SWnEqrxomI-pH6n4TWmErtUo4CQZvGU",
          kid: "test-kid",
          alg: "ES256",
          use: "sig",
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("S11.1 sso-jwks-fetcher — makeSafeRedirectFollowingFetch", () => {
  it("(1) 200 directo sin redirect → retorna response tal cual (pass-through)", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    const res = await safe(
      "https://place.community/api/auth/sso-jwks",
      { method: "GET", redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    const body = await res.json();
    expect(body.keys[0].kid).toBe("test-kid");
  });

  it("(2) 307 same host (path distinto) → sigue y retorna 200", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(307, "/api/auth/sso-jwks-v2"),
      "https://place.community/api/auth/sso-jwks-v2": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    const res = await safe(
      "https://place.community/api/auth/sso-jwks",
      { method: "GET", redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toBe(
      "https://place.community/api/auth/sso-jwks-v2",
    );
  });

  it("(3) 307 apex → www mismo registrable (caso Vercel real) → sigue y retorna 200", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "https://www.place.community/api/auth/sso-jwks",
        ),
      "https://www.place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    const res = await safe(
      "https://place.community/api/auth/sso-jwks",
      { method: "GET", redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toBe(
      "https://www.place.community/api/auth/sso-jwks",
    );
  });

  it("(4) 307 subdomain → otro subdomain mismo registrable → sigue", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://a.place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "https://b.place.community/api/auth/sso-jwks",
        ),
      "https://b.place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    const res = await safe(
      "https://a.place.community/api/auth/sso-jwks",
      { method: "GET", redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(calls.length).toBe(2);
  });

  it("(5) 307 → host distinto (`evil.com`) → throws SsoJwksRedirectError(`cross_registrable_domain`)", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(307, "https://evil.com/api/auth/sso-jwks"),
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    let caught: unknown;
    try {
      await safe("https://place.community/api/auth/sso-jwks", {
        method: "GET",
        redirect: "manual",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SsoJwksRedirectError);
    expect((caught as SsoJwksRedirectError).code).toBe(
      "cross_registrable_domain",
    );
    // NO debe haber fetcheado el target malicioso.
    expect(calls.length).toBe(1);
  });

  it("(6) 307 https → http (downgrade) → throws SsoJwksRedirectError(`protocol_downgrade`)", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "http://place.community/api/auth/sso-jwks",
        ),
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    let caught: unknown;
    try {
      await safe("https://place.community/api/auth/sso-jwks", {
        method: "GET",
        redirect: "manual",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SsoJwksRedirectError);
    expect((caught as SsoJwksRedirectError).code).toBe("protocol_downgrade");
    expect(calls.length).toBe(1);
  });

  it("(7) Chain >3 redirects → throws SsoJwksRedirectError(`too_many_redirects`)", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(307, "https://place.community/r1"),
      "https://place.community/r1": () =>
        redirectResponse(307, "https://place.community/r2"),
      "https://place.community/r2": () =>
        redirectResponse(307, "https://place.community/r3"),
      "https://place.community/r3": () =>
        redirectResponse(307, "https://place.community/r4"),
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch({ maxRedirects: 3 });
    let caught: unknown;
    try {
      await safe("https://place.community/api/auth/sso-jwks", {
        method: "GET",
        redirect: "manual",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SsoJwksRedirectError);
    expect((caught as SsoJwksRedirectError).code).toBe("too_many_redirects");
    // 1 inicial + 3 follows = 4 calls; el 4° follow (a r4) NO se ejecuta.
    expect(calls.length).toBe(4);
  });

  it("(8) Headers (Accept, User-Agent) propagan al follow request", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "https://www.place.community/api/auth/sso-jwks",
        ),
      "https://www.place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    await safe("https://place.community/api/auth/sso-jwks", {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "application/json",
        "user-agent": "place-sso/1.0",
      },
    });

    const followInit = calls[1]?.init;
    expect(followInit).toBeDefined();
    const followHeaders = followInit?.headers as Record<string, string>;
    expect(followHeaders.accept).toBe("application/json");
    expect(followHeaders["user-agent"]).toBe("place-sso/1.0");
  });

  it("(9) AbortSignal propaga al follow request (timeout chain-wide)", async () => {
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "https://www.place.community/api/auth/sso-jwks",
        ),
      "https://www.place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const controller = new AbortController();
    const safe = makeSafeRedirectFollowingFetch();
    await safe("https://place.community/api/auth/sso-jwks", {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });

    expect(calls[1]?.init?.signal).toBe(controller.signal);
  });

  it("(10) redirect:'manual' siempre forced en cada hop (defense-in-depth vs caller error)", async () => {
    // Si el caller olvida pasar `redirect:'manual'`, el helper lo fuerza igual
    // — el invariante es nuestro, no del caller. jose lo pasa siempre, pero
    // protegemos contra futuros consumers que no.
    const { fetchImpl, calls } = makeMockFetch({
      "https://place.community/api/auth/sso-jwks": () =>
        redirectResponse(
          307,
          "https://www.place.community/api/auth/sso-jwks",
        ),
      "https://www.place.community/api/auth/sso-jwks": jwksResponse,
    });
    globalThis.fetch = fetchImpl;

    const safe = makeSafeRedirectFollowingFetch();
    await safe("https://place.community/api/auth/sso-jwks", {
      method: "GET",
      // intentionally omit redirect
    });

    // Cada call al base fetch debe forzar manual.
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[1]?.init?.redirect).toBe("manual");
  });
});
