import { describe, expect, it } from "vitest";
import type {
  DomainConfig,
  DomainStatus,
  VercelResult,
} from "@/shared/lib/vercel";
// Deep import al archivo de definición (no al barrel `public.ts`) para
// evitar arrastrar `registerCustomDomainAction` `"use server"` →
// `next/headers` → vitest rompe. Mismo patrón que
// `custom-domain/__tests__/_domain-section-helpers.tsx:3-4`. Rationale
// formal y escape hatch declarado en ADR-0039 §"Escape hatch documentado"
// + ADR-0030 §"el slice anfitrión es la SoT de DnsRecord y sus mappers".
// eslint-disable-next-line no-restricted-imports -- ADR-0039 Path B
import {
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "@/features/custom-domain/types/custom-domain";
import { decideDomainFlow } from "../_v6-helpers";

// Tests de los helpers PUROS del flow lazy poll consolidado (ADR-0029,
// ADR-0030). Cubren las 3 funciones: `v6ConfigToDnsRecords` (V6 →
// DnsRecord[] del slice, vive en el slice anfitrión `custom-domain`),
// `vercelRecordsToDnsRecords` (V9 → DnsRecord[] del slice), y
// `decideDomainFlow` (decisión consolidada del flow lazy según V6 + V9 +
// verifiedAt DB).
//
// **EXCEPCIÓN DOCUMENTADA AL LÍMITE LOC ≤300 DE CLAUDE.md** (task #110):
// este archivo excede 300 LOC. Es una **excepción one-off, NO regla**.
// Razón empírica: la bisección de 8 iteraciones del fix #110 (bug deploy
// Vercel modifyConfig `path argument undefined`, ver `docs/gotchas/`)
// demostró que CREAR un nuevo archivo de tests cross-slice
// (`v6-helpers-mappers.test.ts`) en combinación con los otros 3 sets de
// cambios del polish dispara un bug determinístico en el adapter Vercel
// `@vercel/next` durante `Applying modifyConfig from Vercel`. La
// única salida limpia fue mantener todos los tests en este archivo.
// Si esta excepción tiende a multiplicarse, se reabre el split con
// otra estrategia (filename / path / etc).
//
// Canon: las Server Actions arrastran `next/headers` + Neon Auth + DB y NO
// se testean directo con vitest (`update-default-locale.ts:13`). Las piezas
// puras que componen al action SÍ — éstos son esos seams.

// ─── Fixtures helpers ───────────────────────────────────────────────────

function makeV6Ok(over: Partial<DomainConfig> = {}): VercelResult<DomainConfig> {
  return {
    ok: true,
    data: {
      configuredBy: over.configuredBy ?? "CNAME",
      acceptedChallenges: over.acceptedChallenges ?? ["dns-01"],
      recommendedIPv4: over.recommendedIPv4 ?? ["76.76.21.21"],
      recommendedCNAME: over.recommendedCNAME ?? ["cname.vercel-dns.com"],
      misconfigured: over.misconfigured ?? false,
    },
  };
}

function makeV9Ok(over: Partial<DomainStatus> = {}): VercelResult<DomainStatus> {
  return {
    ok: true,
    data: {
      domain: over.domain ?? "ejemplo.com",
      verified: over.verified ?? true,
      dnsRecords: over.dnsRecords ?? [],
    },
  };
}

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

// ─── decideDomainFlow ───────────────────────────────────────────────────

describe("decideDomainFlow", () => {
  const DOMAIN = "nocodecompany.co";

  it("V6 ok + !misconfigured + verifiedAt NOT NULL → verified_keep (sin V9 necesario)", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({ misconfigured: false }),
      v9: null,
      verifiedAt: new Date("2026-05-20T00:00:00.000Z"),
      domain: DOMAIN,
    });
    expect(decision).toEqual({ kind: "verified_keep" });
  });

  it("V6 ok + !misconfigured + verifiedAt NULL + V9 verified=true → verified_persist", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({ misconfigured: false }),
      v9: makeV9Ok({ verified: true }),
      verifiedAt: null,
      domain: DOMAIN,
    });
    expect(decision).toEqual({ kind: "verified_persist" });
  });

  it("V6 ok + !misconfigured + verifiedAt NULL + V9 verified=false → pending con V9 records (TXT challenge)", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({ misconfigured: false }),
      v9: makeV9Ok({
        verified: false,
        dnsRecords: [
          {
            type: "TXT",
            name: "_vercel.nocodecompany.co",
            value: "vc-domain-verify-x",
            domain: "_vercel.nocodecompany.co",
          },
        ],
      }),
      verifiedAt: null,
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "pending",
      dnsRecords: [
        { type: "TXT", name: "_vercel.nocodecompany.co", value: "vc-domain-verify-x" },
      ],
      vercelUnavailable: false,
    });
  });

  it("V6 ok + !misconfigured + verifiedAt NULL + V9 failed → pending vercelUnavailable=true (conservative, no persist)", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({ misconfigured: false }),
      v9: { ok: false, reason: "network" },
      verifiedAt: null,
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "pending",
      dnsRecords: null,
      vercelUnavailable: true,
    });
  });

  it("V6 ok + misconfigured=true + verifiedAt NOT NULL + V9 verification[] vacío → verified_reset con SOLO V6 records (smoke real nocodecompany.co)", () => {
    // Caso del smoke real S3 2026-05-22: `nocodecompany.co` apex, ownership
    // clear en Vercel (V9 verified=true, dnsRecords=[]), pero DNS roto
    // (V6 misconfigured=true). El fix #110 evita combinar V9+V6 cuando
    // V9 está vacío — antes el resultado emitía `[A apex.com, CNAME
    // apex.com]` (RFC 1034 inválido). Ahora emite solo `A @`.
    const decision = decideDomainFlow({
      v6: makeV6Ok({
        misconfigured: true,
        recommendedIPv4: ["216.198.79.1", "64.29.17.1"],
        recommendedCNAME: ["7e106e49d8110f43.vercel-dns-017.com."],
      }),
      v9: makeV9Ok({ verified: true, dnsRecords: [] }),
      verifiedAt: new Date("2026-05-20T00:00:00.000Z"),
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "verified_reset",
      dnsRecords: [{ type: "A", name: "@", value: "216.198.79.1" }],
    });
  });

  it("V6 ok + misconfigured=true + verifiedAt NULL + V9 vacío → pending con SOLO V6 records (apex `@`)", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({
        misconfigured: true,
        recommendedIPv4: ["216.198.79.1"],
        recommendedCNAME: [],
      }),
      v9: makeV9Ok({ verified: false, dnsRecords: [] }),
      verifiedAt: null,
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "pending",
      dnsRecords: [{ type: "A", name: "@", value: "216.198.79.1" }],
      vercelUnavailable: false,
    });
  });

  it("V6 ok + misconfigured=true + V9 verification[] NO vacío + verifiedAt NULL → pending con V9 (TXT challenge) + V6 records combinados", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({
        misconfigured: true,
        recommendedIPv4: ["216.198.79.1"],
        recommendedCNAME: [],
      }),
      v9: makeV9Ok({
        verified: false,
        dnsRecords: [
          {
            type: "TXT",
            name: "_vercel.x.com",
            value: "vc-domain-verify-y",
            domain: "_vercel.x.com",
          },
        ],
      }),
      verifiedAt: null,
      domain: "x.com",
    });
    if (decision.kind !== "pending") throw new Error("expected pending");
    expect(decision.dnsRecords).toEqual([
      { type: "TXT", name: "_vercel.x.com", value: "vc-domain-verify-y" },
      { type: "A", name: "@", value: "216.198.79.1" },
    ]);
  });

  it("V6 failed + verifiedAt NOT NULL → verified_fallback (mantener UI verified ante transient)", () => {
    const decision = decideDomainFlow({
      v6: { ok: false, reason: "network" },
      v9: null,
      verifiedAt: new Date("2026-05-20T00:00:00.000Z"),
      domain: DOMAIN,
    });
    expect(decision).toEqual({ kind: "verified_fallback" });
  });

  it("V6 failed + verifiedAt NULL → pending vercelUnavailable=true", () => {
    const decision = decideDomainFlow({
      v6: { ok: false, reason: "rate_limited" },
      v9: makeV9Ok({ verified: false, dnsRecords: [] }),
      verifiedAt: null,
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "pending",
      dnsRecords: null,
      vercelUnavailable: true,
    });
  });
});
