import { describe, expect, it } from "vitest";

import { resolvePlaceNotFoundContext } from "../place-not-found-context";

// Tests del helper puro que orquesta el render del 404 de la zona-place
// (Feature B S4e, ADR-0031 §"Bug 2 — host-aware 404"). Aísla la lógica del
// componente Server (que consume `headers()` + `getTranslations`) para
// dejarla unit-testeable sin mockear next/server.
//
// Contrato:
//   - Recibe el `HostZone` resuelto + el locale fallback del slug (puede ser
//     null) + el locale canónico del routing.
//   - Retorna `{locale, homeHref, ctaKey}` listos para que el componente
//     llame `getTranslations({locale, ...})` y renderee.
//
// Casos de borde clave:
//   1. Custom-domain: el lookup S1 ya trae `defaultLocale` — usar ese; link
//      relativo `/` (no doxxear el slug interno al visitor que conoce solo el
//      custom-domain).
//   2. Subdomain canon (zone === "place"): visitor anónimo, pero el lookup
//      S4b puede haber resuelto el locale del owner — usarlo si está, sino
//      caer al canónico. Link relativo `/` (volver a la home placeholder del
//      mismo place).
//   3. Defensive marketing/inbox: no debería rutear acá (estamos en árbol
//      `/place/[placeSlug]/`), pero si alguien fuerza el path → fallback
//      canónico + link absoluto al apex marketing.

describe("resolvePlaceNotFoundContext", () => {
  describe("custom-domain", () => {
    it("usa el defaultLocale del hostZone (lookup S1) y link relativo", () => {
      const ctx = resolvePlaceNotFoundContext({
        hostZone: {
          zone: "custom-domain",
          placeId: "pl_abc",
          slug: "mi-place",
          defaultLocale: "pt",
        },
        slugLocaleFallback: null,
        canonicalDefaultLocale: "es",
      });

      expect(ctx.locale).toBe("pt");
      expect(ctx.homeHref).toBe("/");
      expect(ctx.ctaKey).toBe("ctaHome");
    });

    it("ignora el slugLocaleFallback aunque venga (precedence hostZone)", () => {
      // En custom-domain, hostZone.defaultLocale es la fuente autoritativa
      // (viene del lookup S1 que ya filtró `archived_at IS NULL`). No tiene
      // sentido caer al slugLocaleFallback aunque el caller lo provea por
      // simetría con la zona-place.
      const ctx = resolvePlaceNotFoundContext({
        hostZone: {
          zone: "custom-domain",
          placeId: "pl_abc",
          slug: "mi-place",
          defaultLocale: "fr",
        },
        slugLocaleFallback: "de",
        canonicalDefaultLocale: "es",
      });

      expect(ctx.locale).toBe("fr");
    });
  });

  describe("subdomain canon (zone === place)", () => {
    it("usa el slugLocaleFallback cuando está disponible", () => {
      const ctx = resolvePlaceNotFoundContext({
        hostZone: { zone: "place", slug: "mi-place" },
        slugLocaleFallback: "ca",
        canonicalDefaultLocale: "es",
      });

      expect(ctx.locale).toBe("ca");
      expect(ctx.homeHref).toBe("/");
      expect(ctx.ctaKey).toBe("ctaHome");
    });

    it("cae al canonicalDefaultLocale cuando slugLocaleFallback es null", () => {
      // El lookup S4b retorna null cuando: slug no existe en DB, place
      // archivado, query DB falló (fail-safe), locale fuera del enum (drift
      // TS↔DB). En cualquiera de esos casos el 404 muestra copy en el default
      // canónico — UX coherente con el layout (precedence 4).
      const ctx = resolvePlaceNotFoundContext({
        hostZone: { zone: "place", slug: "slug-archivado" },
        slugLocaleFallback: null,
        canonicalDefaultLocale: "es",
      });

      expect(ctx.locale).toBe("es");
      expect(ctx.homeHref).toBe("/");
      expect(ctx.ctaKey).toBe("ctaHome");
    });
  });

  describe("marketing fallback (defensive)", () => {
    it("zone marketing → canonicalDefaultLocale + apex link absoluto", () => {
      // Defense-in-depth: el árbol `(app)/place/[placeSlug]/not-found.tsx`
      // NO debería ejecutarse desde apex o inbox (cada zona tiene su propio
      // not-found.tsx). Pero si algún edge case lo dispara, el fallback es
      // razonable: locale default + link al apex marketing.
      const ctx = resolvePlaceNotFoundContext({
        hostZone: { zone: "marketing" },
        slugLocaleFallback: null,
        canonicalDefaultLocale: "es",
      });

      expect(ctx.locale).toBe("es");
      expect(ctx.homeHref).toBe("https://place.community");
      expect(ctx.ctaKey).toBe("ctaApex");
    });

    it("zone inbox → mismo fallback que marketing", () => {
      const ctx = resolvePlaceNotFoundContext({
        hostZone: { zone: "inbox" },
        slugLocaleFallback: "pt",
        canonicalDefaultLocale: "en",
      });

      expect(ctx.locale).toBe("en");
      expect(ctx.homeHref).toBe("https://place.community");
      expect(ctx.ctaKey).toBe("ctaApex");
    });
  });

  describe("homeHref de marketing override", () => {
    it("respeta el apexMarketingUrl pasado (NEXT_PUBLIC_APP_URL en runtime)", () => {
      // El componente Server pasa el valor de `NEXT_PUBLIC_APP_URL` para que
      // el helper no dependa de `process.env` (puro). Default sigue siendo
      // `https://place.community` cuando el caller no lo provee.
      const ctx = resolvePlaceNotFoundContext({
        hostZone: { zone: "marketing" },
        slugLocaleFallback: null,
        canonicalDefaultLocale: "es",
        apexMarketingUrl: "https://staging.place.community",
      });

      expect(ctx.homeHref).toBe("https://staging.place.community");
    });
  });
});
