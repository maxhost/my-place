import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routing } from "@/i18n/routing";

// Phase 2.C.2 — branch coverage de `logoutAction`. El borde cross-system del
// SDK (`getAuth().signOut()`) y el host público (`rootDomain()`) se mockean:
// la action es orquestación pura (valida locale → best-effort signOut →
// arma la URL del apex localizada). El wiring vivo del SDK se verifica en
// smoke producción (cross-subdomain `*.place.community`), NO acá.
//
// Cubre: (a) locale válido → signOut invocado + URL correcta; (b) signOut
// lanza → best-effort, igual retorna redirectTo sin propagar; (c) locale
// inválido (open-redirect guard, Phase 1.B) → fallback a `routing.locales[0]`.

const signOut = vi.fn();

vi.mock("@/shared/lib/auth", () => ({
  getAuth: () => ({ signOut }),
}));

vi.mock("@/shared/lib/root-domain", () => ({
  rootDomain: () => "place.community",
}));

import { logoutAction } from "../logout-action";

beforeEach(() => {
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logoutAction — borde logout del hub (Phase 2.C.2)", () => {
  it("locale válido: invoca signOut y retorna la URL del apex localizada", async () => {
    const result = await logoutAction("en");

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ redirectTo: "https://place.community/en/" });
  });

  it("cada locale soportado produce su propia URL", async () => {
    for (const locale of routing.locales) {
      const result = await logoutAction(locale);
      expect(result.redirectTo).toBe(`https://place.community/${locale}/`);
    }
  });

  it("best-effort: si signOut lanza, NO propaga y igual retorna redirectTo", async () => {
    signOut.mockRejectedValueOnce(new Error("SDK caído / red abajo"));

    const result = await logoutAction("es");

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ redirectTo: "https://place.community/es/" });
  });

  it("locale inválido (open-redirect guard): fallback al primer locale, sin doxxear el flag", async () => {
    const result = await logoutAction("../evil.com");

    // El signOut igual corre (logout es incondicional); sólo el segmento de
    // URL se sanitiza al locale default canónico.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      redirectTo: `https://place.community/${routing.locales[0]}/`,
    });
  });

  it("locale inválido: variantes de inyección colapsan todas al fallback", async () => {
    for (const bad of ["", "EN", "es-AR", "\\\\evil.com", "x".repeat(50)]) {
      const result = await logoutAction(bad);
      expect(result.redirectTo).toBe(
        `https://place.community/${routing.locales[0]}/`,
      );
    }
  });
});
