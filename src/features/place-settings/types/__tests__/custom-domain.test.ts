import { describe, expect, it } from "vitest";
import { mapPgErrorToActionError } from "../custom-domain";

// Tests del único helper PURO del módulo `types/custom-domain.ts` —
// `mapPgErrorToActionError`. Estos tests son la red de seguridad de cobertura
// para el branching crítico del Server Action `registerCustomDomainAction`
// (S3): cuando el INSERT en `place_domain` choca contra la partial unique
// index `place_domain_domain_active_unq` (S1, ADR-0026), Postgres tira un
// error con `code === "23505"` y el action lo mapea a
// `RegisterError.domain_taken`. Cualquier otro error de DB (FK, check
// constraint, sintaxis, transport) colapsa a `"generic"` — el caller no tiene
// nada útil que comunicar al owner ahí, salvo "probá de nuevo".
//
// CANON Server Actions (`update-default-locale.ts:13`): las actions no se
// testean directo con vitest porque arrastran `next/headers` + Neon Auth + DB
// real. Su correctitud es tipo/build + smoke vivo. Pero las piezas puras que
// componen al action SÍ se testean — éste es uno de esos seams.

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
