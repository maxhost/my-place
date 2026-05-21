import { describe, expect, it } from "vitest";
import {
  RESERVED_DOMAIN_SUFFIXES,
  RESERVED_DOMAINS,
  isReservedDomain,
} from "../reserved-domains";

// `isReservedDomain()` es el gate de "este host NO puede ser custom domain de
// un place" para la feature custom-domain V1 (ADR-0026). Pure module sin deps:
// chequea (a) apex exactos del marketing/sistema, (b) suffixes de PaaS gratuitos
// donde un dominio "regalado" no debe poder reclamarse como propio, y (c) IP
// literales (v4/v6) que tampoco son dominios reclamables. La autoridad final
// del rechazo en el form de settings vive en `validateCustomDomain` (Agent A),
// que importa de este módulo — por eso este archivo es standalone (acíclico).

describe("RESERVED_DOMAINS — apex exactos del sistema", () => {
  it("incluye 'place.community' (apex del marketing)", () => {
    expect(RESERVED_DOMAINS).toContain("place.community");
  });
});

describe("RESERVED_DOMAIN_SUFFIXES — PaaS providers + apex como suffix", () => {
  it("incluye '.place.community' (subdominios del propio sistema)", () => {
    expect(RESERVED_DOMAIN_SUFFIXES).toContain(".place.community");
  });

  it("incluye '.vercel.app', '.netlify.app', '.github.io', '.ngrok.io'", () => {
    expect(RESERVED_DOMAIN_SUFFIXES).toContain(".vercel.app");
    expect(RESERVED_DOMAIN_SUFFIXES).toContain(".netlify.app");
    expect(RESERVED_DOMAIN_SUFFIXES).toContain(".github.io");
    expect(RESERVED_DOMAIN_SUFFIXES).toContain(".ngrok.io");
  });

  it("todos los suffixes empiezan con '.' (contract)", () => {
    for (const suffix of RESERVED_DOMAIN_SUFFIXES) {
      expect(suffix.startsWith(".")).toBe(true);
    }
  });
});

describe("isReservedDomain — apex exactos", () => {
  it("'place.community' → true", () => {
    expect(isReservedDomain("place.community")).toBe(true);
  });

  it("case-insensitive: 'PLACE.COMMUNITY' → true", () => {
    expect(isReservedDomain("PLACE.COMMUNITY")).toBe(true);
  });

  it("trim defensivo: '  place.community  ' → true", () => {
    expect(isReservedDomain("  place.community  ")).toBe(true);
  });
});

describe("isReservedDomain — suffix '.place.community'", () => {
  it("'cualquiera.place.community' → true", () => {
    expect(isReservedDomain("cualquiera.place.community")).toBe(true);
  });

  it("'foo.bar.place.community' (multi-label) → true", () => {
    expect(isReservedDomain("foo.bar.place.community")).toBe(true);
  });
});

describe("isReservedDomain — suffixes de PaaS gratuitos", () => {
  it("'mi-app.vercel.app' → true", () => {
    expect(isReservedDomain("mi-app.vercel.app")).toBe(true);
  });

  it("'algo.netlify.app' → true", () => {
    expect(isReservedDomain("algo.netlify.app")).toBe(true);
  });

  it("'user.github.io' → true", () => {
    expect(isReservedDomain("user.github.io")).toBe(true);
  });

  it("'tunnel.ngrok.io' → true", () => {
    expect(isReservedDomain("tunnel.ngrok.io")).toBe(true);
  });

  it("case-insensitive en suffix: 'Mi-App.Vercel.App' → true", () => {
    expect(isReservedDomain("Mi-App.Vercel.App")).toBe(true);
  });
});

describe("isReservedDomain — IP literal v4", () => {
  it("'10.0.0.1' → true", () => {
    expect(isReservedDomain("10.0.0.1")).toBe(true);
  });

  it("'192.168.1.1' → true", () => {
    expect(isReservedDomain("192.168.1.1")).toBe(true);
  });

  it("'127.0.0.1' → true", () => {
    expect(isReservedDomain("127.0.0.1")).toBe(true);
  });

  it("'255.255.255.255' (límite válido) → true", () => {
    expect(isReservedDomain("255.255.255.255")).toBe(true);
  });

  it("'256.0.0.1' (octeto fuera de rango) → false (no es IP válida ni matchea suffix; el rechazo lo hace validateCustomDomain por invalid_format)", () => {
    expect(isReservedDomain("256.0.0.1")).toBe(false);
  });
});

describe("isReservedDomain — IP literal v6", () => {
  it("'::1' (loopback) → true", () => {
    expect(isReservedDomain("::1")).toBe(true);
  });

  it("'fe80::1' (link-local) → true", () => {
    expect(isReservedDomain("fe80::1")).toBe(true);
  });

  it("'2001:db8::1' (documentación) → true", () => {
    expect(isReservedDomain("2001:db8::1")).toBe(true);
  });

  it("'::ffff:192.0.2.1' (IPv4-mapped) → true", () => {
    expect(isReservedDomain("::ffff:192.0.2.1")).toBe(true);
  });
});

describe("isReservedDomain — sanity check (dominios reclamables)", () => {
  it("'mi-marca.com' → false", () => {
    expect(isReservedDomain("mi-marca.com")).toBe(false);
  });

  it("'comunidad.empresa.co.uk' → false", () => {
    expect(isReservedDomain("comunidad.empresa.co.uk")).toBe(false);
  });

  it("'foo.com' → false", () => {
    expect(isReservedDomain("foo.com")).toBe(false);
  });

  it("string vacío → false (no es reservado; el rechazo formal lo hace el schema)", () => {
    expect(isReservedDomain("")).toBe(false);
  });

  it("'placecommunity.com' (similar pero distinto) → false", () => {
    expect(isReservedDomain("placecommunity.com")).toBe(false);
  });
});
