import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature B S4a (ADR-0031, 2026-05-22) — tests del shape de `localeCookie` en
// `routing.ts`. La config se evalúa en module load (los helpers privados
// `localeCookieDomain()` + `localeCookieSecure()` leen `NEXT_PUBLIC_APP_URL`
// una sola vez). Para cubrir prod/dev/fallback usamos `vi.resetModules()`
// entre tests y reimportamos `routing` con env mutada — el patrón espeja al
// de `root-domain.test.ts`. NO testeamos los defaults de next-intl (locales,
// defaultLocale, localePrefix); esos están cubiertos por su propia suite
// upstream y no son scope de S4a.

describe("routing — localeCookie cross-subdomain (Feature B S4a)", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
    }
    vi.resetModules();
  });

  it("prod (https://place.community) → domain=.place.community + secure=true", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://place.community";
    const { routing } = await import("../routing");
    expect(routing.localeCookie).toMatchObject({
      name: "NEXT_LOCALE",
      sameSite: "lax",
      path: "/",
      secure: true,
      domain: ".place.community",
    });
  });

  it("dev (http://localhost:3000) → no `domain` key + secure=false", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const { routing } = await import("../routing");
    // En dev la cookie queda host-only: el atributo `Domain` NO se emite
    // (key ausente en el objeto). Browsers rechazan `Domain` con port, y dev
    // no necesita cross-subdomain (multi-tenancy.md §Dev).
    expect(routing.localeCookie).toMatchObject({
      name: "NEXT_LOCALE",
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(routing.localeCookie).not.toHaveProperty("domain");
  });

  it("fallback (env ausente) → domain=.place.community + secure=true", async () => {
    const { routing } = await import("../routing");
    // `rootDomain()` cae a `place.community` cuando la env no está; el
    // `secure` cae a `true` (defensive). Smoke prod cierra el contract.
    expect(routing.localeCookie).toMatchObject({
      name: "NEXT_LOCALE",
      sameSite: "lax",
      path: "/",
      secure: true,
      domain: ".place.community",
    });
  });

  it("env inválida → mismo fallback que env ausente", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-valid-url";
    const { routing } = await import("../routing");
    expect(routing.localeCookie).toMatchObject({
      name: "NEXT_LOCALE",
      sameSite: "lax",
      path: "/",
      secure: true,
      domain: ".place.community",
    });
  });

  it("host con puerto en env (defensivo) → no `domain` key", async () => {
    // No es un caso real de prod, pero el helper guard-ea contra hosts con
    // port porque el RFC no permite port en `Domain` — un misconfig en env
    // no debe degradar a una cookie inválida que el browser rechazaría.
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.com:8443";
    const { routing } = await import("../routing");
    expect(routing.localeCookie).not.toHaveProperty("domain");
    expect(routing.localeCookie).toMatchObject({
      name: "NEXT_LOCALE",
      sameSite: "lax",
      path: "/",
      secure: true,
    });
  });
});
