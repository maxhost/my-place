import { describe, expect, it } from "vitest";
import { isApexDomain, mapPgErrorToActionError } from "../custom-domain";

// Tests de los helpers PUROS del módulo `types/custom-domain.ts`:
//   - `mapPgErrorToActionError`: PG `23505` → `domain_taken` (red de
//     seguridad del branching de `registerCustomDomainAction`).
//   - `isApexDomain`: heurística V1 apex vs subdomain (task #110,
//     polish ADR-0029 §Polish post-S3). Decide el shape de los records
//     emitidos por `v6ConfigToDnsRecords` (`A @` para apex, `CNAME <prefix>`
//     para subdomain) — alinea la UI con lo que Vercel dashboard muestra
//     y respeta RFC 1034 (apex no acepta CNAME).
//
// CANON Server Actions (`update-default-locale.ts:13`): las actions no se
// testean directo con vitest porque arrastran `next/headers` + Neon Auth + DB
// real. Su correctitud es tipo/build + smoke vivo. Pero las piezas puras que
// componen al action SÍ se testean — éste es uno de esos seams.
//
// `v6ConfigToDnsRecords` se testea en `custom-domain-verification/actions/
// __tests__/v6-helpers.test.ts` junto con `decideDomainFlow` por
// consolidación del flow consumer (ADR-0030 §"el slice anfitrión es la
// SoT de DnsRecord y sus mappers"), aunque la función viva acá.

describe("mapPgErrorToActionError", () => {
  it("mapea el code Postgres '23505' (unique_violation) a 'domain_taken'", () => {
    const pgError = { code: "23505", detail: "Key (domain)=(foo.com) already exists." };
    expect(mapPgErrorToActionError(pgError)).toBe("domain_taken");
  });

  it("retorna 'generic' ante un Error nativo sin propiedad code", () => {
    const err = new Error("connection terminated unexpectedly");
    expect(mapPgErrorToActionError(err)).toBe("generic");
  });

  it("retorna 'generic' ante null", () => {
    expect(mapPgErrorToActionError(null)).toBe("generic");
  });

  it("retorna 'generic' ante undefined", () => {
    expect(mapPgErrorToActionError(undefined)).toBe("generic");
  });

  it("retorna 'generic' ante otros códigos Postgres (e.g. FK 23503)", () => {
    // 23503 = foreign_key_violation; en el contexto del INSERT en
    // place_domain no debería ocurrir (place_id viene de un SELECT previo),
    // pero si ocurriera, colapsa al genérico — la UX no distingue.
    const pgError = { code: "23503", detail: "Key (place_id) not present." };
    expect(mapPgErrorToActionError(pgError)).toBe("generic");
  });

  it("retorna 'generic' ante un objeto sin propiedad code", () => {
    const obj = { detail: "weird shape, no code field" };
    expect(mapPgErrorToActionError(obj)).toBe("generic");
  });

  it("retorna 'generic' si code existe pero NO es string '23505' (strict equality)", () => {
    // Postgres normaliza el code a string en node-postgres. Si por alguna
    // razón llega un numérico, lo tratamos como genérico — no inferimos
    // intent. Es defense-in-depth contra cambios futuros del driver.
    const pgError = { code: 23505 };
    expect(mapPgErrorToActionError(pgError)).toBe("generic");
  });

  it("retorna 'generic' ante un string crudo (no es Error ni objeto)", () => {
    expect(mapPgErrorToActionError("connection refused")).toBe("generic");
  });
});

// ─── isApexDomain ───────────────────────────────────────────────────────
//
// Heurística V1 (task #110, polish ADR-0029): split por `.`. 2 parts =
// apex (`nocodecompany.co`); 3+ parts = subdomain (`blog.example.com`).
//
// **Limitación conocida y aceptada V1**: TLDs compuestos (`mi-marca.co.uk`)
// falsa-clasifican como subdomain. La forma correcta sería consultar la
// Public Suffix List, pero V1 mantiene la heurística simple — si el caso
// aparece, polish V2 lo absorbe (referencia ADR-0029 §Polish post-S3 +
// edge case TLD compuesto).
//
// El helper se exporta para que `v6ConfigToDnsRecords` (mismo módulo) y
// cualquier otro consumer cross-slice decidan shape de records con la
// misma lógica. SoT acá.

describe("isApexDomain", () => {
  it("retorna true para apex de 2 parts (`nocodecompany.co`)", () => {
    expect(isApexDomain("nocodecompany.co")).toBe(true);
  });

  it("retorna true para apex `.com`", () => {
    expect(isApexDomain("example.com")).toBe(true);
  });

  it("retorna false para subdomain de 3 parts (`blog.example.com`)", () => {
    expect(isApexDomain("blog.example.com")).toBe(false);
  });

  it("retorna false para subdomain profundo (`a.b.c.example.com`)", () => {
    expect(isApexDomain("a.b.c.example.com")).toBe(false);
  });

  it("limitación V1: TLD compuesto (`mi-marca.co.uk`) → false (falsa-subdomain, documented)", () => {
    // Polish V2 podría usar Public Suffix List para resolver esto. V1
    // acepta el behavior y lo documenta en el helper + ADR-0029.
    expect(isApexDomain("mi-marca.co.uk")).toBe(false);
  });

  it("retorna false para input sin `.` (defensive — no debería pasar pero el helper no asume input válido)", () => {
    expect(isApexDomain("localhost")).toBe(false);
  });

  it("retorna false para string vacío (defensive)", () => {
    expect(isApexDomain("")).toBe(false);
  });
});
