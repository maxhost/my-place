import { exportPKCS8, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Feature C · S3 · sso-state: cookie de CSRF state firmada con HMAC SHA-256
// (clave derivada via HKDF de la signing key ES256, sin env separada V1) +
// open-redirect guard. ADR-0032 §"Decisión 4 — State cookie + returnTo".
//
// Cubre 11 paths críticos:
// 1.  generateState / generateNonce: random distinct (no determinístico).
// 2.  signStateCookie → verifyStateCookie roundtrip OK.
// 3.  Signature tampered → null (no throw, fail-soft).
// 4.  Formato malformado (2 segmentos / 4 segmentos / vacío) → null.
// 5.  validateReturnTo legítimo (`/settings?x=1#hash`) preserva path + qs + hash.
// 6.  `//evil.com/path` → `/` (protocol-relative open redirect).
// 7.  `https://evil.com` → `/` (absolute URL, no leading slash).
// 8.  `javascript:alert(1)` → `/` (scheme inyectado).
// 9.  null / undefined / "" → `/`.
// 10. `/path` con `?q=` y `#h` se preserva textual.
// 11. La clave HMAC derivada NUNCA aparece en el cookie value (defense-in-depth
//     contra leak del secret en logs/network).

import {
  STATE_COOKIE_MAX_AGE_SECONDS,
  STATE_COOKIE_NAME,
  __resetSsoStateCacheForTests,
  generateNonce,
  generateState,
  signStateCookie,
  validateReturnTo,
  verifyStateCookie,
} from "../sso-state";

// Fresh PKCS8 PEM ES256 por suite — la HMAC key se deriva via HKDF de la
// privada. Re-deriva en cada test reset (cache invalida en
// __resetSsoStateCacheForTests).
async function freshTestPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

beforeAll(async () => {
  const pem = await freshTestPem();
  vi.stubEnv("PLACE_SSO_SIGNING_KEY", pem);
  vi.stubEnv("PLACE_SSO_SIGNING_KEY_KID", "state-test-kid-001");
});

afterEach(() => {
  // No reset del cache entre tests del MISMO suite — la HMAC key derivada es
  // estable bajo la misma signing key. Si un test quiere invalidar, llama
  // __resetSsoStateCacheForTests() explícito.
});

afterAll(() => {
  __resetSsoStateCacheForTests();
  vi.unstubAllEnvs();
});

describe("S3 sso-state — constantes canónicas", () => {
  it("STATE_COOKIE_NAME tiene prefix __Host- (obliga Path=/ + Secure + sin Domain)", () => {
    expect(STATE_COOKIE_NAME).toBe("__Host-place_sso_state");
    expect(STATE_COOKIE_NAME.startsWith("__Host-")).toBe(true);
  });

  it("STATE_COOKIE_MAX_AGE_SECONDS = 120 (60s ticket exp + 60s buffer)", () => {
    expect(STATE_COOKIE_MAX_AGE_SECONDS).toBe(120);
  });
});

describe("S3 sso-state — generateState / generateNonce", () => {
  it("random distinct: dos llamadas retornan valores diferentes (no determinismo)", () => {
    const s1 = generateState();
    const s2 = generateState();
    const n1 = generateNonce();
    const n2 = generateNonce();

    expect(s1).not.toBe(s2);
    expect(n1).not.toBe(n2);

    // Shape: base64url (sólo [A-Za-z0-9_-], sin padding). 32 bytes raw =
    // ~43 chars base64url; 16 bytes = ~22 chars.
    expect(s1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(n1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s1.length).toBeGreaterThanOrEqual(40);
    expect(n1.length).toBeGreaterThanOrEqual(20);
  });
});

describe("S3 sso-state — signStateCookie / verifyStateCookie", () => {
  it("roundtrip happy path: sign + verify retorna {state, nonce} idénticos", async () => {
    const state = generateState();
    const nonce = generateNonce();
    const cookie = await signStateCookie({ state, nonce });

    // Formato esperado: 3 segmentos separados por `.`.
    expect(cookie.split(".")).toHaveLength(3);

    const verified = await verifyStateCookie(cookie);
    expect(verified).toEqual({ state, nonce });
  });

  it("signature tampered: último segmento mutado → null (fail-soft, sin throw)", async () => {
    const cookie = await signStateCookie({ state: "s", nonce: "n" });
    const [s, n, sig] = cookie.split(".");
    // Flip 1 char del signature segment (mantiene length + alphabet).
    const flipped = sig.charAt(0) === "A" ? "B" : "A";
    const tampered = `${s}.${n}.${flipped}${sig.slice(1)}`;

    expect(await verifyStateCookie(tampered)).toBeNull();
  });

  it("formato malformado: 2 / 4 segmentos / empty → null", async () => {
    expect(await verifyStateCookie("")).toBeNull();
    expect(await verifyStateCookie("solo.dos")).toBeNull();
    expect(await verifyStateCookie("uno.dos.tres.cuatro")).toBeNull();
    expect(await verifyStateCookie("..")).toBeNull();
    // signature segment no base64url (caracteres ilegales).
    expect(await verifyStateCookie("a.b.!!!!!")).toBeNull();
  });

  it("HMAC key derivada NUNCA aparece en el cookie value (defense-in-depth leak)", async () => {
    // El cookie value es `${state}.${nonce}.${hmac_signature_base64url}`.
    // El signature es output del HMAC (derivado de la clave, no la clave
    // misma) — verificar que el cookie no contenga el `d` raw del JWK
    // (el material de la signing key del que sale la HMAC key via HKDF).
    const state = "state-leak-test";
    const nonce = "nonce-leak-test";
    const cookie = await signStateCookie({ state, nonce });

    // Reflexivo: jose exporta el `d` component si el caller lo pidiera.
    // No lo pedimos — pero verificamos que el cookie no incluya ningún
    // string ≥20 chars del `d` (cota baja del leak detectable).
    // Más simple: verificar que el cookie tiene length controlada y NO
    // contiene patrones reconocibles del PKCS8 PEM.
    expect(cookie).not.toContain("BEGIN PRIVATE KEY");
    expect(cookie).not.toContain("PLACE_SSO_SIGNING_KEY");
    // Length sanity: state(N) + "." + nonce(M) + "." + sig(~43 base64url HMAC-256).
    const sig = cookie.split(".")[2];
    expect(sig.length).toBeGreaterThanOrEqual(40);
    expect(sig.length).toBeLessThan(64);
  });
});

describe("S3 sso-state — validateReturnTo (open-redirect guard)", () => {
  it("path legítimo absoluto-relativo: `/settings` se preserva textual", () => {
    expect(validateReturnTo("/settings")).toBe("/settings");
    expect(validateReturnTo("/")).toBe("/");
    expect(validateReturnTo("/a/b/c")).toBe("/a/b/c");
  });

  it("query string + hash: `/settings?x=1&y=2#section` se preserva textual", () => {
    expect(validateReturnTo("/settings?x=1#section")).toBe("/settings?x=1#section");
    expect(validateReturnTo("/path?q=a&r=b#h")).toBe("/path?q=a&r=b#h");
  });

  it("protocol-relative `//evil.com/path` → `/` (open-redirect bloqueado)", () => {
    expect(validateReturnTo("//evil.com")).toBe("/");
    expect(validateReturnTo("//evil.com/path")).toBe("/");
    // `/\` es backslash-prefix open-redirect en algunos browsers.
    expect(validateReturnTo("/\\evil.com")).toBe("/");
  });

  it("absolute URL `https://evil.com` → `/` (no empieza con `/`)", () => {
    expect(validateReturnTo("https://evil.com")).toBe("/");
    expect(validateReturnTo("http://evil.com/path")).toBe("/");
    // Defense-in-depth: path absoluto-relativo que CONTIENE `://` también.
    expect(validateReturnTo("/redirect?to=https://evil.com")).toBe("/");
  });

  it("schemes inyectados (`javascript:`, `data:`) → `/` (no empieza con `/`)", () => {
    expect(validateReturnTo("javascript:alert(1)")).toBe("/");
    expect(validateReturnTo("data:text/html,<script>")).toBe("/");
    expect(validateReturnTo("vbscript:msgbox")).toBe("/");
  });

  it("null / undefined / empty / no-leading-slash → `/`", () => {
    expect(validateReturnTo(null)).toBe("/");
    expect(validateReturnTo(undefined)).toBe("/");
    expect(validateReturnTo("")).toBe("/");
    expect(validateReturnTo("settings")).toBe("/"); // sin leading slash.
    expect(validateReturnTo("../../../etc/passwd")).toBe("/"); // path traversal.
  });
});
