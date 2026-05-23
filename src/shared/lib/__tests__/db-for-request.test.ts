import { describe, expect, it } from "vitest";

import {
  type AuthBranchDecision,
  decideAuthBranch,
} from "@/shared/lib/db-for-request-decision";
import type { HostZone } from "@/shared/lib/host-routing";
import { LOCAL_SESSION_COOKIE_NAME } from "@/shared/lib/sso";

// Feature C · S11.2.A · `decideAuthBranch` — unit tests del helper PURO.
//
// Esta es la PARTE testeable de `db-for-request.ts`. El integrador
// `getAuthenticatedDbForRequest` cruza `next/headers` + Neon Auth SDK + DB
// real, y por convención seam-split de este codebase (ver canon en
// `update-default-locale.ts` línea 13) NO se vitest'ea — su correctitud es
// tipo/build + smoke production (S11.2.C).
//
// El helper decide qué BRANCH de auth aplica el caller, en función de la
// `HostZone` del request + presencia/ausencia de cookie host-only SSO. Es
// la pieza que cierra el bug T1.2 descubierto en smoke production
// 2026-05-23: 4 functions sirviendo `/settings` desde custom domain leían
// solo Neon Auth cookie, fallando en el host donde esa cookie no existe
// por RFC 6265.

/** Mock de `cookieJar` estructural — `.get()` retorna `{value} | undefined`. */
function makeJar(
  entries: Record<string, string | undefined>,
): {
  get: (name: string) => { value: string } | undefined;
} {
  return {
    get: (name: string) => {
      const v = entries[name];
      return v === undefined ? undefined : { value: v };
    },
  };
}

const PLACE_ZONE: HostZone = { zone: "place", slug: "mi-place" };
const MARKETING_ZONE: HostZone = { zone: "marketing" };
const INBOX_ZONE: HostZone = { zone: "inbox" };
const CUSTOM_DOMAIN_ZONE: HostZone = {
  zone: "custom-domain",
  placeId: "p_123",
  slug: "mi-place",
  defaultLocale: "es",
};

describe("decideAuthBranch", () => {
  it("custom-domain + cookie presente → sso-local con token + expectedHost", () => {
    const jar = makeJar({ [LOCAL_SESSION_COOKIE_NAME]: "fake.jwt.token" });
    const decision = decideAuthBranch(
      CUSTOM_DOMAIN_ZONE,
      jar,
      "nocodecompany.co",
    );
    expect(decision).toStrictEqual<AuthBranchDecision>({
      kind: "sso-local",
      token: "fake.jwt.token",
      expectedHost: "nocodecompany.co",
    });
  });

  it("custom-domain + cookie ausente → no-session", () => {
    const jar = makeJar({});
    const decision = decideAuthBranch(
      CUSTOM_DOMAIN_ZONE,
      jar,
      "nocodecompany.co",
    );
    expect(decision).toStrictEqual<AuthBranchDecision>({ kind: "no-session" });
  });

  it("custom-domain + cookie con value vacío → no-session", () => {
    const jar = makeJar({ [LOCAL_SESSION_COOKIE_NAME]: "" });
    const decision = decideAuthBranch(
      CUSTOM_DOMAIN_ZONE,
      jar,
      "nocodecompany.co",
    );
    expect(decision).toStrictEqual<AuthBranchDecision>({ kind: "no-session" });
  });

  it("zone=place → neon-auth-needed (cookie no relevante)", () => {
    const jar = makeJar({ [LOCAL_SESSION_COOKIE_NAME]: "irrelevante" });
    const decision = decideAuthBranch(PLACE_ZONE, jar, "mi-place.place.community");
    expect(decision).toStrictEqual<AuthBranchDecision>({
      kind: "neon-auth-needed",
    });
  });

  it("zone=marketing → neon-auth-needed", () => {
    const jar = makeJar({});
    const decision = decideAuthBranch(MARKETING_ZONE, jar, "place.community");
    expect(decision).toStrictEqual<AuthBranchDecision>({
      kind: "neon-auth-needed",
    });
  });

  it("zone=inbox → neon-auth-needed", () => {
    const jar = makeJar({});
    const decision = decideAuthBranch(INBOX_ZONE, jar, "app.place.community");
    expect(decision).toStrictEqual<AuthBranchDecision>({
      kind: "neon-auth-needed",
    });
  });

  it("custom-domain lee EXACTAMENTE la cookie `__Host-place_sso_session` (no otra)", () => {
    // Cualquier otra cookie no debe ser interpretada como sesión SSO. Test
    // anti-drift: si alguien renombra la constante, el test falla loud.
    const jar = makeJar({
      "place_sso_session": "sin-prefix",
      "__Secure-place_sso_session": "prefix-incorrecto",
      "__Host-otra_cookie": "nombre-completo-incorrecto",
    });
    const decision = decideAuthBranch(
      CUSTOM_DOMAIN_ZONE,
      jar,
      "nocodecompany.co",
    );
    expect(decision).toStrictEqual<AuthBranchDecision>({ kind: "no-session" });
  });

  it("custom-domain propaga expectedHost verbatim (case sensitivity preservada)", () => {
    // El normalizing (lowercase, trim de puerto) es responsabilidad del
    // caller (`getAuthenticatedDbForRequest`); el helper puro NO modifica
    // el host — lo pasa tal cual al `expectedHost` del verifier para que
    // `verifyLocalSession` haga el check exacto contra el host claim.
    const jar = makeJar({ [LOCAL_SESSION_COOKIE_NAME]: "tok" });
    const decision = decideAuthBranch(CUSTOM_DOMAIN_ZONE, jar, "NoCodeCo.Co");
    expect(decision).toStrictEqual<AuthBranchDecision>({
      kind: "sso-local",
      token: "tok",
      expectedHost: "NoCodeCo.Co",
    });
  });
});
