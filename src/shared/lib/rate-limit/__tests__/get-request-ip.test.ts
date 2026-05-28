import { describe, expect, it } from "vitest";

import { parseForwardedIp } from "../get-request-ip";

// Tests del parser puro `parseForwardedIp` — la variante async `getRequestIp`
// que lee `next/headers` queda cubierta indirectamente (delega al parser para
// la lógica de split + trim + fallback).

describe("parseForwardedIp", () => {
  it("retorna 'unknown' cuando el header falta", () => {
    expect(parseForwardedIp(null)).toBe("unknown");
  });

  it("retorna 'unknown' cuando el header está vacío", () => {
    expect(parseForwardedIp("")).toBe("unknown");
  });

  it("retorna 'unknown' cuando el primer slot es vacío (', proxy')", () => {
    expect(parseForwardedIp(", 10.0.0.1")).toBe("unknown");
  });

  it("retorna la IP única cuando hay un solo valor (request directo)", () => {
    expect(parseForwardedIp("1.2.3.4")).toBe("1.2.3.4");
  });

  it("retorna el primer IP cuando hay múltiples (cliente, proxy1, proxy2)", () => {
    expect(parseForwardedIp("1.2.3.4, 10.0.0.1, 10.0.0.2")).toBe("1.2.3.4");
  });

  it("trimea whitespace alrededor del primer slot", () => {
    expect(parseForwardedIp("  1.2.3.4  ,  10.0.0.1")).toBe("1.2.3.4");
  });

  it("retorna IPv6 sin alterar", () => {
    expect(parseForwardedIp("2001:db8::1, 10.0.0.1")).toBe("2001:db8::1");
  });

  it("retorna IPv6 con múltiples colons sin truncar", () => {
    expect(parseForwardedIp("fe80::1ff:fe23:4567:890a")).toBe(
      "fe80::1ff:fe23:4567:890a",
    );
  });
});
