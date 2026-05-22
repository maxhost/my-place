import { defineRouting } from "next-intl/routing";
import { rootDomain } from "@/shared/lib/root-domain";

// Decisión README §Decisiones 1: localePrefix 'always', default 'es', x-default → es.
//
// 6 locales operativos día uno (ADR-0022, ADR-0024 — 2026-05-20). Sólo `es.json`
// existe como catálogo denso en `messages/`; `de.json` se agrega en S1.a y
// `ca.json` en S1.b, ambos como copias de `es.json` (stubs hasta traducción
// real). `en/fr/pt` no tienen archivo físico — el deep-merge runtime en
// `request.ts` con try/catch defensivo degrada a `defaultLocale` para esos
// locales sin romper UX. El script `scripts/check-translations.mjs` (S1.b)
// reporta el drift de forma informativa, no fail-closed.
//
// Feature B S4a (ADR-0031, 2026-05-22) — cookie `NEXT_LOCALE` cross-subdomain:
// next-intl por default emite la cookie host-only, lo que rompe la persistencia
// de la preferencia de locale entre apex (`place.community`) y subdomain canon
// (`{slug}.place.community` / `app.place.community`): el visitor que elige `pt`
// en la landing y luego entra a un place ve fallback `es`. S4a setea
// `localeCookie.domain` = `.{rootHost}` derivado del helper canónico
// `rootDomain()` (única fuente de `NEXT_PUBLIC_APP_URL`) para que la cookie
// viaje cross-subdomain. Custom domains (Feature B S3) NO comparten cookie por
// design — están en origin distinto del root, y la cookie está acotada al
// scope de `.place.community`. En custom domain el locale viene de
// `place.default_locale` resuelto en el layout (ADR-0031 §Fuente 1).
//
// Dev local (`localhost:3000`): `localeCookieDomain()` retorna `undefined` —
// browsers no aceptan port en el atributo `Domain`, y dev no expone subdomains
// canónicos (multi-tenancy.md §Dev) más allá de `*.localhost`. La cookie queda
// host-only, comportamiento idéntico al pre-S4a (no regresión dev).
//
// `secure`: derivado del scheme del `NEXT_PUBLIC_APP_URL` para que dev `http`
// no quede con `Secure` (el browser rechazaría la cookie). Prod siempre
// `https://` → `secure: true`.

/**
 * Domain attribute para la cookie `NEXT_LOCALE`, derivado de
 * `NEXT_PUBLIC_APP_URL`. Retorna `undefined` cuando el host es localhost o
 * tiene puerto explícito (browsers rechazan `Domain` con port; dev no
 * necesita cross-subdomain).
 */
function localeCookieDomain(): string | undefined {
  const host = rootDomain();
  if (host === "localhost" || host.includes(":")) return undefined;
  return `.${host}`;
}

/**
 * `Secure` flag derivado del scheme. Prod `https://` → true; dev `http://` →
 * false (sino el browser rechaza). Fallback safe a `true` ante env inválida.
 */
function localeCookieSecure(): boolean {
  try {
    return (
      new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community")
        .protocol === "https:"
    );
  } catch {
    return true;
  }
}

const cookieDomain = localeCookieDomain();

export const routing = defineRouting({
  locales: ["es", "en", "fr", "pt", "de", "ca"],
  defaultLocale: "es",
  localePrefix: "always",
  // Accept-Language solo sugiere; el override manual (LangSwitcher) y la
  // cookie NEXT_LOCALE mandan. Sin redirect forzado por header.
  localeDetection: true,
  // Cookie cross-subdomain (Feature B S4a). `name` + `sameSite` re-declarados
  // explícitamente porque LocaleCookieConfig los requiere; mirror de los
  // defaults canónicos de next-intl. `domain` se omite en localhost dev (key
  // ausente en lugar de `undefined` para no propagar el atributo al header).
  localeCookie: {
    name: "NEXT_LOCALE",
    sameSite: "lax",
    path: "/",
    secure: localeCookieSecure(),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  },
});

export type Locale = (typeof routing.locales)[number];
