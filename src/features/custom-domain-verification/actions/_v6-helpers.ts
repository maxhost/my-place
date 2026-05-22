import type {
  DomainConfig,
  DomainStatus,
  VercelResult,
} from "@/shared/lib/vercel";
// Deep import al archivo de definición (no al barrel `public.ts`):
// `_v6-helpers.ts` es importado por `v6-helpers.test.ts` y el barrel
// arrastra `registerCustomDomainAction` `"use server"` → `next/headers`
// → vitest rompe. Mismo patrón que `custom-domain/__tests__/
// _domain-section-helpers.tsx:3-4`.
import {
  type DnsRecord,
  v6ConfigToDnsRecords,
  vercelRecordsToDnsRecords,
} from "@/features/custom-domain/types/custom-domain";

// Helper PURO del lazy poll consolidado V9 + V6 (ADR-0029): la decisión
// del flow a partir de los 2 resultados Vercel + state DB. Los mappers
// shape Vercel → `DnsRecord[]` viven en el slice anfitrión (ADR-0030
// §"el slice anfitrión es la SoT de DnsRecord y sus mappers"); este
// archivo importa cross-slice.
//
// Prefijo `_` = privado al sub-slice; no se re-exporta desde `public.ts`.
// Canon (`update-default-locale.ts:13`): actions arrastran `next/headers`
// y NO se testean directo; las piezas puras sí — éste es ese seam,
// testeado en `./__tests__/v6-helpers.test.ts` (17 casos).

/**
 * Decisión del lazy poll. El caller mapea cada `kind` a side-effects:
 * - `verified_persist`: UPDATE `verified_at = now()` + verified.
 * - `verified_keep`: nada en DB + verified.
 * - `verified_fallback`: nada en DB + verified (V6 transient).
 * - `verified_reset`: UPDATE `verified_at = NULL` + pending con
 *   `wasDownreverted`.
 * - `pending`: nada en DB + pending (`vercelUnavailable` si V6 falló).
 */
export type DomainFlowDecision =
  | { kind: "verified_persist" }
  | { kind: "verified_keep" }
  | { kind: "verified_fallback" }
  | { kind: "verified_reset"; dnsRecords: DnsRecord[] }
  | {
      kind: "pending";
      dnsRecords: DnsRecord[] | null;
      vercelUnavailable: boolean;
    };

export function decideDomainFlow(args: {
  v6: VercelResult<DomainConfig>;
  v9: VercelResult<DomainStatus> | null;
  verifiedAt: Date | null;
  domain: string;
}): DomainFlowDecision {
  const { v6, v9, verifiedAt, domain } = args;

  // V6 falló → fallback al state DB.
  if (!v6.ok) {
    return verifiedAt !== null
      ? { kind: "verified_fallback" }
      : { kind: "pending", dnsRecords: null, vercelUnavailable: true };
  }

  // V6 ok + DNS apunta + cert emisible.
  if (!v6.data.misconfigured) {
    if (verifiedAt !== null) return { kind: "verified_keep" };
    // verifiedAt NULL → V9 confirma ownership antes de persistir.
    if (v9 === null || !v9.ok) {
      return {
        kind: "pending",
        dnsRecords: null,
        vercelUnavailable: v9 !== null && !v9.ok,
      };
    }
    if (v9.data.verified) return { kind: "verified_persist" };
    return {
      kind: "pending",
      dnsRecords: vercelRecordsToDnsRecords(v9.data.dnsRecords),
      vercelUnavailable: false,
    };
  }

  // V6 misconfigured=true → DNS roto. Records combinados V9 + V6.
  const v6Records = v6ConfigToDnsRecords(v6.data, domain);
  const v9Records: DnsRecord[] =
    v9 !== null && v9.ok ? vercelRecordsToDnsRecords(v9.data.dnsRecords) : [];
  const combined = [...v9Records, ...v6Records];

  return verifiedAt !== null
    ? { kind: "verified_reset", dnsRecords: combined }
    : { kind: "pending", dnsRecords: combined, vercelUnavailable: false };
}
