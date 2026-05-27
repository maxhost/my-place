import { describe, expect, it } from "vitest";

import { resolvePostCredentialDestination } from "../post-credential-destination";

// V1.2 Sesión D.1 (ADR-0046 §"Addendum operacional — Sesión D"). Helper PURE
// + tests TDD canon. Cobertura: 6 tests sobre las 3 ramas de prioridad
// (postCredentialUrl > returnTo > hubFallback) + las semánticas de null y
// undefined que ambos callers (AccessFlow.onSuccess client + /login page
// guard server) tienen que respetar para consistencia. El helper es PURE:
// sin I/O, sin env lookup — testeable sin mocks ni stubs.

const HUB = "https://app.place.community/es/";
const RETURN_TO = "https://app.place.community/es/destino-validado";
const POST_CRED =
  "https://nocodecompany.co/api/auth/sso-init?returnTo=%2Finvite%2Fabc";

describe("resolvePostCredentialDestination — prioridad postCredentialUrl > returnTo > hubFallback", () => {
  it("prioriza inviteContext.postCredentialUrl cuando los 3 están presentes", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: { postCredentialUrl: POST_CRED },
        returnTo: RETURN_TO,
        hubFallback: HUB,
      }),
    ).toBe(POST_CRED);
  });

  it("prioriza inviteContext.postCredentialUrl aún cuando returnTo es null (validateLoginReturnTo lo rechazó)", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: { postCredentialUrl: POST_CRED },
        returnTo: null,
        hubFallback: HUB,
      }),
    ).toBe(POST_CRED);
  });

  it("cae a returnTo cuando inviteContext es undefined", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: undefined,
        returnTo: RETURN_TO,
        hubFallback: HUB,
      }),
    ).toBe(RETURN_TO);
  });

  it("cae a returnTo cuando inviteContext es null (paridad con undefined)", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: null,
        returnTo: RETURN_TO,
        hubFallback: HUB,
      }),
    ).toBe(RETURN_TO);
  });

  it("cae a hubFallback cuando inviteContext y returnTo son undefined (signup landing / login directo, backwards-compat pre-V1.1)", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: undefined,
        returnTo: undefined,
        hubFallback: HUB,
      }),
    ).toBe(HUB);
  });

  it("cae a hubFallback cuando inviteContext es null y returnTo es null (paridad full null)", () => {
    expect(
      resolvePostCredentialDestination({
        inviteContext: null,
        returnTo: null,
        hubFallback: HUB,
      }),
    ).toBe(HUB);
  });
});
