import { describe, expect, it } from "vitest";

// Feature C · S11.3.B · validate-login-return-to: helper PURE que decide si
// una URL `?returnTo` recibida por la página apex `/[locale]/login` es safe
// de honrar tras autenticación. ADR-0033 (canon V1).
//
// Policy V1 (intersección de reglas validadas vs S11.1 same-registrable-domain
// precedent + open-redirect best practice):
//
//   1. ABSOLUTE URLs: deben matchear (a) https + (b) same-registrable-domain
//      como el apex. Allowlist explícito del path: `/api/auth/sso-issue` O
//      `/api/auth/sso-init` ÚNICAMENTE. Cualquier otro path absoluto
//      same-registrable-domain → rechazo.
//   2. RELATIVE PATHs: aceptados si empiezan con `/` + NO `//`
//      (protocol-relative) + NO scheme injection.
//   3. Cualquier otro input (null, undefined, empty, scheme-relative,
//      attacker domain absoluto, paths con scheme injection, etc.) → `null`.
//
// 12 tests canónicos cubriendo todos los paths del helper (RED → GREEN antes
// de wire-up en S11.3.C).

import { validateLoginReturnTo } from "../validate-login-return-to";

const APEX_HOST = "place.community";

describe("S11.3.B validateLoginReturnTo — input invalid (caller usa fallback Hub canónico)", () => {
  it("1. null → null (default sin returnTo)", () => {
    expect(validateLoginReturnTo(null, APEX_HOST)).toBe(null);
  });

  it("2. undefined → null", () => {
    expect(validateLoginReturnTo(undefined, APEX_HOST)).toBe(null);
  });

  it("3. empty string → null", () => {
    expect(validateLoginReturnTo("", APEX_HOST)).toBe(null);
  });

  it("4. whitespace-only → null", () => {
    expect(validateLoginReturnTo("   ", APEX_HOST)).toBe(null);
    expect(validateLoginReturnTo("\t\n", APEX_HOST)).toBe(null);
  });
});

describe("S11.3.B validateLoginReturnTo — relative paths (aceptados same-origin)", () => {
  it("5. relative path simple (`/settings`) → preservado tal cual", () => {
    expect(validateLoginReturnTo("/settings", APEX_HOST)).toBe("/settings");
  });

  it("6. relative path con query + hash → preservado tal cual", () => {
    expect(validateLoginReturnTo("/foo?x=1#y", APEX_HOST)).toBe("/foo?x=1#y");
  });
});

describe("S11.3.B validateLoginReturnTo — open-redirect vectors (rechazados)", () => {
  it("7. protocol-relative (`//attacker.com`) → null", () => {
    expect(validateLoginReturnTo("//attacker.com", APEX_HOST)).toBe(null);
    expect(validateLoginReturnTo("//attacker.com/path", APEX_HOST)).toBe(null);
  });

  it("8. scheme-relative non-http (`javascript:alert(1)`) → null", () => {
    expect(validateLoginReturnTo("javascript:alert(1)", APEX_HOST)).toBe(null);
    expect(validateLoginReturnTo("data:text/html,<script>", APEX_HOST)).toBe(null);
  });

  it("9. absolute attacker domain (`https://attacker.com/settings`) → null", () => {
    expect(validateLoginReturnTo("https://attacker.com/settings", APEX_HOST)).toBe(
      null,
    );
    // Lookalike: domain que contiene el apex como sub-label NO matchea (el
    // registrable check no debe ser substring; defense vs `place.community.evil.com`)
    expect(
      validateLoginReturnTo("https://place.community.evil.com/api/auth/sso-issue", APEX_HOST),
    ).toBe(null);
  });
});

describe("S11.3.B validateLoginReturnTo — absolute URLs same-registrable-domain", () => {
  it("10. allowlist hit (`https://place.community/api/auth/sso-issue?...`) → preservado", () => {
    const url = "https://place.community/api/auth/sso-issue?aud=nocodecompany.co&state=abc&nonce=def&returnTo=%2Fsettings";
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(url);
  });

  it("10b. allowlist hit `/api/auth/sso-init` también (segundo path canónico)", () => {
    const url = "https://place.community/api/auth/sso-init?returnTo=%2Fsettings";
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(url);
  });

  it("10c. subdomain del apex (www.place.community) tratado como same-registrable", () => {
    // Defense-in-depth: si Vercel redirige apex→www, `redirectToApexLogin`
    // podría emitir contra cualquier subdomain del apex. Allowlist path
    // sigue siendo lo que importa.
    const url = "https://www.place.community/api/auth/sso-issue?aud=nocodecompany.co";
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(url);
  });

  it("11. allowlist MISS same-registrable-domain (`https://place.community/admin`) → null", () => {
    expect(
      validateLoginReturnTo("https://place.community/admin", APEX_HOST),
    ).toBe(null);
    // Path que CONTIENE el allowlist substring pero NO ES exact match → null.
    // Defense vs `/api/auth/sso-issue/../../admin` o `/redirect?to=/api/auth/sso-issue`.
    expect(
      validateLoginReturnTo("https://place.community/api/auth/sso-issuefoo", APEX_HOST),
    ).toBe(null);
    expect(
      validateLoginReturnTo("https://place.community/foo/api/auth/sso-issue", APEX_HOST),
    ).toBe(null);
  });

  it("12. absolute same-registrable-domain HTTP (no HTTPS) → null", () => {
    // Cleartext protocol downgrade vector — never honored, incluso si el
    // host matchea y el path está en allowlist.
    expect(
      validateLoginReturnTo("http://place.community/api/auth/sso-issue", APEX_HOST),
    ).toBe(null);
  });
});
