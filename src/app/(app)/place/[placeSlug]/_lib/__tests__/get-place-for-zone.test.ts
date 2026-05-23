import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature C · S9 · tests de `getSessionTokenForZone` + `getPlaceForZone` con
// branch SSO local vs Neon Auth. ADR-0032 §"Decisión 6 — RLS continuity via
// injected verifier".
//
// Estrategia de mock:
//
// - `next/headers` (cookies + headers) → stubbed por test.
// - `@/shared/lib/session` (`getSessionJwt`) → mock vi.fn.
// - `@/shared/lib/sso` (`verifyLocalSession` + `getAuthenticatedDbWithVerifier`)
//   → mock vi.fn (la const `LOCAL_SESSION_COOKIE_NAME` se preserva via
//   `importOriginal` para no romper el lookup del nombre).
// - `@/shared/lib/db` (`getAuthenticatedDb`) → mock vi.fn.
// - `@/shared/lib/host-routing` (`resolveHostWithCustomDomains`) → mock; el
//   `HostZone` y demás exports se preservan via `importOriginal`.
// - `@/features/place/public` (`loadPlaceBySlug`) → mock vi.fn (no se ejecuta
//   directamente acá, lo invoca el wrapper de DB).
//
// Cobertura (6 tests, alineado con `tests.md` §S9):
//
// 1. Subdomain canon (`zone === "place"`) + Neon Auth presente → `{token,
//    source:'neon-auth'}`.
// 2. Subdomain canon + sin Neon Auth → null.
// 3. Custom domain + cookie SSO válida → `{token, source:'sso-local'}` (host
//    claim verificado vs `Host` header).
// 4. Custom domain + sin cookie SSO → null.
// 5. Custom domain + cookie SSO presente pero inválida (verifier throws) →
//    null (no leak del error → re-trigger silent SSO en S10).
// 6. `getPlaceForZone` con session sso-local pasa por
//    `getAuthenticatedDbWithVerifier` con verifier que invocado retorna el
//    `sub` correcto — continuidad RLS end-to-end (ADR-0032 §6).

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));
vi.mock("@/shared/lib/session", () => ({
  getSessionJwt: vi.fn(),
}));
vi.mock("@/shared/lib/db", () => ({
  getAuthenticatedDb: vi.fn(),
}));
vi.mock("@/features/place/public", () => ({
  loadPlaceBySlug: vi.fn(),
  PLACE_LOCALES: ["es", "en", "fr", "pt", "de", "ca"] as const,
}));
vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: vi.fn(),
}));
vi.mock("@/shared/lib/place-locale-lookup", () => ({
  lookupPlaceLocaleBySlug: vi.fn(),
}));
vi.mock("@/shared/lib/host-routing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/host-routing")>();
  return {
    ...actual,
    resolveHostWithCustomDomains: vi.fn(),
  };
});
vi.mock("@/shared/lib/sso", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/sso")>();
  return {
    ...actual,
    verifyLocalSession: vi.fn(),
    getAuthenticatedDbWithVerifier: vi.fn(),
  };
});

import { cookies, headers } from "next/headers";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import { getAuthenticatedDb } from "@/shared/lib/db";
import { resolveHostWithCustomDomains } from "@/shared/lib/host-routing";
import { getSessionJwt } from "@/shared/lib/session";
import {
  getAuthenticatedDbWithVerifier,
  verifyLocalSession,
} from "@/shared/lib/sso";

import {
  getPlaceForZone,
  getSessionTokenForZone,
} from "../get-place-for-zone";

const mockHeaders = vi.mocked(headers);
const mockCookies = vi.mocked(cookies);
const mockGetSessionJwt = vi.mocked(getSessionJwt);
const mockResolveHost = vi.mocked(resolveHostWithCustomDomains);
const mockVerifyLocalSession = vi.mocked(verifyLocalSession);
const mockGetAuthDb = vi.mocked(getAuthenticatedDb);
const mockGetAuthDbWithVerifier = vi.mocked(getAuthenticatedDbWithVerifier);
const mockLookupDomain = vi.mocked(lookupPlaceByDomain);

const TEST_SUB = "neon-user-id-abc-123";
const TEST_NEON_JWT = "eyJ.neon-auth.jwt";
const TEST_SSO_JWT = "eyJ.sso-local.jwt";
const CUSTOM_HOST = "nocodecompany.co";
const CANON_HOST = "nocode.place.community";
const TEST_SLUG = "nocode";
const TEST_PLACE_ID = "11111111-2222-4333-8444-555555555555";

function stubHeaders(hostHeader: string): void {
  mockHeaders.mockResolvedValue({
    get: (k: string) => (k.toLowerCase() === "host" ? hostHeader : null),
  } as never);
}

function stubCookies(values: Record<string, string>): void {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      values[name] !== undefined ? { name, value: values[name]! } : undefined,
  } as never);
}

beforeEach(() => {
  mockHeaders.mockReset();
  mockCookies.mockReset();
  mockGetSessionJwt.mockReset();
  mockResolveHost.mockReset();
  mockVerifyLocalSession.mockReset();
  mockGetAuthDb.mockReset();
  mockGetAuthDbWithVerifier.mockReset();
  mockLookupDomain.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("S9 · getSessionTokenForZone — subdomain canon (zone='place')", () => {
  it("Neon Auth JWT presente → `{token, source:'neon-auth'}`", async () => {
    stubHeaders(CANON_HOST);
    stubCookies({});
    mockResolveHost.mockResolvedValueOnce({ zone: "place", slug: TEST_SLUG });
    mockGetSessionJwt.mockResolvedValueOnce(TEST_NEON_JWT);

    const session = await getSessionTokenForZone();

    expect(session).toEqual({
      token: TEST_NEON_JWT,
      source: "neon-auth",
    });
    // En subdomain canon, NUNCA debe tocar la cookie SSO local ni el
    // verifier — la rama solo aplica a custom-domain. Defense-in-depth.
    expect(mockVerifyLocalSession).not.toHaveBeenCalled();
  });

  it("Sin Neon Auth JWT → null", async () => {
    stubHeaders(CANON_HOST);
    stubCookies({});
    mockResolveHost.mockResolvedValueOnce({ zone: "place", slug: TEST_SLUG });
    mockGetSessionJwt.mockResolvedValueOnce(null);

    const session = await getSessionTokenForZone();

    expect(session).toBeNull();
  });
});

describe("S9 · getSessionTokenForZone — custom domain", () => {
  it("Cookie SSO presente + verifyLocalSession OK → `{token, source:'sso-local'}` con host claim chequeado", async () => {
    stubHeaders(CUSTOM_HOST);
    stubCookies({ "__Host-place_sso_session": TEST_SSO_JWT });
    mockResolveHost.mockResolvedValueOnce({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    mockVerifyLocalSession.mockResolvedValueOnce({
      iss: "place.community",
      sub: TEST_SUB,
      host: CUSTOM_HOST,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    });

    const session = await getSessionTokenForZone();

    expect(session).toEqual({
      token: TEST_SSO_JWT,
      source: "sso-local",
    });
    // El host claim DEBE chequearse contra el Host header del request actual
    // (defense-in-depth contra cookie robada y re-presentada en otro custom
    // domain). El verifier recibe `expectedHost` derivado del header.
    expect(mockVerifyLocalSession).toHaveBeenCalledWith({
      token: TEST_SSO_JWT,
      expectedHost: CUSTOM_HOST,
    });
    // En custom domain NO se debe consultar Neon Auth (cookie no cruza el
    // host del custom domain — design del browser RFC 6265).
    expect(mockGetSessionJwt).not.toHaveBeenCalled();
  });

  it("Sin cookie SSO → null (sin invocar verifier)", async () => {
    stubHeaders(CUSTOM_HOST);
    stubCookies({}); // cookie ausente
    mockResolveHost.mockResolvedValueOnce({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });

    const session = await getSessionTokenForZone();

    expect(session).toBeNull();
    // Sin cookie no tiene sentido invocar el verifier — short-circuit
    // antes de pagar el cómputo crypto.
    expect(mockVerifyLocalSession).not.toHaveBeenCalled();
  });

  it("Cookie SSO presente pero verifyLocalSession throws → null (re-trigger silent SSO)", async () => {
    stubHeaders(CUSTOM_HOST);
    stubCookies({ "__Host-place_sso_session": TEST_SSO_JWT });
    mockResolveHost.mockResolvedValueOnce({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    // Cubre `expired`, `host_mismatch`, `signature_invalid`, `jwt_malformed`
    // — el resultado del consumer es el mismo: null → S10 silent SSO retry.
    mockVerifyLocalSession.mockRejectedValueOnce(
      new Error("LocalSessionError: host_mismatch"),
    );

    const session = await getSessionTokenForZone();

    expect(session).toBeNull();
  });
});

describe("S9 · getPlaceForZone — branch verifier por source", () => {
  it("source='sso-local' → invoca `getAuthenticatedDbWithVerifier` con verifier que retorna `{sub}` del local session", async () => {
    stubHeaders(CUSTOM_HOST);
    stubCookies({ "__Host-place_sso_session": TEST_SSO_JWT });
    mockResolveHost.mockResolvedValue({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    const verifiedClaims = {
      iss: "place.community" as const,
      sub: TEST_SUB,
      host: CUSTOM_HOST,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    mockVerifyLocalSession.mockResolvedValue(verifiedClaims);
    const expectedPlace = {
      id: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es" as const,
    };
    // El wrapper invoca `verifier(token)` internamente y luego `fn(exec, claims)`.
    // Acá replicamos esa llamada para validar que el verifier inyectado por
    // `getPlaceForZone` retorna `{sub}` correcto (continuidad RLS).
    // El 3er arg (`fn`) lo omitimos a propósito: mockeamos toda la pipeline
    // del bridge y validamos sólo que el verifier inyectado por
    // `getPlaceForZone` retorne el `sub` correcto (= continuidad RLS).
    mockGetAuthDbWithVerifier.mockImplementation(async (token, verifier) => {
      const claims = await verifier(token);
      expect(claims.sub).toBe(TEST_SUB);
      return expectedPlace as never;
    });

    const place = await getPlaceForZone(TEST_SLUG);

    expect(place).toEqual(expectedPlace);
    expect(mockGetAuthDbWithVerifier).toHaveBeenCalledTimes(1);
    // `getAuthenticatedDb` (Neon Auth JWKS path) NO debe invocarse en custom
    // domain — branch separado.
    expect(mockGetAuthDb).not.toHaveBeenCalled();
  });
});
