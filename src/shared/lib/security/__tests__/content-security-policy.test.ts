import { describe, expect, it } from "vitest";

import {
  buildContentSecurityPolicy,
  generateNonce,
} from "../content-security-policy";

// Tests de la construcción del CSP strict (Phase 2.I). Cubren el CONTRATO de
// las dos funciones puras que el proxy compone por request:
//   - `generateNonce`: único por invocación, base64url (sin `+`/`/`/`=`).
//   - `buildContentSecurityPolicy`: emite TODAS las directivas de la política
//     con el nonce embebido en `script-src` + `'strict-dynamic'`.
// La integración (mutación de req.headers + header de respuesta por zona) se
// testea en `src/__tests__/proxy-csp.test.ts`.

describe("generateNonce", () => {
  it("genera un nonce base64url (sin caracteres no-url-safe)", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("genera un valor distinto en cada invocación (único por request)", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe("buildContentSecurityPolicy", () => {
  const nonce = "test-nonce-123";
  const csp = buildContentSecurityPolicy(nonce);

  it("embebe el nonce + 'strict-dynamic' en script-src", () => {
    expect(csp).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
  });

  it("incluye default-src 'self' como base", () => {
    expect(csp).toContain("default-src 'self'");
  });

  it("permite style-src inline (Tailwind v4 / atributos style del theming)", () => {
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("permite imágenes data/blob/https (avatares + logos + Storage)", () => {
    expect(csp).toContain("img-src 'self' data: blob: https:");
  });

  it("permite font-src self + data", () => {
    expect(csp).toContain("font-src 'self' data:");
  });

  it("permite connect-src a Neon, Upstash y Sentry (beacons client-side)", () => {
    expect(csp).toContain("connect-src");
    expect(csp).toContain("https://*.neon.tech");
    expect(csp).toContain("wss://*.neon.tech");
    expect(csp).toContain("https://*.upstash.io");
    // ADR-0047: el SDK Sentry client POSTea a `*.ingest.<region>.sentry.io`;
    // sin esto el reporte de errores violaría CSP (regresión de observabilidad).
    expect(csp).toContain("https://*.sentry.io");
  });

  it("bloquea embedding (frame-ancestors 'none') + form-action/base-uri self", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("fuerza upgrade-insecure-requests", () => {
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("separa directivas con `; ` (header CSP válido)", () => {
    expect(csp.split("; ").length).toBeGreaterThan(5);
    expect(csp).not.toContain(";;");
  });
});
