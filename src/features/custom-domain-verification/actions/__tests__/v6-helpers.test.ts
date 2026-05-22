import { describe, expect, it } from "vitest";
import type {
  DomainConfig,
  DomainStatus,
  VercelResult,
} from "@/shared/lib/vercel";
import { decideDomainFlow } from "../_v6-helpers";

// Tests del helper PURO `decideDomainFlow` — la decisión consolidada
// del flow lazy según V6 + V9 + verifiedAt DB (ADR-0029, ADR-0030).
// Los tests de los mappers `v6ConfigToDnsRecords` y
// `vercelRecordsToDnsRecords` viven en `v6-helpers-mappers.test.ts`
// (split por LOC tras task #110 que expandió cobertura apex/subdomain).
//
// Canon: las Server Actions arrastran `next/headers` + Neon Auth + DB y NO
// se testean directo con vitest (`update-default-locale.ts:13`). Las piezas
// puras que componen al action SÍ — éste es ese seam.

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
    // Caso ownership challenge pendiente (dominio en uso por otro
    // proyecto Vercel): V9 trae el TXT challenge real, V6 trae los
    // records de propagación. Combinamos solo cuando V9 tiene records
    // que mostrar — la heurística #110 mantiene esto.
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
