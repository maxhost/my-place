import { exportPKCS8, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks de las dependencias del handler. `vi.mock` se evalúa ANTES
// de los imports (hoisting de vitest), así el handler bajo test recibe las
// versiones mockeadas en sus closures. Patrón paralelo a
// `src/app/api/auth/sso-issue/__tests__/route.test.ts` (S7).
vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

import { headers } from "next/headers";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import {
  STATE_COOKIE_MAX_AGE_SECONDS,
  STATE_COOKIE_NAME,
  __resetSsoKeyCacheForTests,
  __resetSsoStateCacheForTests,
  verifyStateCookie,
} from "@/shared/lib/sso";

import { GET } from "../route";

// Feature C · S8 · /api/auth/sso-init: entry point del silent SSO en custom
// domain. ADR-0032 §2 step 1 + §"Decisión 4 — State cookie".
//
// ## Cobertura del contrato (5 tests, alineado con `tests.md` §S8 sso-init)
//
// 1. Host no verified (`lookupPlaceByDomain` retorna null) → 404 sin leak
//    de detalle (no distinguir not_found vs archived).
// 2. `returnTo` malicioso (`//evil.com/x`) saneado a `/` antes de
//    propagarse al apex via query (defensa #1 del triple-open-redirect-guard).
// 3. Cookie `__Host-place_sso_state` con shape canónica: HttpOnly, Secure,
//    SameSite=Lax, Path=/, Max-Age=120, sin Domain attribute (host-only
//    enforced by `__Host-` prefix).
// 4. Redirect URL exacto: `https://place.community/api/auth/sso-issue?
//    aud=<host>&state=<>&nonce=<>&returnTo=<>` con TODOS los params.
// 5. Round-trip state cookie: el `state` propagado en query matchea el
//    `state` decoded del cookie value (via `verifyStateCookie`).

const APEX_URL = "https://place.community";
const AUD_HOST = "nocodecompany.co";
const TEST_PLACE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_SLUG = "nocode";

async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

const mockLookup = vi.mocked(lookupPlaceByDomain);
const mockHeaders = vi.mocked(headers);

function stubHeaders(hostHeader: string): void {
  // `headers()` retorna ReadonlyHeaders (Map-like). El handler sólo invoca
  // `.get('host')` — stub mínimo es suficiente.
  mockHeaders.mockResolvedValue({
    get: (k: string) => (k.toLowerCase() === "host" ? hostHeader : null),
  } as never);
}

function buildInitRequest(
  query: { returnTo?: string } = {},
  host: string = AUD_HOST,
): Request {
  const u = new URL(`https://${host}/api/auth/sso-init`);
  if (query.returnTo !== undefined) {
    u.searchParams.set("returnTo", query.returnTo);
  }
  return new Request(u.toString());
}

beforeEach(async () => {
  __resetSsoKeyCacheForTests();
  __resetSsoStateCacheForTests();
  mockLookup.mockReset();
  mockHeaders.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APEX_URL);
  vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
  vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s8-init");
});

afterEach(() => {
  __resetSsoKeyCacheForTests();
  __resetSsoStateCacheForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("S8 sso-init — host validation", () => {
  it("host no verified (`lookupPlaceByDomain` retorna null) → 404 sin leak detalle", async () => {
    stubHeaders(AUD_HOST);
    mockLookup.mockResolvedValueOnce(null);

    const res = await GET(buildInitRequest({ returnTo: "/settings" }));

    expect(res.status).toBe(404);
    // El body es texto plano corto, suficiente para diagnóstico ops, sin
    // exponer si el host estaba archived vs nunca existió.
    const body = await res.text();
    expect(body).toBe("place_not_found");
    // El handler NUNCA debe setear cookie de state si el host no es válido
    // (defense-in-depth: no leakeamos crypto material para hosts no
    // verified, ni dejamos cookie residual de un flow abortado).
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("S8 sso-init — open-redirect guard", () => {
  it("`returnTo` malicioso (`//evil.com/x`) saneado a `/` antes de propagarse al apex", async () => {
    stubHeaders(AUD_HOST);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });

    const res = await GET(buildInitRequest({ returnTo: "//evil.com/x" }));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const locUrl = new URL(location!);
    // El host del Location es SIEMPRE el apex (no el attacker host) — el
    // handler construye la URL a partir de `apexBaseUrl()`, NO del returnTo.
    expect(locUrl.host).toBe("place.community");
    // Y el `returnTo` propagado queda sanitizado a `/` (defensa #1 del
    // triple-open-redirect-guard; el issue S7 re-valida #2, el redeem #3).
    expect(locUrl.searchParams.get("returnTo")).toBe("/");
  });
});

describe("S8 sso-init — cookie shape canónica", () => {
  it("setea cookie `__Host-place_sso_state` con HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age=120, sin Domain", async () => {
    stubHeaders(AUD_HOST);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });

    const res = await GET(buildInitRequest({ returnTo: "/settings" }));

    // El `__Host-` prefix obliga browser-side el shape (Path=/, Secure, sin
    // Domain). Aquí verificamos que el handler EMITE el shape correcto —
    // si emitiera con Path=/api o Domain attr, el browser silently rejecta
    // la cookie y el flow falla loud en el redeem (`?sso_error=state_invalid`).
    expect(res.status).toBe(302);

    // El header Set-Cookie raw expone TODOS los atributos. Lo parseamos
    // directamente para no depender de la API `res.cookies.get()` de
    // Next.js (que normaliza algunos campos).
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    const cookieHeader = setCookie!;
    expect(cookieHeader.startsWith(`${STATE_COOKIE_NAME}=`)).toBe(true);
    expect(cookieHeader.toLowerCase()).toContain("httponly");
    expect(cookieHeader.toLowerCase()).toContain("secure");
    expect(cookieHeader.toLowerCase()).toContain("samesite=lax");
    expect(cookieHeader.toLowerCase()).toContain("path=/");
    expect(cookieHeader.toLowerCase()).toContain(
      `max-age=${STATE_COOKIE_MAX_AGE_SECONDS}`,
    );
    // El `__Host-` prefix obliga AUSENCIA de `Domain=`. Defense-in-depth.
    expect(cookieHeader.toLowerCase()).not.toContain("domain=");
  });
});

describe("S8 sso-init — redirect URL", () => {
  it("redirect 302 a `https://place.community/api/auth/sso-issue?aud=…&state=…&nonce=…&returnTo=…`", async () => {
    stubHeaders(AUD_HOST);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });

    const res = await GET(buildInitRequest({ returnTo: "/settings/domain" }));

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const locUrl = new URL(location!);

    // El issue del apex es el destino del init: cross-domain redirect que
    // lleva el ticket a redimir de vuelta al custom domain.
    expect(locUrl.protocol).toBe("https:");
    expect(locUrl.host).toBe("place.community");
    expect(locUrl.pathname).toBe("/api/auth/sso-issue");

    // TODOS los query params requeridos por el issuer S7 (Zod schema strict):
    expect(locUrl.searchParams.get("aud")).toBe(AUD_HOST);
    expect(locUrl.searchParams.get("state")).not.toBeNull();
    expect(locUrl.searchParams.get("state")!.length).toBeGreaterThan(0);
    expect(locUrl.searchParams.get("nonce")).not.toBeNull();
    expect(locUrl.searchParams.get("nonce")!.length).toBeGreaterThan(0);
    expect(locUrl.searchParams.get("returnTo")).toBe("/settings/domain");
  });
});

describe("S8 sso-init — round-trip state cookie", () => {
  it("el `state` + `nonce` propagados en query matchean el cookie value (verifyStateCookie roundtrip)", async () => {
    stubHeaders(AUD_HOST);
    mockLookup.mockResolvedValue({
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });

    const res = await GET(buildInitRequest({ returnTo: "/settings" }));
    expect(res.status).toBe(302);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).not.toBeNull();
    // Extraer cookie value: `__Host-place_sso_state=<value>; HttpOnly; ...`
    const match = setCookie!.match(
      new RegExp(`^${STATE_COOKIE_NAME}=([^;]+)`),
    );
    expect(match).not.toBeNull();
    const cookieValue = decodeURIComponent(match![1]!);

    // El `verifyStateCookie` descompone el `state.nonce.signature` firmado
    // por HMAC SHA-256 (clave derivada via HKDF de la signing key). Si el
    // handler firmó algo distinto al state propagado en query, el redeem
    // (S8) detectaría state_mismatch — round-trip acá previene ese bug.
    const decoded = await verifyStateCookie(cookieValue);
    expect(decoded).not.toBeNull();

    const locUrl = new URL(res.headers.get("location")!);
    const queryState = locUrl.searchParams.get("state")!;
    const queryNonce = locUrl.searchParams.get("nonce")!;

    expect(decoded!.state).toBe(queryState);
    expect(decoded!.nonce).toBe(queryNonce);
  });
});
