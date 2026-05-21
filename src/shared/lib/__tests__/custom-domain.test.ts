import { describe, expect, it, vi } from "vitest";
import { validateCustomDomain } from "../custom-domain";

// S2 — `validateCustomDomain` es la SoT compartida client+server del custom
// domain V1 (docs/features/custom-domain/spec.md + tests.md). Función pura
// sin red ni DB → se unit-testea con un mock de `isReservedDomain` para no
// acoplarnos con la blocklist de Agent B; los casos `place.community` y
// `*.vercel.app` cubren ambas direcciones (apex reservado + suffix PaaS).
// En green-close real, la implementación corre contra `reserved-domains.ts`
// posta — los tests siguen valiendo porque esos dos casos viven en la
// blocklist canónica (ver reserved-domains.test.ts del proyecto).

vi.mock("../reserved-domains", () => ({
  isReservedDomain: (d: string) =>
    d.toLowerCase() === "place.community" ||
    d.toLowerCase().endsWith(".vercel.app"),
}));

// Helper para construir hostnames de longitud arbitraria reusando un label de
// 63 chars (alfanum, válido por sí mismo). El segundo label suma TLD `.co`.
const LABEL_63 = "a".repeat(63);
const LABEL_64 = "a".repeat(64);

describe("validateCustomDomain — válidos (RFC 1123 ASCII)", () => {
  it("acepta un dominio simple lowercase", () => {
    expect(validateCustomDomain("mi-marca.com")).toEqual({
      ok: true,
      normalized: "mi-marca.com",
    });
  });

  it("acepta un dominio multi-label (co.uk)", () => {
    expect(validateCustomDomain("comunidad.empresa.co.uk")).toEqual({
      ok: true,
      normalized: "comunidad.empresa.co.uk",
    });
  });

  it("normaliza uppercase + trim antes de validar", () => {
    expect(validateCustomDomain("  Mi-Marca.COM  ")).toEqual({
      ok: true,
      normalized: "mi-marca.com",
    });
  });

  it("acepta un label de 63 chars (boundary superior del label)", () => {
    expect(validateCustomDomain(`${LABEL_63}.co`)).toEqual({
      ok: true,
      normalized: `${LABEL_63}.co`,
    });
  });
});

describe("validateCustomDomain — inválidos por formato (RFC 1123)", () => {
  it("rechaza leading hyphen en label", () => {
    expect(validateCustomDomain("-foo.com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza trailing hyphen en label", () => {
    expect(validateCustomDomain("foo-.com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza dominio sin TLD (un solo label)", () => {
    expect(validateCustomDomain("foo")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza label vacío inicial (`.com`)", () => {
    expect(validateCustomDomain(".com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza trailing dot (`foo.com.`)", () => {
    expect(validateCustomDomain("foo.com.")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza doble punto consecutivo (`foo..com`)", () => {
    expect(validateCustomDomain("foo..com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza label de 64 chars (boundary superior +1)", () => {
    expect(validateCustomDomain(`${LABEL_64}.co`)).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza hostname > 253 chars", () => {
    // 4 labels de 63 + 3 dots = 255 chars (> 253).
    const tooLong = `${LABEL_63}.${LABEL_63}.${LABEL_63}.${LABEL_63}`;
    expect(tooLong.length).toBe(255);
    expect(validateCustomDomain(tooLong)).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza wildcards (`*.foo.com`)", () => {
    expect(validateCustomDomain("*.foo.com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza IP literal v4 dotted", () => {
    expect(validateCustomDomain("192.168.1.1")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza IP literal v6 (chars `:`)", () => {
    expect(validateCustomDomain("::1")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza chars no permitidos (underscore, espacio)", () => {
    expect(validateCustomDomain("foo_bar.com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
    expect(validateCustomDomain("foo bar.com")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });
});

describe("validateCustomDomain — inválidos por IDN (V1 rechaza)", () => {
  it("rechaza chars no-ASCII (umlaut alemán)", () => {
    expect(validateCustomDomain("münchen.de")).toEqual({
      ok: false,
      reason: "idn_not_supported",
    });
  });

  it("rechaza prefijo punycode `xn--` explícito en cualquier label", () => {
    expect(validateCustomDomain("xn--mnchen-3ya.de")).toEqual({
      ok: false,
      reason: "idn_not_supported",
    });
  });
});

describe("validateCustomDomain — inválidos por reservados (delega a isReservedDomain)", () => {
  it("rechaza apex de Place (`place.community`)", () => {
    expect(validateCustomDomain("place.community")).toEqual({
      ok: false,
      reason: "reserved",
    });
  });

  it("rechaza suffix `.vercel.app`", () => {
    expect(validateCustomDomain("mi-place.vercel.app")).toEqual({
      ok: false,
      reason: "reserved",
    });
  });
});

describe("validateCustomDomain — edge", () => {
  it("rechaza input vacío como invalid_format", () => {
    expect(validateCustomDomain("")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("rechaza input solo whitespace como invalid_format (post-trim queda vacío)", () => {
    expect(validateCustomDomain("   ")).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });
});
