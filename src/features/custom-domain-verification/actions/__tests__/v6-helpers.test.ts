import { describe, expect, it } from "vitest";
import type {
  DomainConfig,
  DomainStatus,
  VercelResult,
} from "@/shared/lib/vercel";
// Deep import al archivo de definición (no al barrel `public.ts`) para
// evitar arrastrar `registerCustomDomainAction` `"use server"` →
// `next/headers` → vitest rompe. Mismo patrón que
// `custom-domain/__tests__/_domain-section-helpers.tsx:3-4`.
import {
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "@/features/custom-domain/types/custom-domain";
import { decideDomainFlow } from "../_v6-helpers";

// Tests de los helpers PUROS del flow lazy poll consolidado (ADR-0029,
// ADR-0030). Cubren las 3 funciones: `v6ConfigToDnsRecords` (V6 →
// DnsRecord[] del slice, vive en el slice anfitrión `custom-domain`),
// `vercelRecordsToDnsRecords` (V9 →
// DnsRecord[] del slice), y `decideDomainFlow` (decisión consolidada del
// flow lazy según V6 + V9 + verifiedAt DB).
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

describe("v6ConfigToDnsRecords", () => {
  it("emite 1 A record por cada IPv4 + 1 CNAME por cada hostname", () => {
    const config: DomainConfig = {
      configuredBy: null,
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["216.198.79.1"],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: true,
    };
    const records = v6ConfigToDnsRecords(config, "nocodecompany.co");
    expect(records).toEqual([
      { type: "A", name: "nocodecompany.co", value: "216.198.79.1" },
      { type: "CNAME", name: "nocodecompany.co", value: "cname.vercel-dns.com" },
    ]);
  });

  it("emite múltiples A records cuando recommendedIPv4 tiene múltiples values", () => {
    const config: DomainConfig = {
      configuredBy: "A",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["216.198.79.1", "76.76.21.21"],
      recommendedCNAME: [],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "apex.com");
    expect(records).toEqual([
      { type: "A", name: "apex.com", value: "216.198.79.1" },
      { type: "A", name: "apex.com", value: "76.76.21.21" },
    ]);
  });

  it("emite solo CNAME cuando recommendedIPv4 está vacío", () => {
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: false,
    };
    const records = v6ConfigToDnsRecords(config, "blog.ejemplo.com");
    expect(records).toEqual([
      { type: "CNAME", name: "blog.ejemplo.com", value: "cname.vercel-dns.com" },
    ]);
  });

  it("retorna [] cuando ambos arrays están vacíos", () => {
    const config: DomainConfig = {
      configuredBy: null,
      acceptedChallenges: [],
      recommendedIPv4: [],
      recommendedCNAME: [],
      misconfigured: true,
    };
    expect(v6ConfigToDnsRecords(config, "x.com")).toEqual([]);
  });

  it("siempre usa el domain completo como name (no detecta apex/subdomain en V1)", () => {
    const config: DomainConfig = {
      configuredBy: "CNAME",
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: ["76.76.21.21"],
      recommendedCNAME: ["cname.vercel-dns.com"],
      misconfigured: false,
    };
    const apex = v6ConfigToDnsRecords(config, "nocodecompany.co");
    const sub = v6ConfigToDnsRecords(config, "blog.example.com");
    expect(apex[0].name).toBe("nocodecompany.co");
    expect(sub[0].name).toBe("blog.example.com");
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

  it("V6 ok + misconfigured=true + verifiedAt NOT NULL → verified_reset con V6 records (downreverted)", () => {
    const decision = decideDomainFlow({
      v6: makeV6Ok({
        misconfigured: true,
        recommendedIPv4: ["216.198.79.1"],
        recommendedCNAME: ["cname.vercel-dns.com"],
      }),
      v9: makeV9Ok({ verified: true, dnsRecords: [] }),
      verifiedAt: new Date("2026-05-20T00:00:00.000Z"),
      domain: DOMAIN,
    });
    expect(decision).toEqual({
      kind: "verified_reset",
      dnsRecords: [
        { type: "A", name: DOMAIN, value: "216.198.79.1" },
        { type: "CNAME", name: DOMAIN, value: "cname.vercel-dns.com" },
      ],
    });
  });

  it("V6 ok + misconfigured=true + verifiedAt NULL → pending con V6 records (NO wasDownreverted)", () => {
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
      dnsRecords: [{ type: "A", name: DOMAIN, value: "216.198.79.1" }],
      vercelUnavailable: false,
    });
  });

  it("V6 ok + misconfigured=true + V9 verification[] no vacío + verifiedAt NULL → pending con V9 + V6 records combinados", () => {
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
      { type: "A", name: "x.com", value: "216.198.79.1" },
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
