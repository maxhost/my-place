import { lookupCustomDomainBySlug } from "@/shared/lib/custom-domain-by-slug-lookup";
import { rootDomain } from "@/shared/lib/root-domain";

// Feature B — custom-domain-routing V1 · S4c (ADR-0031 §"Bug pre-existente"
// + §"Auth gate UX", 2026-05-22).
//
// Helpers PUROS para construir URLs absolutas de auth cross-subdomain. Vive
// en `shared/lib/` porque es transversal: lo consumen las pages owner-only
// del settings (`(app)/place/[placeSlug]/settings/*`, S4c) cuando ausencia
// de sesión requiere redirect al login, y el auth-gate del slice
// `custom-domain-routing` (S4d) cuando el visitor en custom domain pide
// volver a su subdomain canónico.
//
// ## El "Bug pre-existente" que cierra `buildApexLoginUrl`
//
// Pre-S4c, `settings/page.tsx:76` y `settings/domain/page.tsx:81`
// hardcodean `redirect("https://place.community/es/login")`:
//   1. Locale fijo `es` aunque el owner configuró 'pt' / 'fr' / etc.
//      → Tras logout, el owner aterriza en login en idioma equivocado.
//   2. Apex `place.community` hardcoded, no derivado de
//      `NEXT_PUBLIC_APP_URL` → dev local (`http://localhost:3000`) rompe
//      el redirect cross-subdomain (caería a "place.community" en dev).
// `buildApexLoginUrl` resuelve ambos: locale es param del caller (que
// puede resolverlo vía `place.default_locale` cuando hay sesión o
// `lookupPlaceLocaleBySlug` S4b cuando no), host se deriva de
// `rootDomain()` (mismo helper canónico que el resto de URLs apex).
//
// ## Por qué APEX y no subdomain canon para el login
//
// El route `/login` vive ÚNICAMENTE en `src/app/(marketing)/[locale]/login/
// page.tsx` (apex marketing). El árbol `(app)/place/[placeSlug]/` NO tiene
// login propio — y no debería: la cookie Neon Auth es `Domain=
// .place.community` (S4a), así que un login en apex propaga sesión a TODOS
// los subdominios canon. Si V2 algún día introduce login dedicado por place
// (e.g. OIDC), este helper es el único punto que cambia.
//
// ## `buildSubdomainCanonicalUrl` — destino del auth-gate (S4d)
//
// El visitor owner en custom-domain (`nocodecompany.co/settings`) ve el
// auth-gate (S4d) con copy "Para administrar **{slug}** entrá en su URL
// original" + botón cuya `href` es `buildSubdomainCanonicalUrl({slug,
// path: returnPath})`. Aterriza en el subdomain canon donde la cookie
// `.place.community` sí está scopeada — el flow de sesión natural reanuda
// (settings page detecta sesión presente → render normal; sesión ausente →
// `buildApexLoginUrl` → login apex).

// Enum canon de los 6 locales operativos (ADR-0024 + CHECK constraint
// `place_default_locale_check`). Paridad explícita con el wrapper TS S4b
// y el `routing.ts` (next-intl). El día que se agregue uno, se actualiza
// acá Y en los otros tres lugares — el test `paridad: cada uno de los 6`
// recuerda la lista.
const APP_LOCALES = ["es", "en", "fr", "pt", "de", "ca"] as const;
type AppLocale = (typeof APP_LOCALES)[number];

function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

/**
 * Scheme (`http` o `https`) derivado del `NEXT_PUBLIC_APP_URL`. Permite que
 * dev local (`http://localhost:3000`) emita URLs con `http://` y prod
 * (`https://place.community`) con `https://`. Fallback safe a `https` ante
 * env ausente o inválida.
 */
function apexScheme(): "http" | "https" {
  try {
    const url = new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "https://place.community",
    );
    return url.protocol === "http:" ? "http" : "https";
  } catch {
    return "https";
  }
}

/**
 * URL absoluta del login apex en el locale del place.
 *
 * Caller pattern canónico cuando NO hay sesión (settings/page.tsx,
 * settings/domain/page.tsx):
 * ```ts
 * const fallbackLocale = await getPlaceLocaleFallback(placeSlug);
 * redirect(buildApexLoginUrl({ defaultLocale: fallbackLocale }));
 * ```
 *
 * `defaultLocale` acepta `string | null | undefined` por ergonomía con
 * `lookupPlaceLocaleBySlug` (S4b §wrapper, que retorna `Promise<string |
 * null>`). Cualquier valor que NO sea uno de los 6 locales operativos
 * (incluyendo `null`, `undefined`, `""`, drift TS↔DB) cae a `'es'` — el
 * canon de `routing.defaultLocale`.
 */
export function buildApexLoginUrl(opts: {
  defaultLocale?: string | null;
}): string {
  const candidate = opts.defaultLocale ?? "";
  const locale: AppLocale = isAppLocale(candidate) ? candidate : "es";
  return `${apexScheme()}://${rootDomain()}/${locale}/login`;
}

/**
 * URL absoluta del subdomain canónico del place
 * (`{scheme}://{slug}.{rootDomain}{path}`). Lo consume el auth-gate del
 * custom-domain (S4d) como destino del botón "Volver a tu URL canónica".
 *
 * Normalizaciones (defense-in-depth):
 *   - `slug`: `trim().toLowerCase()`. El registro de slugs vía
 *     `app.create_place` ya normaliza en la app layer, pero el helper no
 *     depende de eso (mismo invariante que el wrapper S4b lookup
 *     case-insensitive).
 *   - `path`: si no empieza con '/', se prefija. `undefined` → '/'.
 *
 * Dev (`http://localhost:3000`): retorna `http://{slug}.localhost:3000{path}`
 * — `*.localhost` resuelve a 127.0.0.1 sin entrada `/etc/hosts` en browsers
 * modernos (multi-tenancy.md §Dev).
 */
export function buildSubdomainCanonicalUrl(opts: {
  slug: string;
  path?: string;
}): string {
  const slug = opts.slug.trim().toLowerCase();
  const rawPath = opts.path ?? "/";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  return `${apexScheme()}://${slug}.${rootDomain()}${path}`;
}

/**
 * URL absoluta canónica de un place — zone-aware. Resuelve a:
 *   - `https://{customDomain}{path}` si el place tiene un `place_domain`
 *     verificado y activo (vía `lookupCustomDomainBySlug` — migration 0022
 *     SECURITY DEFINER).
 *   - `https://{slug}.{rootDomain}{path}` (fallback al subdomain canon) si
 *     el place NO tiene custom domain configurado / verificado / activo, o
 *     si el lookup falla (timeout, drift, etc.).
 *
 * Feature E — Invite Accept Flow V1.2 · Sesión A (ADR-0046 §D1, 2026-05-26).
 * Cierra el gap UX detectado post-V1.1 close: el invite link emitido desde un
 * place con custom domain ahora coincide con el dominio que el owner publicita
 * públicamente (`nocodecompany.co/invite/{token}` vs el viejo
 * `mi-place.place.community/invite/{token}`). Para places sin custom domain,
 * el comportamiento es idéntico a `buildSubdomainCanonicalUrl` (zero regresión).
 *
 * **Memoización per-render**: la lookup interna (`lookupCustomDomainBySlug`)
 * está envuelta en `React.cache`. Múltiples invocaciones con el mismo slug
 * normalizado dentro del mismo render comparten una sola query Neon iad1.
 * El helper en sí NO está cacheado porque acepta argumentos object (object
 * identity defeats React.cache); la dedup real ocurre en el lookup primitivo.
 *
 * **Fail-safe**: errores del lookup (timeout, drift, RLS bypass roto) caen
 * a subdomain canon — el invite flow NUNCA emite URLs corruptas y NUNCA
 * crashea por error de DB. El subdomain canon es siempre válido si el slug
 * existe (gate de `isServiceableSlug` ya filtró antes de llegar acá).
 *
 * Caller pattern canónico (e.g. `invite/[token]/page.tsx`):
 * ```ts
 * const placeBaseUrl = (await buildPlaceCanonicalUrl({
 *   slug: placeSlug,
 *   path: "/",
 * })).replace(/\/$/, "");
 * const inviteUrl = `${placeBaseUrl}/invite/${token}`;
 * ```
 */
export async function buildPlaceCanonicalUrl(opts: {
  slug: string;
  path?: string;
}): Promise<string> {
  const customDomain = await lookupCustomDomainBySlug(opts.slug);
  if (customDomain !== null) {
    const rawPath = opts.path ?? "/";
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    return `${apexScheme()}://${customDomain}${path}`;
  }
  return buildSubdomainCanonicalUrl(opts);
}

/**
 * URL post-credential del flow invite — zone-aware con silent SSO embebido.
 * Espejo estructural de `buildPlaceCanonicalUrl` con la diferencia operativa
 * de emitir `sso-init` en el branch custom domain (Feature C, ADR-0032 §8):
 *
 *   - **Place CON custom domain verificado**: retorna
 *     `${scheme}://{customDomain}/api/auth/sso-init?returnTo=/invite/{token}`.
 *     El `sso-init` (S8) setea state cookie host-only en el custom domain,
 *     redirige a `sso-issue` apex (que consume la cookie Neon Auth fresca
 *     post-credential), redirige a `sso-redeem` custom domain, que mintea
 *     cookie local + aterriza al invitee en `/invite/{token}` con sesión.
 *
 *   - **Place SIN custom domain**: retorna
 *     `${scheme}://{slug}.{rootDomain}/invite/{token}` (subdomain canon).
 *     La cookie apex Neon Auth `.place.community` propaga al subdomain sin
 *     SSO necesario — la invite page detecta sesión inmediatamente.
 *
 * Feature E — Invite Accept Flow V1.2 · Sesión C (ADR-0046 §D4, 2026-05-26).
 * Cierra el gap UX del flow custom domain detectado en Sesión B: post-
 * credential el invitee aterrizaba en custom domain SIN sesión (cookie apex
 * NO propaga a custom domain por RFC 6265 §5.4) → veía el flow de "anónimo"
 * en lugar de poder aceptar directo. Con `sso-init` la sesión local se
 * mintea automático (~sub-segundo, 4 redirects HTTP).
 *
 * **Normalizaciones (defense-in-depth)**: `token.trim().toLowerCase()` —
 * paridad con `TOKEN_PATTERN` canon en `acceptInvitationSchema` +
 * `lookupInvitationPreview` + `INVITE_PATH_PATTERN`. El caller en
 * `/login/page.tsx` ya normaliza; re-aplicar acá cierra el risk de un
 * futuro caller que no lo haga.
 *
 * **Encoding**: el `returnTo` se serializa via `URLSearchParams` (slashes
 * `%2F`-encoded). El handler `sso-init` decodifica via `url.searchParams.get`
 * y pasa por `validateReturnTo` (que acepta cualquier path same-origin sin
 * `://`).
 *
 * **Fail-safe**: errores del lookup se propagan al caller (mismo contrato
 * que `buildPlaceCanonicalUrl`). El wrapper interno
 * `lookupCustomDomainBySlug` ya tiene su propio catch → null para errores
 * recoverables; un throw acá indica bug real en mock setup o infra crítica.
 */
export async function buildSsoInitUrlForInvite(opts: {
  slug: string;
  token: string;
}): Promise<string> {
  const token = opts.token.trim().toLowerCase();
  const customDomain = await lookupCustomDomainBySlug(opts.slug);
  if (customDomain !== null) {
    const url = new URL(`${apexScheme()}://${customDomain}/api/auth/sso-init`);
    url.searchParams.set("returnTo", `/invite/${token}`);
    return url.toString();
  }
  return buildSubdomainCanonicalUrl({
    slug: opts.slug,
    path: `/invite/${token}`,
  });
}
