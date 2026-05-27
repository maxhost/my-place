import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lookupCustomDomainBySlug } from "../custom-domain-by-slug-lookup";

import {
  buildApexLoginUrl,
  buildPlaceCanonicalUrl,
  buildSubdomainCanonicalUrl,
} from "../auth-redirect";

vi.mock("../custom-domain-by-slug-lookup", () => ({
  lookupCustomDomainBySlug: vi.fn(),
}));

const mockLookup = vi.mocked(lookupCustomDomainBySlug);

// Feature B — Tests de `src/shared/lib/auth-redirect.ts` (S4c, ADR-0031
// §"Bug pre-existente"). Helpers PUROS — solo dependen de
// `process.env.NEXT_PUBLIC_APP_URL` vía `rootDomain()` y el scheme derivado
// del mismo. Sin red, sin DB.
//
// Convención del fixture: cada test parte de `NEXT_PUBLIC_APP_URL=
// https://place.community` (prod canon) y, cuando explora dev/edge, hace
// `vi.stubEnv` LOCAL al test. `afterEach` revierte para no contaminar.

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://place.community");
  mockLookup.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildApexLoginUrl — apex login URL con locale dinámico", () => {
  it("locale válido del place → URL con ese locale (no más hardcoded 'es')", () => {
    expect(buildApexLoginUrl({ defaultLocale: "pt" })).toBe(
      "https://place.community/pt/login",
    );
  });

  it("locale undefined → fallback 'es' (canon, sin regresión vs. hardcoded pre-fix)", () => {
    expect(buildApexLoginUrl({ defaultLocale: undefined })).toBe(
      "https://place.community/es/login",
    );
  });

  it("locale null (shape de `lookupPlaceLocaleBySlug` sin match) → fallback 'es'", () => {
    // El call site canónico es `redirect(buildApexLoginUrl({ defaultLocale:
    // await lookupPlaceLocaleBySlug(slug) }))` — el lookup retorna `string |
    // null`. Aceptar `null` directamente evita el `?? undefined` en cada caller.
    expect(buildApexLoginUrl({ defaultLocale: null })).toBe(
      "https://place.community/es/login",
    );
  });

  it("locale fuera del enum (drift hipotético TS↔DB) → fallback 'es'", () => {
    // Defense-in-depth ante el caso teórico de que el CHECK constraint de
    // `place.default_locale` se expanda antes que el enum del front (mismo
    // invariante que el wrapper TS de S4b §invariante 2).
    expect(buildApexLoginUrl({ defaultLocale: "xx" })).toBe(
      "https://place.community/es/login",
    );
  });

  it("locale string vacío → fallback 'es'", () => {
    expect(buildApexLoginUrl({ defaultLocale: "" })).toBe(
      "https://place.community/es/login",
    );
  });

  it("paridad: cada uno de los 6 locales operativos (ADR-0024) produce su URL", () => {
    const cases: Array<[string, string]> = [
      ["es", "https://place.community/es/login"],
      ["en", "https://place.community/en/login"],
      ["fr", "https://place.community/fr/login"],
      ["pt", "https://place.community/pt/login"],
      ["de", "https://place.community/de/login"],
      ["ca", "https://place.community/ca/login"],
    ];
    for (const [loc, expected] of cases) {
      expect(buildApexLoginUrl({ defaultLocale: loc })).toBe(expected);
    }
  });

  it("dev local: `http://localhost:3000` → scheme + host derivados de la env", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(buildApexLoginUrl({ defaultLocale: "pt" })).toBe(
      "http://localhost:3000/pt/login",
    );
  });

  it("env ausente (string vacío) → fallback canónico `https://place.community`", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(buildApexLoginUrl({ defaultLocale: "es" })).toBe(
      "https://place.community/es/login",
    );
  });

  it("env inválida → fallback `https://place.community/{locale}/login`", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not-a-url");
    expect(buildApexLoginUrl({ defaultLocale: "es" })).toBe(
      "https://place.community/es/login",
    );
  });
});

describe("buildSubdomainCanonicalUrl — URL absoluta del subdomain canon", () => {
  it("happy path: slug + path → `https://{slug}.place.community{path}`", () => {
    expect(
      buildSubdomainCanonicalUrl({ slug: "mi-place", path: "/settings" }),
    ).toBe("https://mi-place.place.community/settings");
  });

  it("path con leading slash se preserva (sin double-slash)", () => {
    expect(
      buildSubdomainCanonicalUrl({ slug: "x", path: "/settings/domain" }),
    ).toBe("https://x.place.community/settings/domain");
  });

  it("path sin leading slash recibe '/' prepended (defense-in-depth)", () => {
    expect(buildSubdomainCanonicalUrl({ slug: "x", path: "settings" })).toBe(
      "https://x.place.community/settings",
    );
  });

  it("path undefined → raíz '/'", () => {
    expect(buildSubdomainCanonicalUrl({ slug: "x" })).toBe(
      "https://x.place.community/",
    );
  });

  it("path con query string se preserva", () => {
    expect(
      buildSubdomainCanonicalUrl({ slug: "x", path: "/settings?tab=lang" }),
    ).toBe("https://x.place.community/settings?tab=lang");
  });

  it("slug uppercase normalizado a lowercase (defense-in-depth, paridad con S4b lookup case-insensitive)", () => {
    expect(buildSubdomainCanonicalUrl({ slug: "Mi-Place", path: "/" })).toBe(
      "https://mi-place.place.community/",
    );
  });

  it("slug con whitespace alrededor: trim aplicado", () => {
    expect(buildSubdomainCanonicalUrl({ slug: "  x  ", path: "/" })).toBe(
      "https://x.place.community/",
    );
  });

  it("dev local: `http://localhost:3000` → `http://{slug}.localhost:3000{path}`", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(
      buildSubdomainCanonicalUrl({ slug: "mi-place", path: "/settings" }),
    ).toBe("http://mi-place.localhost:3000/settings");
  });

  it("env inválida → fallback `https://{slug}.place.community{path}`", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not-a-url");
    expect(buildSubdomainCanonicalUrl({ slug: "x", path: "/" })).toBe(
      "https://x.place.community/",
    );
  });
});

describe("buildPlaceCanonicalUrl — URL zone-aware (custom domain o subdomain canon)", () => {
  it("place con custom domain verified → `https://{customDomain}{path}`", async () => {
    mockLookup.mockResolvedValueOnce("nocodecompany.co");

    const url = await buildPlaceCanonicalUrl({
      slug: "mi-place",
      path: "/invite/abc123",
    });

    expect(url).toBe("https://nocodecompany.co/invite/abc123");
    expect(mockLookup).toHaveBeenCalledWith("mi-place");
  });

  it("place SIN custom domain (lookup retorna null) → fallback al subdomain canon", async () => {
    mockLookup.mockResolvedValueOnce(null);

    const url = await buildPlaceCanonicalUrl({
      slug: "sin-domain",
      path: "/invite/xyz",
    });

    expect(url).toBe("https://sin-domain.place.community/invite/xyz");
  });

  it("path undefined → '/' tanto en custom domain como en subdomain canon", async () => {
    mockLookup.mockResolvedValueOnce("nocodecompany.co");
    expect(await buildPlaceCanonicalUrl({ slug: "x" })).toBe(
      "https://nocodecompany.co/",
    );

    mockLookup.mockResolvedValueOnce(null);
    expect(await buildPlaceCanonicalUrl({ slug: "x" })).toBe(
      "https://x.place.community/",
    );
  });

  it("path sin leading slash recibe '/' prepended (custom domain branch)", async () => {
    mockLookup.mockResolvedValueOnce("nocodecompany.co");

    const url = await buildPlaceCanonicalUrl({
      slug: "x",
      path: "settings/members",
    });

    expect(url).toBe("https://nocodecompany.co/settings/members");
  });

  it("path con leading slash se preserva (sin double-slash, custom domain branch)", async () => {
    mockLookup.mockResolvedValueOnce("nocodecompany.co");

    const url = await buildPlaceCanonicalUrl({
      slug: "x",
      path: "/settings/domain",
    });

    expect(url).toBe("https://nocodecompany.co/settings/domain");
  });

  it("path con query string se preserva (custom domain branch)", async () => {
    mockLookup.mockResolvedValueOnce("nocodecompany.co");

    const url = await buildPlaceCanonicalUrl({
      slug: "x",
      path: "/login?returnTo=/invite/abc",
    });

    expect(url).toBe("https://nocodecompany.co/login?returnTo=/invite/abc");
  });

  it("dev local (NEXT_PUBLIC_APP_URL=http://localhost:3000) + place sin custom → subdomain `*.localhost:3000`", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mockLookup.mockResolvedValueOnce(null);

    const url = await buildPlaceCanonicalUrl({
      slug: "mi-place",
      path: "/invite/abc",
    });

    expect(url).toBe("http://mi-place.localhost:3000/invite/abc");
  });

  it("dev local + place CON custom domain → scheme http preserva (no force https)", async () => {
    // Defense: en dev local podríamos tener `nocodecompany.co` apuntando al
    // tunnel local. El scheme debe seguir el del NEXT_PUBLIC_APP_URL apex,
    // no hardcoded https. (En prod ambos son https, no hay diferencia
    // observable; en dev permite testing con http.)
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mockLookup.mockResolvedValueOnce("nocodecompany.co");

    const url = await buildPlaceCanonicalUrl({
      slug: "mi-place",
      path: "/invite/abc",
    });

    expect(url).toBe("http://nocodecompany.co/invite/abc");
  });

  it("fail-safe: lookup rechaza con error → propaga la excepción al caller", async () => {
    // El wrapper `lookupCustomDomainBySlug` ya tiene fail-safe interno
    // (catch → null + log). Si el caller intercepta lo opuesto (DB up
    // pero query inválido y promise rechazado), el helper no lo enmascara
    // — el caller decide. NO se silencia con try/catch acá porque
    // ocultaría bugs reales (e.g. mock setup roto en tests).
    mockLookup.mockRejectedValueOnce(new Error("synthetic"));

    await expect(
      buildPlaceCanonicalUrl({ slug: "x", path: "/" }),
    ).rejects.toThrow("synthetic");
  });

  it("lookup retorna domain mixto-case (drift) — no se re-normaliza acá; se confía en la SQL function", async () => {
    // La SQL function 0022 ya hace `lower(p_slug)` para match y devuelve el
    // domain tal cual fue registrado (Feature A normaliza a lowercase pre-
    // INSERT). Si por drift retornara mixed case, el helper lo respeta —
    // re-lowercasear acá sería duplicar el invariante de Feature A.
    mockLookup.mockResolvedValueOnce("NoCodeCompany.CO");

    const url = await buildPlaceCanonicalUrl({ slug: "x", path: "/" });

    expect(url).toBe("https://NoCodeCompany.CO/");
  });
});
