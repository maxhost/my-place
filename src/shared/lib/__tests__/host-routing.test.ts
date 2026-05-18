import { describe, expect, it } from "vitest";
import { isServiceableSlug, resolveHost } from "../host-routing";

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
