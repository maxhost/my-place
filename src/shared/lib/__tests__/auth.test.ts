import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildNeonAuthConfig } from "@/shared/lib/auth-config";

// S4b: wiring del SDK de Neon Auth. `buildNeonAuthConfig` es puro
// (env → config, sin red, sin importar el runtime del SDK) → testeable
// determinístico. El adapter del SDK (`createNeonAuth().handler()`) NO es
// vitest-testeable (arrastra `next/headers`); su correctitud es de
// tipo/build + preview Vercel.
// El foco del test-guard es el `Domain` apex de la cookie: el place es
// multi-tenant por subdominio, así que la cookie de sesión DEBE llevar
// `Domain=.<apex>` para viajar a `*.<apex>`. Sin punto líder la cookie sería
// host-only y la sesión no cruzaría subdominios → auth rota en silencio entre
// el sitio público y cada place. La verificación cookie/cross-subdomain VIVA
// se difiere a preview Vercel (gotcha `__Secure-` necesita HTTPS, no localhost).

const KEYS = [
  "NEON_AUTH_BASE_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "NEXT_PUBLIC_APP_DOMAIN",
] as const;

const SECRET_32 = "x".repeat(32);
let snapshot: Record<string, string | undefined>;

function setValidEnv() {
  process.env.NEON_AUTH_BASE_URL = "https://ep-test.neonauth.example.com/neondb/auth";
  process.env.NEON_AUTH_COOKIE_SECRET = SECRET_32;
  process.env.NEXT_PUBLIC_APP_DOMAIN = "place.community";
}

beforeEach(() => {
  snapshot = {};
  for (const k of KEYS) snapshot[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
});

describe("buildNeonAuthConfig", () => {
  it("env válida → config con baseUrl + cookies.secret + Domain apex", () => {
    setValidEnv();
    const cfg = buildNeonAuthConfig();
    expect(cfg.baseUrl).toBe(
      "https://ep-test.neonauth.example.com/neondb/auth",
    );
    expect(cfg.cookies.secret).toBe(SECRET_32);
    expect(cfg.cookies.domain).toBe(".place.community");
  });

  it("guard cross-subdomain: cookies.domain empieza con punto (apex, no host-only)", () => {
    setValidEnv();
    expect(buildNeonAuthConfig().cookies.domain?.startsWith(".")).toBe(true);
  });

  it("rechaza si falta NEON_AUTH_BASE_URL", () => {
    setValidEnv();
    delete process.env.NEON_AUTH_BASE_URL;
    expect(() => buildNeonAuthConfig()).toThrow(/NEON_AUTH_BASE_URL/);
  });

  it("rechaza si NEON_AUTH_BASE_URL no es una URL válida", () => {
    setValidEnv();
    process.env.NEON_AUTH_BASE_URL = "no-es-una-url";
    expect(() => buildNeonAuthConfig()).toThrow(/NEON_AUTH_BASE_URL/);
  });

  it("rechaza si falta NEON_AUTH_COOKIE_SECRET", () => {
    setValidEnv();
    delete process.env.NEON_AUTH_COOKIE_SECRET;
    expect(() => buildNeonAuthConfig()).toThrow(/NEON_AUTH_COOKIE_SECRET/);
  });

  it("rechaza un secret de <32 caracteres", () => {
    setValidEnv();
    process.env.NEON_AUTH_COOKIE_SECRET = "x".repeat(31);
    expect(() => buildNeonAuthConfig()).toThrow(/32/);
  });

  it("rechaza si falta NEXT_PUBLIC_APP_DOMAIN", () => {
    setValidEnv();
    delete process.env.NEXT_PUBLIC_APP_DOMAIN;
    expect(() => buildNeonAuthConfig()).toThrow(/NEXT_PUBLIC_APP_DOMAIN/);
  });

  it.each(["localhost", ".place.community", "https://place.community", "place.community/x"])(
    "rechaza NEXT_PUBLIC_APP_DOMAIN no registrable: %s",
    (bad) => {
      setValidEnv();
      process.env.NEXT_PUBLIC_APP_DOMAIN = bad;
      expect(() => buildNeonAuthConfig()).toThrow(/NEXT_PUBLIC_APP_DOMAIN/);
    },
  );
});
