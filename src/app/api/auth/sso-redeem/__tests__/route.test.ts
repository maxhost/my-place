import {
  type JWTVerifyGetKey,
  createLocalJWKSet,
  createRemoteJWKSet,
  exportPKCS8,
  generateKeyPair,
} from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks (vitest evalúa `vi.mock` ANTES de los imports). Pattern S7.
vi.mock("@/shared/lib/custom-domain-lookup", () => ({
  lookupPlaceByDomain: vi.fn(),
}));
vi.mock("@/shared/lib/sso/sso-jti-consume", () => ({
  consumeSsoJti: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
// Partial mock de jose: SOLO `createRemoteJWKSet` se reemplaza por local
// (sin fetch). El resto (SignJWT, jwtVerify, etc.) permanece real → round-trip
// cripto end-to-end sin red.
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: vi.fn() };
});

import { cookies, headers } from "next/headers";

import { lookupPlaceByDomain } from "@/shared/lib/custom-domain-lookup";
import {
  LOCAL_SESSION_COOKIE_NAME,
  LOCAL_SESSION_TTL_SECONDS,
  SSO_TICKET_TTL_SECONDS,
  STATE_COOKIE_NAME,
  __resetSsoKeyCacheForTests,
  __resetSsoStateCacheForTests,
  buildTicketClaims,
  consumeSsoJti,
  loadPublicJwks,
  loadSigningKey,
  signSsoTicket,
  signStateCookie,
  verifyLocalSession,
} from "@/shared/lib/sso";

import { GET, __resetJwksCacheForTests } from "../route";

// Feature C · S8 · sso-redeem — convergencia de TODA la validación de
// seguridad del Signed Ticket. ADR-0032 §2 step 3. 16 tests: state validation
// (4) + ticket validation (3) + anti-replay + race (2) + happy path + security
// (5) + JWKS resilience (1) + query schema defense (1).

const APEX_URL = "https://place.community";
const AUD_HOST = "nocodecompany.co";
const TEST_SUB = "neon-user-id-xyz-456";
const TEST_PLACE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_SLUG = "nocode";

const mockLookup = vi.mocked(lookupPlaceByDomain);
const mockConsume = vi.mocked(consumeSsoJti);
const mockCookies = vi.mocked(cookies);
const mockHeaders = vi.mocked(headers);
const mockJwks = vi.mocked(createRemoteJWKSet);

async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

function stubHeaders(hostHeader: string): void {
  mockHeaders.mockResolvedValue({
    get: (k: string) => (k.toLowerCase() === "host" ? hostHeader : null),
  } as never);
}

function stubCookies(jar: Record<string, string>): void {
  mockCookies.mockResolvedValue({
    get: (name: string) => {
      const value = jar[name];
      return value !== undefined ? { name, value } : undefined;
    },
  } as never);
}

function buildRedeemRequest(
  query: Partial<Record<"ticket" | "state" | "returnTo", string>>,
  host: string = AUD_HOST,
): Request {
  const u = new URL(`https://${host}/api/auth/sso-redeem`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return new Request(u.toString());
}

interface MintOpts {
  sub?: string;
  aud?: string;
  state: string;
  nonce: string;
  jti?: string;
  ttlSeconds?: number;
  nowOffset?: number;
}

async function mintTestTicket(opts: MintOpts): Promise<string> {
  const { privateKey, kid } = await loadSigningKey();
  const nowSeconds = Math.floor(Date.now() / 1000) + (opts.nowOffset ?? 0);
  const claims = buildTicketClaims({
    sub: opts.sub ?? TEST_SUB,
    aud: opts.aud ?? AUD_HOST,
    state: opts.state,
    nonce: opts.nonce,
    jti: opts.jti ?? `jti-${Math.random().toString(36).slice(2, 18)}`,
    nowSeconds,
    ttlSeconds: opts.ttlSeconds,
  });
  return signSsoTicket({ claims, privateKey, kid });
}

/** Setup happy: state cookie firmada + ticket válido matcheando state/nonce. */
async function setupHappy(
  state = "s",
  nonce = "n",
  ticketOpts: Partial<MintOpts> = {},
): Promise<{ ticket: string }> {
  const cookieValue = await signStateCookie({ state, nonce });
  stubCookies({ [STATE_COOKIE_NAME]: cookieValue });
  const ticket = await mintTestTicket({ state, nonce, ...ticketOpts });
  return { ticket };
}

async function activateLocalJwks(): Promise<void> {
  const jwks = createLocalJWKSet(await loadPublicJwks());
  // Cast `as never`: `createLocalJWKSet` retorna callable suficiente, vs
  // `createRemoteJWKSet` type-rich con props extra (coolingDown/etc.) que
  // jose no usa en este code path.
  mockJwks.mockReturnValue(jwks as never);
}

beforeEach(async () => {
  __resetSsoKeyCacheForTests();
  __resetSsoStateCacheForTests();
  __resetJwksCacheForTests();
  mockLookup.mockReset();
  mockConsume.mockReset();
  mockCookies.mockReset();
  mockHeaders.mockReset();
  mockJwks.mockReset();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APEX_URL);
  vi.stubEnv("PLACE_SSO_SIGNING_KEY", await freshTestPem());
  vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "kid-test-s8-redeem");
  stubHeaders(AUD_HOST);
  mockLookup.mockResolvedValue({
    placeId: TEST_PLACE_ID,
    slug: TEST_SLUG,
    defaultLocale: "es",
  });
  mockConsume.mockResolvedValue(true);
  await activateLocalJwks();
});

afterEach(() => {
  __resetSsoKeyCacheForTests();
  __resetSsoStateCacheForTests();
  __resetJwksCacheForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function ssoError(res: Response): string | null {
  return new URL(res.headers.get("location")!).searchParams.get("sso_error");
}

// ---------------------------------------------------------------------------

describe("S8 sso-redeem — state cookie validation", () => {
  it("state cookie ausente → ?sso_error=state_invalid + state cleared + sin session cookie", async () => {
    stubCookies({});
    const ticket = await mintTestTicket({ state: "s", nonce: "n" });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/settings" }),
    );

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe(AUD_HOST);
    expect(loc.pathname).toBe("/settings");
    expect(loc.searchParams.get("sso_error")).toBe("state_invalid");

    const setCookies = res.headers.getSetCookie();
    const stateLine = setCookies.find((c) =>
      c.startsWith(`${STATE_COOKIE_NAME}=`),
    );
    expect(stateLine).toBeDefined();
    expect(stateLine!.toLowerCase()).toContain("max-age=0");
    expect(
      setCookies.some((c) => c.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`)),
    ).toBe(false);
  });

  it("state cookie tampered (verify retorna null) → ?sso_error=state_invalid", async () => {
    stubCookies({ [STATE_COOKIE_NAME]: "garbage.garbage.garbage" });
    const ticket = await mintTestTicket({ state: "s", nonce: "n" });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("state_invalid");
  });

  it("state query mismatch (cookie state ≠ query state) → ?sso_error=state_mismatch", async () => {
    await setupHappy("state-canonical", "nonce-canonical");
    const ticket = await mintTestTicket({
      state: "state-canonical",
      nonce: "nonce-canonical",
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "state-tampered", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("state_mismatch");
  });

  it("ticket nonce ≠ cookie nonce → ?sso_error=nonce_mismatch", async () => {
    // Defensa contra ticket robado y re-emitido por atacante con OTRO state
    // cookie del browser víctima — state matchea pero nonce no.
    const cookieValue = await signStateCookie({
      state: "state-x",
      nonce: "nonce-cookie",
    });
    stubCookies({ [STATE_COOKIE_NAME]: cookieValue });
    const ticket = await mintTestTicket({
      state: "state-x",
      nonce: "nonce-ticket-different",
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "state-x", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("nonce_mismatch");
  });
});

describe("S8 sso-redeem — ticket validation", () => {
  it("ticket signature inválida (char del medio modificado) → ?sso_error=signature_invalid", async () => {
    const { ticket } = await setupHappy();
    // Tamperear char del medio del signature segment: cada char base64url
    // codifica 6 bits significativos vs último char donde 4 bits son padding.
    const segments = ticket.split(".");
    const sig = segments[2]!;
    const midIdx = Math.floor(sig.length / 2);
    const replacement = sig[midIdx] === "A" ? "B" : "A";
    const tampered = `${segments[0]}.${segments[1]}.${sig.slice(0, midIdx)}${replacement}${sig.slice(midIdx + 1)}`;
    const res = await GET(
      buildRedeemRequest({ ticket: tampered, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("signature_invalid");
  });

  it("ticket expirado (exp en el pasado) → ?sso_error=expired", async () => {
    await setupHappy("s", "n");
    // nowOffset=-120 + ttlSeconds=60 → exp = (now-120)+60 = now-60 (pasado).
    const ticket = await mintTestTicket({
      state: "s",
      nonce: "n",
      nowOffset: -120,
      ttlSeconds: 60,
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("expired");
  });

  it("ticket aud mismatch (signed para otro host) → ?sso_error=aud_mismatch", async () => {
    await setupHappy("s", "n");
    const ticket = await mintTestTicket({
      state: "s",
      nonce: "n",
      aud: "otrocustom.com",
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("aud_mismatch");
    // consumeSsoJti NO se invoca si aud falla (jose `jwtVerify` corto-circuita).
    expect(mockConsume).not.toHaveBeenCalled();
  });
});

describe("S8 sso-redeem — anti-replay + race", () => {
  it("`consumeSsoJti` retorna false → ?sso_error=replay + state cleared + sin session", async () => {
    const { ticket } = await setupHappy();
    mockConsume.mockResolvedValueOnce(false);
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/settings" }),
    );
    expect(ssoError(res)).toBe("replay");
    expect(mockConsume).toHaveBeenCalledTimes(1);

    const setCookies = res.headers.getSetCookie();
    const stateLine = setCookies.find((c) =>
      c.startsWith(`${STATE_COOKIE_NAME}=`),
    );
    expect(stateLine).toBeDefined();
    expect(stateLine!.toLowerCase()).toContain("max-age=0");
    expect(
      setCookies.some((c) => c.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`)),
    ).toBe(false);
  });

  it("race `archived_at` mid-flow (`lookupPlaceByDomain` null post-verify) → ?sso_error=invalid_audience", async () => {
    // Owner archiva su custom domain entre issue y redeem. Ticket verify
    // pasa (jose validó aud contra host actual), pero re-lookup detecta
    // archived → invalid_audience. UX correcta: no emitir sesión sobre archived.
    const { ticket } = await setupHappy();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue(null);
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("invalid_audience");
  });
});

describe("S8 sso-redeem — happy path + security", () => {
  it("happy path: 302 a `https://<host><returnTo>` + session cookie set + state cleared", async () => {
    const { ticket } = await setupHappy();
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/settings/domain" }),
    );

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe(AUD_HOST);
    expect(loc.pathname).toBe("/settings/domain");
    expect(loc.searchParams.get("sso_error")).toBeNull();

    const setCookies = res.headers.getSetCookie();
    const sessionLine = setCookies.find((c) =>
      c.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`),
    );
    const stateLine = setCookies.find((c) =>
      c.startsWith(`${STATE_COOKIE_NAME}=`),
    );
    expect(sessionLine).toBeDefined();
    expect(stateLine).toBeDefined();
    expect(stateLine!.toLowerCase()).toContain("max-age=0");
    expect(sessionLine!.toLowerCase()).toContain(
      `max-age=${LOCAL_SESSION_TTL_SECONDS}`,
    );
  });

  it("session JWT decoded: `sub` matchea ticket + `host` matchea request (continuidad RLS)", async () => {
    const { ticket } = await setupHappy("s", "n", {
      sub: "owner-subject-abc",
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(res.status).toBe(302);

    const setCookies = res.headers.getSetCookie();
    const sessionLine = setCookies.find((c) =>
      c.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`),
    );
    expect(sessionLine).toBeDefined();
    const sessionJwt = decodeURIComponent(
      sessionLine!.split(";")[0]!.slice(LOCAL_SESSION_COOKIE_NAME.length + 1),
    );

    // Round-trip: JWT mintado verifica contra MISMA signing key + claims
    // canónicos (continuidad RLS: sub ticket = sub sesión = current_user_id).
    const claims = await verifyLocalSession({
      token: sessionJwt,
      expectedHost: AUD_HOST,
    });
    expect(claims.sub).toBe("owner-subject-abc");
    expect(claims.host).toBe(AUD_HOST);
    expect(claims.iss).toBe("place.community");
    expect(claims.exp - claims.iat).toBe(LOCAL_SESSION_TTL_SECONDS);
  });

  it("cookie shape session: HttpOnly + Secure + SameSite=Lax + Path=/ + Max-Age=604800 sin Domain", async () => {
    const { ticket } = await setupHappy();
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );

    const setCookies = res.headers.getSetCookie();
    const sessionLine = setCookies.find((c) =>
      c.startsWith(`${LOCAL_SESSION_COOKIE_NAME}=`),
    )!;
    expect(sessionLine).toBeDefined();
    expect(sessionLine.toLowerCase()).toContain("httponly");
    expect(sessionLine.toLowerCase()).toContain("secure");
    expect(sessionLine.toLowerCase()).toContain("samesite=lax");
    expect(sessionLine.toLowerCase()).toContain("path=/");
    expect(sessionLine.toLowerCase()).toContain(
      `max-age=${LOCAL_SESSION_TTL_SECONDS}`,
    );
    // `__Host-` prefix obliga ausencia de Domain (host-only browser-side).
    expect(sessionLine.toLowerCase()).not.toContain("domain=");
  });

  it("open-redirect: `returnTo=//evil.com/x` saneado a `/` (defensa #3 del triple-guard)", async () => {
    const { ticket } = await setupHappy();
    const res = await GET(
      buildRedeemRequest({
        ticket,
        state: "s",
        returnTo: "//evil.com/path",
      }),
    );
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe(AUD_HOST);
    expect(loc.pathname).toBe("/");
  });

  it("ticket round-trip cripto: `jwtVerify` valida contra JWKS local activo", async () => {
    const { ticket } = await setupHappy("s", "n", {
      sub: "round-trip-subject",
      ttlSeconds: SSO_TICKET_TTL_SECONDS,
    });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(res.status).toBe(302);
    expect(ssoError(res)).toBeNull();
  });
});

describe("S8 sso-redeem — JWKS resilience + query schema defense", () => {
  it("JWKS fetch throws (apex unreachable) → ?sso_error=signature_invalid (fail-safe)", async () => {
    await setupHappy();
    const throwingGetter: JWTVerifyGetKey = async () => {
      throw new Error("JWKS fetch failed: 503");
    };
    mockJwks.mockReturnValue(throwingGetter as never);
    const ticket = await mintTestTicket({ state: "s", nonce: "n" });
    const res = await GET(
      buildRedeemRequest({ ticket, state: "s", returnTo: "/" }),
    );
    expect(ssoError(res)).toBe("signature_invalid");
  });

  it("query inválida (falta `ticket`) → 302 con ?sso_error=invalid_query (NUNCA 4xx HTML)", async () => {
    stubCookies({});
    const res = await GET(
      buildRedeemRequest({ state: "s", returnTo: "/settings" }),
    );
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe(AUD_HOST);
    expect(loc.pathname).toBe("/settings");
    expect(loc.searchParams.get("sso_error")).toBe("invalid_query");
  });
});
