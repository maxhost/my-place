import {
  createLocalJWKSet,
  exportPKCS8,
  generateKeyPair,
  type JSONWebKeySet,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks de las dependencias del handler. `vi.mock` se evalúa ANTES
// de los imports (hoisting de vitest), así el handler bajo test recibe las
// versiones mockeadas en sus closures. Cada dependencia se mockea como
// `vi.fn()` y se controla por test.
vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: vi.fn(),
}));
vi.mock("@/shared/lib/session", () => ({
  getSessionJwt: vi.fn(),
}));
vi.mock("@/shared/lib/jwt", () => ({
  verifyAccessToken: vi.fn(),
}));

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { verifyAccessToken } from "@/shared/lib/jwt";
import { getSessionJwt } from "@/shared/lib/session";
import {
  SSO_TICKET_ISSUER,
  SSO_TICKET_TTL_SECONDS,
  __resetSsoKeyCacheForTests,
  loadPublicJwks,
  verifySsoTicket,
} from "@/shared/lib/sso";

import { GET } from "../route";

// Feature C · S7 · /api/auth/sso-issue: handler apex que mintea el Signed
// Ticket. ADR-0032 §2 step 2 + §"Decisión 5 — Issuer apex".
//
// ## Cobertura del contrato (10 tests, alineado con `tests.md` §S7)
//
// 1. Zod rejection de query inválida (3 cases: falta aud/state/nonce).
// 2. Audience binding: `aud` debe ser custom domain VERIFIED via
//    `lookupPlaceByDomain` (Feature B). Null → 400 invalid_audience.
// 3. Apex session gating: sin sesión Neon Auth → redirect a login apex
//    PRESERVANDO el flow vía `?returnTo=<encoded sso-issue URL>`; sesión
//    presente pero JWT inválido (`verifyAccessToken` throws) → 401.
// 4. Happy path: redirect 302 a `https://<aud>/api/auth/sso-redeem` con
//    ticket + state + returnTo en query.
// 5. Ticket round-trip: el ticket emitido verifica contra el JWKS público
//    derivado de la MISMA signing key (smoke del contrato cripto).
// 6. `jti` único cada call: dos requests sucesivos producen tickets con
//    `jti` distintos (anti-replay relies on this).
// 7. TTL canónica: `exp - iat === SSO_TICKET_TTL_SECONDS` (60s).
// 8. Open-redirect: `returnTo` malicioso (`//evil.com`) se sanea a `/`
//    ANTES de propagarse a la redeem URL (defense-in-depth, S3
//    `validateReturnTo`).
//
// ## Por qué no testeamos `verifyAccessToken` directo
//
// El verifier vive en `shared/lib/jwt.ts` (Feature A, locked). Sus tests
// están en su propio suite. Acá lo mockeamos y testeamos sólo la
// orquestación del handler. Pattern paralelo a tests/route.test.ts del
// catch-all Neon Auth.

const APEX_URL = "https://place.community";
const AUD_HOST = "nocodecompany.co";
const TEST_SUB = "neon-user-id-abc-123";
const TEST_PLACE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_SLUG = "nocode";

async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

const mockLookup = vi.mocked(lookupPlaceByDomain);
const mockGetSession = vi.mocked(getSessionJwt);
const mockVerify = vi.mocked(verifyAccessToken);

beforeEach(() => {
  __resetSsoKeyCacheForTests();
  mockLookup.mockReset();
  mockGetSession.mockReset();
  mockVerify.mockReset();
});

afterEach(() => {
  __resetSsoKeyCacheForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function buildIssueRequest(
  query: Partial<Record<"aud" | "state" | "nonce" | "returnTo", string>> = {},
): Request {
  const u = new URL(`${APEX_URL}/api/auth/sso-issue`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return new Request(u.toString());
}

function happyQuery(): Record<"aud" | "state" | "nonce" | "returnTo", string> {
  return {
    aud: AUD_HOST,
    state: "state-roundtrip-01",
    nonce: "nonce-roundtrip-01",
    returnTo: "/settings",
  };
}

async function setupHappyPath(): Promise<void> {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APEX_URL);
  vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
  vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s7-issue");
  mockLookup.mockResolvedValue({
    placeId: TEST_PLACE_ID,
    slug: TEST_SLUG,
    defaultLocale: "es",
  });
  mockGetSession.mockResolvedValue("fake-neon-auth-jwt");
  mockVerify.mockResolvedValue({ sub: TEST_SUB });
}

// ---------------------------------------------------------------------------

describe("S7 sso-issue — Zod query validation", () => {
  it("falta `aud` → 400", async () => {
    const res = await GET(
      buildIssueRequest({ state: "s", nonce: "n", returnTo: "/" }),
    );
    expect(res.status).toBe(400);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("falta `state` → 400", async () => {
    const res = await GET(
      buildIssueRequest({ aud: AUD_HOST, nonce: "n", returnTo: "/" }),
    );
    expect(res.status).toBe(400);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("falta `nonce` → 400", async () => {
    const res = await GET(
      buildIssueRequest({ aud: AUD_HOST, state: "s", returnTo: "/" }),
    );
    expect(res.status).toBe(400);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("S7 sso-issue — audience binding", () => {
  it("aud no verified (`lookupPlaceByDomain` null) → 400 invalid_audience (sin leak detalle)", async () => {
    mockLookup.mockResolvedValueOnce(null);
    const res = await GET(buildIssueRequest(happyQuery()));
    expect(res.status).toBe(400);
    expect(mockGetSession).not.toHaveBeenCalled();
  });
});

describe("S7 sso-issue — apex session gating", () => {
  it("sin sesión apex (`getSessionJwt` null) → redirect 302 a apex login con returnTo preservado", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APEX_URL);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "pt",
    });
    mockGetSession.mockResolvedValueOnce(null);

    const res = await GET(buildIssueRequest(happyQuery()));
    expect(res.status).toBe(302);

    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const locUrl = new URL(location!);

    // Login apex en el locale del place (default_locale resuelto via lookup).
    expect(locUrl.host).toBe("place.community");
    expect(locUrl.pathname).toBe("/pt/login");

    // returnTo preserva el flow: encoded sso-issue URL con todos los params
    // originales — tras login, el browser navega ahí y el handler ejecuta el
    // happy path con la sesión recién minted.
    const returnTo = locUrl.searchParams.get("returnTo");
    expect(returnTo).not.toBeNull();
    const continueUrl = new URL(returnTo!);
    expect(continueUrl.pathname).toBe("/api/auth/sso-issue");
    expect(continueUrl.searchParams.get("aud")).toBe(AUD_HOST);
    expect(continueUrl.searchParams.get("state")).toBe(happyQuery().state);
    expect(continueUrl.searchParams.get("nonce")).toBe(happyQuery().nonce);

    // verifyAccessToken NO debe ser invocado si no hay JWT.
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("sesión apex con JWT inválido (`verifyAccessToken` throws) → 401", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APEX_URL);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    mockGetSession.mockResolvedValueOnce("malformed-or-expired-jwt");
    mockVerify.mockRejectedValueOnce(new Error("JWS signature failed"));

    const res = await GET(buildIssueRequest(happyQuery()));
    expect(res.status).toBe(401);
  });
});

describe("S7 sso-issue — happy path + security", () => {
  it("happy path: 302 con Location a `https://<aud>/api/auth/sso-redeem?ticket=…&state=…&returnTo=…`", async () => {
    await setupHappyPath();

    const res = await GET(buildIssueRequest(happyQuery()));
    expect(res.status).toBe(302);

    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const locUrl = new URL(location!);
    expect(locUrl.protocol).toBe("https:");
    expect(locUrl.host).toBe(AUD_HOST);
    expect(locUrl.pathname).toBe("/api/auth/sso-redeem");
    expect(locUrl.searchParams.get("state")).toBe(happyQuery().state);
    expect(locUrl.searchParams.get("returnTo")).toBe("/settings");
    expect(locUrl.searchParams.get("ticket")).toMatch(
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );

    // No setea cookies: las cookies del flow viven en custom domain (state
    // cookie por sso-init S8, session local por sso-redeem S8).
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("ticket round-trip: el ticket emitido verifica contra el JWKS público (smoke cripto end-to-end)", async () => {
    await setupHappyPath();

    const res = await GET(buildIssueRequest(happyQuery()));
    const locUrl = new URL(res.headers.get("location")!);
    const ticket = locUrl.searchParams.get("ticket")!;

    // El JWKS lo emite el endpoint S5 — acá lo derivamos directo de la
    // signing key para evitar acoplar tests al endpoint. Equivale al
    // `createRemoteJWKSet(...)` que el redeem (S8) hace contra
    // `/api/auth/sso-jwks` con cache intra-process.
    const jwks: JSONWebKeySet = await loadPublicJwks();
    const claims = await verifySsoTicket({
      token: ticket,
      expectedAud: AUD_HOST,
      keys: createLocalJWKSet(jwks),
    });
    expect(claims.iss).toBe(SSO_TICKET_ISSUER);
    expect(claims.sub).toBe(TEST_SUB);
    expect(claims.aud).toBe(AUD_HOST);
    expect(claims.state).toBe(happyQuery().state);
    expect(claims.nonce).toBe(happyQuery().nonce);
    expect(typeof claims.jti).toBe("string");
    expect(claims.jti.length).toBeGreaterThan(0);
  });

  it("`jti` distinto cada call (anti-replay floor: tickets consecutivos no son re-redimibles)", async () => {
    await setupHappyPath();

    const res1 = await GET(buildIssueRequest(happyQuery()));
    const res2 = await GET(buildIssueRequest(happyQuery()));

    const jwks: JSONWebKeySet = await loadPublicJwks();
    const localKeys = createLocalJWKSet(jwks);
    const ticket1 = new URL(res1.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const ticket2 = new URL(res2.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const claims1 = await verifySsoTicket({
      token: ticket1,
      expectedAud: AUD_HOST,
      keys: localKeys,
    });
    const claims2 = await verifySsoTicket({
      token: ticket2,
      expectedAud: AUD_HOST,
      keys: localKeys,
    });
    expect(claims1.jti).not.toBe(claims2.jti);
  });

  it("TTL canónica: `exp - iat === SSO_TICKET_TTL_SECONDS` (60s)", async () => {
    await setupHappyPath();

    const res = await GET(buildIssueRequest(happyQuery()));
    const ticket = new URL(res.headers.get("location")!).searchParams.get(
      "ticket",
    )!;
    const claims = await verifySsoTicket({
      token: ticket,
      expectedAud: AUD_HOST,
      keys: createLocalJWKSet(await loadPublicJwks()),
    });
    expect(claims.exp - claims.iat).toBe(SSO_TICKET_TTL_SECONDS);
  });

  it("open-redirect: `returnTo` malicioso (`//evil.com`) se sanea a `/` en la redeem URL", async () => {
    await setupHappyPath();

    const res = await GET(
      buildIssueRequest({ ...happyQuery(), returnTo: "//evil.com/path" }),
    );
    expect(res.status).toBe(302);

    const locUrl = new URL(res.headers.get("location")!);
    // El Location SIEMPRE apunta al custom domain verified (aud), nunca al
    // attacker (defensa primaria: el host del Location se construye a partir
    // de `aud` validado, no del returnTo).
    expect(locUrl.host).toBe(AUD_HOST);
    // Y el `returnTo` propagado a la redeem URL queda sanitizado a `/`
    // (defense-in-depth via `validateReturnTo` — el redeem re-valida una
    // tercera vez, triple defense per ADR-0032 §3).
    expect(locUrl.searchParams.get("returnTo")).toBe("/");
  });
});
