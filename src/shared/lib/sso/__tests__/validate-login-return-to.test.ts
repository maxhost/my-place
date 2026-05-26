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

// V1.1 S2 (Feature E invite accept flow) — extensión del allowlist canónico
// ADR-0033 para aceptar `/invite/[token]` (relative + absolute same-registrable).
//
// Pattern: `^/invite/[a-f0-9]{32,256}$` (32 chars mínimo = entropía razonable,
// 256 max = defense vs payload abuse, hex-only = mismatch con tokens reales
// generados por `crypto.randomBytes(32).toString('hex')` = 64 hex). Sin
// query/hash permitido en el path: la page no las consume y rechazarlas cierra
// vectores de scheme injection extra (`/invite/{valid}?next=https://evil`).
//
// El handler V1 ya acepta CUALQUIER relative path con `/` (no `//` no `://`),
// así que para los `/invite/...` malformados tenemos que hacer la regla MÁS
// ESTRICTA (rechazar lo que V1 aceptaba sin filtro). Tests #2-#4 son RED
// genuinos en V1 (passes hoy, deben fallar post-S2 sin pasar el regex). Test
// #5 también RED (URLs absolutas same-registrable hoy sólo aceptan paths del
// allowlist `/api/auth/sso-issue|sso-init` — `/invite/{token}` se rechaza
// pre-S2). Tests #1 y #6 son regression-positive (mismo comportamiento V1+S2).

const VALID_TOKEN_64 = "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd";
const VALID_TOKEN_32 = "a1b2c3d4e5f6789012345678901234ab";

describe("S2 validateLoginReturnTo — relative `/invite/[token]` pattern", () => {
  it("13. relative `/invite/{64-hex}` (token real prod) → accepted", () => {
    const path = `/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(path, APEX_HOST)).toBe(path);
  });

  it("13b. relative `/invite/{32-hex}` (token min entropy) → accepted", () => {
    const path = `/invite/${VALID_TOKEN_32}`;
    expect(validateLoginReturnTo(path, APEX_HOST)).toBe(path);
  });

  it("14. relative `/invite/{non-hex}` (caracteres inválidos) → null", () => {
    // 64 chars que parecen hex pero contienen `z` (out of [a-f0-9]).
    const badPath = `/invite/zzz0123456789012345678901234567890123456789012345678901234567`;
    expect(validateLoginReturnTo(badPath, APEX_HOST)).toBe(null);
    // Uppercase hex también rechazado (DEFINER + crypto.randomBytes emiten
    // lowercase; ser estricto cierra ambigüedad por normalización).
    const upperPath = `/invite/A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD`;
    expect(validateLoginReturnTo(upperPath, APEX_HOST)).toBe(null);
  });

  it("15. relative `/invite/{token < 32 chars}` → null", () => {
    expect(validateLoginReturnTo("/invite/abc", APEX_HOST)).toBe(null);
    // 31 chars (1 below floor).
    const short = `/invite/${"a".repeat(31)}`;
    expect(validateLoginReturnTo(short, APEX_HOST)).toBe(null);
  });

  it("16. relative `/invite/{token > 256 chars}` → null", () => {
    // 257 chars (1 above ceiling).
    const long = `/invite/${"a".repeat(257)}`;
    expect(validateLoginReturnTo(long, APEX_HOST)).toBe(null);
  });
});

describe("S2 validateLoginReturnTo — absolute `/invite/[token]` URLs", () => {
  it("17. absolute same-registrable-domain con `/invite/{valid hex}` → accepted", () => {
    // Subdomain del apex (subdomain del place, ej. `mi-place.place.community`)
    // emite la URL absoluta — same-registrable-domain check pasa.
    const url = `https://mi-place.place.community/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(url);
  });

  it("17b. absolute apex bare con `/invite/{valid hex}` → accepted", () => {
    // Defense edge: si la URL viene con `place.community` plain (sin sub).
    const url = `https://place.community/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(url);
  });

  it("18. absolute cross-registrable-domain con `/invite/{valid}` → null", () => {
    // Open-redirect vector clásico — attacker.com tiene path válido `/invite/{hex}`
    // pero domain no matchea → rechazar (same-registrable check vigente).
    const url = `https://attacker.com/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(null);
    // Lookalike: domain con apex como sub-label (defense vs registrable substring).
    const lookalike = `https://place.community.evil.com/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(lookalike, APEX_HOST)).toBe(null);
  });

  it("18b. absolute same-registrable con `/invite/{invalid token}` → null", () => {
    // Path `/invite/...` malformado bloqueado incluso si la URL es absoluta
    // same-registrable (no se "salva" por estar absolute).
    const url = `https://mi-place.place.community/invite/abc`;
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(null);
  });

  it("18c. absolute same-registrable con `/invite/{valid}` HTTP → null", () => {
    // Cleartext downgrade vector vigente — incluso con path válido.
    const url = `http://mi-place.place.community/invite/${VALID_TOKEN_64}`;
    expect(validateLoginReturnTo(url, APEX_HOST)).toBe(null);
  });
});
