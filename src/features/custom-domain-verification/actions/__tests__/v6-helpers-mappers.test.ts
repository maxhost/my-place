import { describe, expect, it } from "vitest";
import type { DomainConfig } from "@/shared/lib/vercel";
// Deep import al archivo de definición (no al barrel `public.ts`) para
// evitar arrastrar `registerCustomDomainAction` `"use server"` →
// `next/headers` → vitest rompe. Mismo patrón que
// `custom-domain/__tests__/_domain-section-helpers.tsx:3-4`.
import {
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "@/features/custom-domain/types/custom-domain";

// Tests de los mappers PUROS Vercel response → `DnsRecord[]` del slice.
// Splittados de `v6-helpers.test.ts` por LOC (CLAUDE.md §"Límites de
// tamaño": archivo ≤300) — el archivo anterior cruzó el límite cuando
// task #110 expandió la cobertura apex/subdomain de
// `v6ConfigToDnsRecords`. La decisión consolidada del flow
// (`decideDomainFlow`) sigue viviendo en `v6-helpers.test.ts`.
//
// Las 2 funciones testeadas viven físicamente en `custom-domain/types/
// custom-domain.ts` (SoT de `DnsRecord` y sus mappers, ADR-0030). Los
// tests están acá por consolidación con el flow consumer V6+V9 — el
// canon es que las piezas puras que componen al action se testean
// (`update-default-locale.ts:13`), y estos mappers son consumidos por
// `decideDomainFlow` + `registerCustomDomainAction`.

// ─── v6ConfigToDnsRecords ───────────────────────────────────────────────
//
// Polish #110 (ADR-0029 §Polish post-S3): el helper detecta apex vs
// subdomain y emite UN record idiomático del shape correcto, matching
// lo que Vercel dashboard muestra al user:
//
//   - **apex** (`nocodecompany.co`) → `[{ A, "@", <first IPv4> }]`.
//     RFC 1034: apex no acepta CNAME. Si no hay IPv4, emite `[]` (no
//     fallback a CNAME ilegal).
//   - **subdomain** (`blog.example.com`) → `[{ CNAME, "blog",
//     <first CNAME> }]`. Si no hay CNAME pero sí IPv4, fallback a A
//     `<prefix>` `<first IPv4>` (defensive; Vercel V6 normalmente trae
//     CNAME en subdomains).
//
// **Antes de #110** el helper emitía A+A+CNAME al apex (RFC 1034
// inválido) y usaba `name = domain` siempre (UX confusa contra Vercel
// dashboard). Smoke real S3 sobre `nocodecompany.co` 2026-05-22 lo
// descubrió.

describe("v6ConfigToDnsRecords — apex", () => {
  it("apex con IPv4: emite 1 A record con name `@` y el PRIMER IPv4 (mimicking Vercel dashboard)", () => {
    const config: DomainConfig = {
      configuredBy: null,
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["216.198.79.1", "64.29.17.1"],
      recommendedCNAME: ["7e106e49d8110f43.vercel-dns-017.com."],
      misconfigured: true,
    };
    const records = v6ConfigToDnsRecords(config, "nocodecompany.co");
    expect(records).toEqual([
      { type: "A", name: "@", value: "216.198.79.1" },
    ]);
  });

  it("apex con un solo IPv4: emite 1 A record con `@`", () => {
    const config: DomainConfig = {
      configuredBy: "A",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["76.76.21.21"],
      recommendedCNAME: [],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "ejemplo.com");
    expect(records).toEqual([
      { type: "A", name: "@", value: "76.76.21.21" },
    ]);
  });

  it("apex sin IPv4 (solo CNAME en V6): emite [] — RFC 1034 prohíbe CNAME en apex", () => {
    // Caso teórico: Vercel V6 retornó solo CNAME sin IPv4 para un apex.
    // El helper se rehúsa a emitir un record inválido. UX result: tabla
    // vacía hasta el próximo refresh. Mejor que mostrar un record que el
    // provider rechazará.
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: false,
    };
    expect(v6ConfigToDnsRecords(config, "ejemplo.com")).toEqual([]);
  });

  it("apex sin IPv4 ni CNAME: emite []", () => {
    const config: DomainConfig = {
      configuredBy: null,
      acceptedChallenges: [],
      recommendedIPv4: [],
      recommendedCNAME: [],
      misconfigured: true,
    };
    expect(v6ConfigToDnsRecords(config, "x.com")).toEqual([]);
  });
});

describe("v6ConfigToDnsRecords — subdomain", () => {
  it("subdomain con CNAME: emite 1 CNAME record con name = prefix (sin sufijo registrable) y el PRIMER CNAME", () => {
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["76.76.21.21"],
      recommendedCNAME: ["cname.vercel-dns.com", "alt.vercel-dns.com"],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "blog.ejemplo.com");
    expect(records).toEqual([
      { type: "CNAME", name: "blog", value: "cname.vercel-dns.com" },
    ]);
  });

  it("subdomain profundo: prefix conserva los segmentos intermedios", () => {
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "a.b.c.ejemplo.com");
    expect(records).toEqual([
      { type: "CNAME", name: "a.b.c", value: "cname.vercel-dns.com" },
    ]);
  });

  it("subdomain sin CNAME pero con IPv4: fallback a A record con prefix (defensive)", () => {
    // Vercel V6 normalmente trae CNAME para subdomains; el fallback existe
    // por defensa contra responses inesperados. El user puede pegar un A
    // record en su provider — funciona aunque sea menos idiomático.
    const config: DomainConfig = {
      configuredBy: "A",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["76.76.21.21"],
      recommendedCNAME: [],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "blog.ejemplo.com");
    expect(records).toEqual([
      { type: "A", name: "blog", value: "76.76.21.21" },
    ]);
  });

  it("subdomain sin IPv4 ni CNAME: emite []", () => {
    const config: DomainConfig = {
      configuredBy: null,
      acceptedChallenges: [],
      recommendedIPv4: [],
      recommendedCNAME: [],
      misconfigured: true,
    };
    expect(v6ConfigToDnsRecords(config, "blog.ejemplo.com")).toEqual([]);
  });

  it("limitación V1 documented: TLD compuesto (`mi-marca.co.uk`) se trata como subdomain → prefix `mi-marca` + CNAME", () => {
    // El helper aplica la heurística de `isApexDomain` (2 parts = apex,
    // 3+ = subdomain). `mi-marca.co.uk` tiene 3 parts → subdomain falso
    // positivo. El user verá `CNAME mi-marca` cuando debería ver `A @`.
    // Polish V2 con Public Suffix List si aparece el caso (referencia
    // ADR-0029 §Polish post-S3).
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["76.76.21.21"],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "mi-marca.co.uk");
    expect(records).toEqual([
      { type: "CNAME", name: "mi-marca", value: "cname.vercel-dns.com" },
    ]);
  });
});

// ─── vercelRecordsToDnsRecords ──────────────────────────────────────────

describe("vercelRecordsToDnsRecords", () => {
  it("usa `name` cuando el wrapper expone `name`", () => {
    const out = vercelRecordsToDnsRecords([
      { type: "TXT", name: "_vercel.x.com", value: "vc-challenge-1" },
    ]);
    expect(out).toEqual([
      { type: "TXT", name: "_vercel.x.com", value: "vc-challenge-1" },
    ]);
  });

  it("usa `domain` como fallback cuando `name` falta", () => {
    const out = vercelRecordsToDnsRecords([
      { type: "TXT", domain: "_vercel.x.com", value: "vc-challenge-2" },
    ]);
    expect(out).toEqual([
      { type: "TXT", name: "_vercel.x.com", value: "vc-challenge-2" },
    ]);
  });

  it("usa string vacío si ni `name` ni `domain` están presentes", () => {
    const out = vercelRecordsToDnsRecords([
      { type: "A", value: "76.76.21.21" },
    ]);
    expect(out).toEqual([{ type: "A", name: "", value: "76.76.21.21" }]);
  });
});
