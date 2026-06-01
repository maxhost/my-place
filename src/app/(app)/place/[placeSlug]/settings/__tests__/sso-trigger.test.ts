import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Feature C · S10 · tests del branch sin-sesión en `settings/page.tsx`. ADR-0032
// §"Decisión UX — silent SSO + fallback panel".
//
// El branch sin-sesión de `settings/domain/page.tsx` es ESPEJO 1:1 (única
// diferencia: `returnTo=/settings/domain` + path análogo); cubrir ambos pages
// explotaría la matriz de mocks sin agregar señal. Regression manual del
// domain page va al pre-commit de S10 (plan-sesiones §S10).
//
// Mocking: `next/navigation.redirect` THROWS un sentinel `NavigationError`
// (patrón del propio Next). Los slices se mockean para que el page NO toque
// DB ni i18n real: stubs sintéticos del shape esperado. Aserción de
// componentes JSX vía `result.type === MockComponent` + `result.props.*` —
// `async function` retorna un `ReactElement` describiendo el árbol; los
// hijos NO se invocan en unit test (lo hace el render runtime).
//
// Cobertura (4 tests, `tests.md` §S10):
// 1. Custom-domain + sin sesión + sin `sso_error` → `redirect('/api/auth/
//    sso-init?returnTo=/settings')` (silent SSO trigger).
// 2. Custom-domain + sin sesión + `sso_error=state_mismatch` → render
//    `<SsoFallbackPanel>` con `errorCode` propagado (NO redirect).
// 3. Custom-domain + sesión SSO local → render settings normal (regression
//    happy path post-S9).
// 4. Subdomain canon + sin sesión → `redirect(buildApexLoginUrl)` con locale
//    del place (regression Feature B-S4c).

class NavigationError extends Error {
  constructor(
    public readonly kind: "redirect" | "notFound",
    public readonly target?: string,
  ) {
    super(`navigation:${kind}${target ? `:${target}` : ""}`);
    this.name = "NavigationError";
  }
}

vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new NavigationError("redirect", target);
  }),
  notFound: vi.fn(() => {
    throw new NavigationError("notFound");
  }),
}));
vi.mock("next-intl/server", () => ({
  // `getTranslations({locale, namespace})` retorna una fn `t(key, params?)`
  // que devuelve `namespace.key` con `{slug}` interpolado si está. Suficiente
  // para validar que el page pasa los args correctos sin tirar.
  getTranslations: vi.fn(
    async ({ namespace }: { namespace: string }) =>
      (key: string, params?: Record<string, string>) => {
        const base = `${namespace}.${key}`;
        if (params?.slug) return `${base}[slug=${params.slug}]`;
        return base;
      },
  ),
}));
vi.mock("@/shared/lib/host-routing", () => ({
  isServiceableSlug: vi.fn(() => true),
}));
vi.mock("@/shared/lib/auth-redirect", () => ({
  buildApexLoginUrl: vi.fn(
    ({ defaultLocale }: { defaultLocale: string | null }) =>
      `https://place.community/${defaultLocale ?? "es"}/login`,
  ),
  buildSubdomainCanonicalUrl: vi.fn(
    ({ slug, path }: { slug: string; path: string }) =>
      `https://${slug}.place.community${path}`,
  ),
}));
vi.mock("../../_lib/get-place-for-zone", () => ({
  getHostZoneForZone: vi.fn(),
  getSessionTokenForZone: vi.fn(),
  getPlaceForZone: vi.fn(),
  getPlaceLocaleFallback: vi.fn(),
}));
vi.mock("@/features/nav-hub/public", () => ({
  logoutAction: vi.fn(),
}));
vi.mock("@/features/nav-place/public", () => ({
  // Stub: el branch testeado retorna ANTES de invocar el layout, así que el
  // stub puede ser una `vi.fn` sin shape JSX. Si el test 3 (sesión válida)
  // alcanza el render, validamos por output del nombre del mock.
  NavPlaceLayout: vi.fn(() => null),
}));
vi.mock("@/features/place-settings/public", () => ({
  LocaleSection: vi.fn(() => null),
  updateDefaultLocaleAction: vi.fn(),
}));
vi.mock("@/features/place/public", () => ({
  PLACE_LOCALES: ["es", "en", "fr", "pt", "de", "ca"] as const,
}));
vi.mock("@/features/custom-domain-routing/public", () => ({
  // Componente stub: capturamos los props para asertar contenido (en
  // particular `errorCode` propagado desde el query string).
  SsoFallbackPanel: vi.fn(() => null),
  AuthGateForCustomDomain: vi.fn(() => null),
}));

import type { ReactElement } from "react";

import { redirect } from "next/navigation";

import { SsoFallbackPanel } from "@/features/custom-domain-routing/public";
import { NavPlaceLayout } from "@/features/nav-place/public";

import {
  getHostZoneForZone,
  getPlaceForZone,
  getPlaceLocaleFallback,
  getSessionTokenForZone,
} from "../../_lib/get-place-for-zone";

import PlaceSettingsPage from "../page";

const mockRedirect = vi.mocked(redirect);
const mockGetHostZone = vi.mocked(getHostZoneForZone);
const mockGetSession = vi.mocked(getSessionTokenForZone);
const mockGetPlace = vi.mocked(getPlaceForZone);
const mockGetLocaleFallback = vi.mocked(getPlaceLocaleFallback);

const TEST_SLUG = "nocode";
const TEST_PLACE_ID = "11111111-2222-4333-8444-555555555555";
const TEST_SSO_JWT = "eyJ.sso-local.jwt";

function makeParams() {
  return Promise.resolve({ placeSlug: TEST_SLUG });
}

function makeSearchParams(
  values: Record<string, string | string[] | undefined> = {},
) {
  return Promise.resolve(values);
}

beforeEach(() => {
  mockRedirect.mockClear();
  mockGetHostZone.mockReset();
  mockGetSession.mockReset();
  mockGetPlace.mockReset();
  mockGetLocaleFallback.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("S10 · settings/page.tsx — branch custom-domain + sin sesión", () => {
  it("Sin `sso_error` query → `redirect('/api/auth/sso-init?returnTo=/settings')` (silent SSO trigger)", async () => {
    mockGetHostZone.mockResolvedValue({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    mockGetSession.mockResolvedValue(null);

    let captured: NavigationError | undefined;
    try {
      await PlaceSettingsPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      });
    } catch (err) {
      captured = err as NavigationError;
    }

    expect(captured).toBeInstanceOf(NavigationError);
    expect(captured?.kind).toBe("redirect");
    expect(captured?.target).toBe(
      "/api/auth/sso-init?returnTo=%2Fsettings",
    );
    // No debe tocar el lookup anónimo del subdomain canon (path B). El path
    // del fallback panel no se ejecutó: la única evidencia que recolecta el
    // test es el throw del `redirect()` mock — el page retornó antes de
    // alcanzar el branch del SsoFallbackPanel o el render del shell.
    expect(mockGetLocaleFallback).not.toHaveBeenCalled();
  });

  it("Con `sso_error=state_mismatch` → render del `<SsoFallbackPanel>` con `errorCode` propagado (NO redirect)", async () => {
    mockGetHostZone.mockResolvedValue({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    mockGetSession.mockResolvedValue(null);

    const result = (await PlaceSettingsPage({
      params: makeParams(),
      searchParams: makeSearchParams({ sso_error: "state_mismatch" }),
    })) as ReactElement<{
      canonicalUrl: string;
      labels: {
        failureTitle: string;
        failureBody: string;
        fallbackCta: string;
        technicalDetails: string;
      };
      errorCode?: string;
    }>;

    expect(result).toBeDefined();
    expect(mockRedirect).not.toHaveBeenCalled();
    // El page retorna `<SsoFallbackPanel ...>`. Identity-check sobre `.type`
    // (= mismo símbolo que el mock importado del barrel).
    expect(result.type).toBe(SsoFallbackPanel);
    expect(result.props.errorCode).toBe("state_mismatch");
    expect(result.props.canonicalUrl).toBe(
      `https://${TEST_SLUG}.place.community/settings`,
    );
    expect(result.props.labels.failureTitle).toBe(
      "customDomainRouting.sso.failureTitle",
    );
    expect(result.props.labels.failureBody).toBe(
      `customDomainRouting.sso.failureBody[slug=${TEST_SLUG}]`,
    );
    expect(result.props.labels.fallbackCta).toBe(
      `customDomainRouting.sso.fallbackCta[slug=${TEST_SLUG}]`,
    );
    expect(result.props.labels.technicalDetails).toBe(
      "customDomainRouting.sso.technicalDetails",
    );
  });
});

describe("S10 · settings/page.tsx — happy path con sesión SSO local", () => {
  it("Sesión SSO local válida → render settings normal (NO redirect, NO fallback)", async () => {
    mockGetHostZone.mockResolvedValue({
      zone: "custom-domain",
      placeId: TEST_PLACE_ID,
      slug: TEST_SLUG,
      defaultLocale: "es",
    });
    mockGetSession.mockResolvedValue({
      token: TEST_SSO_JWT,
      source: "sso-local",
    });
    // `PlaceData` con shape completo (`name` + `themeConfig` requeridos por el
    // chrome del settings; `themeConfig.colors` son CSS custom properties que
    // el shell consume — los valores acá son sintéticos para no acoplar el test
    // a una paleta real, cf. CLAUDE.md §"Estilo de código").
    mockGetPlace.mockResolvedValue({
      id: TEST_PLACE_ID,
      slug: TEST_SLUG,
      name: "NoCode Community",
      defaultLocale: "es",
      themeConfig: {
        colors: {
          accent: "#000000",
          bg: "#ffffff",
          ink: "#111111",
        },
      },
    });

    const result = (await PlaceSettingsPage({
      params: makeParams(),
      searchParams: makeSearchParams(),
    })) as ReactElement<{ activeSection: string }>;

    expect(mockRedirect).not.toHaveBeenCalled();
    // Identity-check sobre el shell: el page debe haber montado el layout
    // con su sección activa correcta. NO se renderiza el fallback panel.
    expect(result.type).toBe(NavPlaceLayout);
    expect(result.props.activeSection).toBe("language");
  });
});

describe("S10 · settings/page.tsx — regression Feature B subdomain canon", () => {
  it("Subdomain canon + sin sesión → `redirect(buildApexLoginUrl)` con locale del place", async () => {
    mockGetHostZone.mockResolvedValue({ zone: "place", slug: TEST_SLUG });
    mockGetSession.mockResolvedValue(null);
    mockGetLocaleFallback.mockResolvedValue("fr");

    let captured: NavigationError | undefined;
    try {
      await PlaceSettingsPage({
        params: makeParams(),
        searchParams: makeSearchParams(),
      });
    } catch (err) {
      captured = err as NavigationError;
    }

    expect(captured).toBeInstanceOf(NavigationError);
    expect(captured?.kind).toBe("redirect");
    // `buildApexLoginUrl` mock devuelve el path con el locale resuelto vía
    // `getPlaceLocaleFallback`. Validar URL completa: NO debe ir a sso-init
    // (path A reservado para custom-domain).
    expect(captured?.target).toBe("https://place.community/fr/login");
    expect(mockGetLocaleFallback).toHaveBeenCalledWith(TEST_SLUG);
  });
});
