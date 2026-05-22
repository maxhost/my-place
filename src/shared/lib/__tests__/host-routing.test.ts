import { describe, expect, it, vi } from "vitest";
import {
  type CustomDomainLookup,
  isServiceableSlug,
  resolveHost,
  resolveHostWithCustomDomains,
} from "../host-routing";

// S7 — routing host-based (ADR-0005 §10, multi-tenancy.md). El proxy clasifica
// el host en una de tres zonas y reescribe a paths internos con prefijo
// estático (`/place/{slug}`, `/inbox`) para no colisionar con `[locale]` del
// árbol marketing (Next prohíbe dos segmentos dinámicos distintos en la misma
// posición de URL, incluso entre route groups). La lógica de clasificación es
// PURA → se unit-testea sin red ni DB. La existencia real del slug (→ 404) es
// S5b (resolución DB); acá el gate es estructural (formato + reservados).

const ROOT = "place.community";

describe("resolveHost — clasificación de zona por host", () => {
  it("apex → marketing", () => {
    expect(resolveHost("place.community", ROOT)).toEqual({ zone: "marketing" });
  });

  it("www → marketing (no es un place)", () => {
    expect(resolveHost("www.place.community", ROOT)).toEqual({ zone: "marketing" });
  });

  it("strippea el puerto (dev local)", () => {
    expect(resolveHost("place.community:3000", ROOT)).toEqual({ zone: "marketing" });
    expect(resolveHost("localhost:3000", ROOT)).toEqual({ zone: "marketing" });
  });

  it("localhost y *.localhost (wildcard dev del browser)", () => {
    expect(resolveHost("localhost", ROOT)).toEqual({ zone: "marketing" });
    expect(resolveHost("app.localhost:3000", ROOT)).toEqual({ zone: "inbox" });
    expect(resolveHost("thecompany.localhost:3000", ROOT)).toEqual({
      zone: "place",
      slug: "thecompany",
    });
  });

  it("app.<root> → inbox universal", () => {
    expect(resolveHost("app.place.community", ROOT)).toEqual({ zone: "inbox" });
  });

  it("{slug}.<root> → place, slug normalizado a minúsculas", () => {
    expect(resolveHost("thecompany.place.community", ROOT)).toEqual({
      zone: "place",
      slug: "thecompany",
    });
    expect(resolveHost("TheCompany.place.community", ROOT)).toEqual({
      zone: "place",
      slug: "thecompany",
    });
  });

  it("subdominio reservado de infra (no app/www) → place (la page decide 404)", () => {
    // El proxy no consulta la lista de reservados: rutea al árbol place y la
    // page placeholder hace notFound() (mismo lugar donde S5b pondrá el check
    // de existencia en DB). Solo `app`/`www` tienen ruteo propio.
    expect(resolveHost("api.place.community", ROOT)).toEqual({
      zone: "place",
      slug: "api",
    });
  });

  it("Vercel preview (*.vercel.app) → marketing (sin wildcard de subdominio)", () => {
    expect(resolveHost("place-git-main.vercel.app", ROOT)).toEqual({
      zone: "marketing",
    });
  });

  it("host desconocido / custom domain → marketing (resolución por place_domain diferida)", () => {
    // ADR-0001 / multi-tenancy.md: los custom domains se resuelven por
    // `place_domain` verificado (feature posterior). Hasta entonces, fallback
    // seguro a marketing — nunca servir el place de otro en un host ajeno.
    expect(resolveHost("community.empresa.com", ROOT)).toEqual({
      zone: "marketing",
    });
  });

  it("host vacío → marketing (defensa)", () => {
    expect(resolveHost("", ROOT)).toEqual({ zone: "marketing" });
  });
});

describe("isServiceableSlug — gate estructural del placeholder de place (S7)", () => {
  it("acepta un label DNS válido de producto (≥3, alfanum+guion interno)", () => {
    expect(isServiceableSlug("thecompany")).toBe(true);
    expect(isServiceableSlug("the-company-2")).toBe(true);
  });

  it("rechaza reservados (notFound en la page)", () => {
    expect(isServiceableSlug("app")).toBe(false);
    expect(isServiceableSlug("api")).toBe(false);
    expect(isServiceableSlug("admin")).toBe(false);
  });

  it("rechaza formato inválido (corto, guion de borde, símbolos, vacío)", () => {
    expect(isServiceableSlug("ab")).toBe(false);
    expect(isServiceableSlug("-x-")).toBe(false);
    expect(isServiceableSlug("a_b")).toBe(false);
    expect(isServiceableSlug("a b")).toBe(false);
    expect(isServiceableSlug("")).toBe(false);
  });

  it("normaliza mayúsculas (espeja slugSchema; resolveHost ya viene en minúsc.)", () => {
    expect(isServiceableSlug("TheCompany")).toBe(true);
  });
});

// Feature B (ADR-0031, 2026-05-22) — wrapper async `resolveHostWithCustomDomains`.
// Política de skip (cost budget V1): hosts estructuralmente no-custom (apex,
// `www.<root>`, `app.<root>`, `<slug>.<root>`, `*.localhost`, `*.vercel.app`,
// vacío) NUNCA invocan `lookup`. Sólo los candidatos reales pegan a la DB.
// Fail-safe: `lookup` que tira NO crashea el proxy — colapsa a marketing.
//
// El test mockea `CustomDomainLookup` por su TYPE (no importa el módulo
// concreto que otra agent crea en paralelo en `custom-domain-lookup.ts`).
// `mockTrap()` rejecta siempre — doble red de seguridad: si por bug se
// llamara, el await tira ADEMÁS de fallar el `.not.toHaveBeenCalled()`.

const PLACE_1 = "00000000-0000-0000-0000-000000000001";
const PLACE_2 = "00000000-0000-0000-0000-000000000002";
const PLACE_3 = "00000000-0000-0000-0000-000000000003";

// Helpers: la firma de `CustomDomainLookup` es `(host: string) => Promise<...>`,
// pero TS permite asignar `() => Promise<T>` a `(string) => Promise<T>` por
// compatibilidad estructural (la función-llamadora pasa un arg de más que el
// callee ignora). Mantenemos el body sin declarar `host` para no disparar
// `@typescript-eslint/no-unused-vars` (el repo no configura `argsIgnorePattern`).
const mockResolves = (
  shape: { placeId: string; slug: string; defaultLocale: string },
): CustomDomainLookup => vi.fn(async () => shape);

const mockReturnsNull: () => CustomDomainLookup = () =>
  vi.fn(async () => null);

const mockTrap: () => CustomDomainLookup = () =>
  vi.fn(async () => {
    throw new Error("no debió ser invocado");
  });

describe("resolveHostWithCustomDomains — wrapper async con resolución de custom domains (Feature B S2)", () => {
  it("custom domain verified → variante custom-domain (lookup invocado con el host)", async () => {
    const lookup = mockResolves({ placeId: PLACE_1, slug: "mi-place", defaultLocale: "es" });
    const result = await resolveHostWithCustomDomains("nocodecompany.co", ROOT, lookup);
    expect(result).toEqual({
      zone: "custom-domain",
      placeId: PLACE_1,
      slug: "mi-place",
      defaultLocale: "es",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("nocodecompany.co");
  });

  it("custom domain desconocido (lookup → null) → marketing (lookup sí invocado)", async () => {
    const lookup = mockReturnsNull();
    const result = await resolveHostWithCustomDomains("nocodecompany.co", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("nocodecompany.co");
  });

  it("lookup throws → marketing fail-safe (defense-in-depth, NO propaga el error)", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("DB down");
    }) satisfies CustomDomainLookup;
    const result = await resolveHostWithCustomDomains("nocodecompany.co", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("apex (`<root>`) NO consulta lookup → marketing (skip estructural)", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("place.community", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("`www.<root>` NO consulta lookup → marketing (skip estructural)", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("www.place.community", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("`app.<root>` NO consulta lookup → inbox (sync gana, lookup nunca invocado)", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("app.place.community", ROOT, lookup);
    expect(result).toEqual({ zone: "inbox" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("`<slug>.<root>` NO consulta lookup → place (custom domain NUNCA pisa zona estructural)", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("thecompany.place.community", ROOT, lookup);
    expect(result).toEqual({ zone: "place", slug: "thecompany" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("dev: `localhost` y `*.localhost` NO consultan lookup (ningún hit DB en dev)", async () => {
    const lookup = mockTrap();
    expect(await resolveHostWithCustomDomains("thecompany.localhost:3000", ROOT, lookup)).toEqual({
      zone: "place",
      slug: "thecompany",
    });
    expect(await resolveHostWithCustomDomains("localhost:3000", ROOT, lookup)).toEqual({
      zone: "marketing",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("`*.vercel.app` (preview) NO consulta lookup → marketing", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("place-git-main.vercel.app", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("sin `lookup` (arg omitido) → comportamiento idéntico al sync", async () => {
    // Custom domain colapsa a marketing porque no hay forma de detectarlo.
    expect(await resolveHostWithCustomDomains("nocodecompany.co", ROOT)).toEqual({
      zone: "marketing",
    });
    // Y un host estructural sigue funcionando — paridad con `resolveHost` cuando lookup es undefined.
    expect(await resolveHostWithCustomDomains("app.place.community", ROOT)).toEqual({
      zone: "inbox",
    });
  });

  it("host uppercase → lookup recibe el host normalizado a minúsculas", async () => {
    // Inline `vi.fn()` con `satisfies` para preservar el shape `Mock` y poder
    // leer `.mock.calls[0][0]` (los helpers retornan `CustomDomainLookup`
    // estricto y borrarían esa property). Declaramos el arg `host` y lo
    // descartamos con `void` para satisfacer al lint sin perder la firma.
    const lookup = vi.fn(async (host: string) => {
      void host;
      return {
        placeId: PLACE_2,
        slug: "mi-place",
        defaultLocale: "es",
      };
    }) satisfies CustomDomainLookup;
    const result = await resolveHostWithCustomDomains("NoCodeCompany.CO", ROOT, lookup);
    expect(result).toEqual({
      zone: "custom-domain",
      placeId: PLACE_2,
      slug: "mi-place",
      defaultLocale: "es",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[0]).toBe("nocodecompany.co");
  });

  it("host con `:port` → lookup recibe el host sin puerto", async () => {
    const lookup = mockResolves({ placeId: PLACE_3, slug: "empresa-place", defaultLocale: "es" });
    const result = await resolveHostWithCustomDomains("empresa.com:443", ROOT, lookup);
    expect(result).toEqual({
      zone: "custom-domain",
      placeId: PLACE_3,
      slug: "empresa-place",
      defaultLocale: "es",
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("empresa.com");
  });

  it("host vacío → marketing sin invocar lookup (defensa)", async () => {
    const lookup = mockTrap();
    const result = await resolveHostWithCustomDomains("", ROOT, lookup);
    expect(result).toEqual({ zone: "marketing" });
    expect(lookup).not.toHaveBeenCalled();
  });
});
