// Feature C · S11.1 · sso-jwks-fetcher: `customFetch` para el JWKS remoto
// del apex. Restaura la capacidad de seguir redirects que jose v6 deshabilita
// por defecto (`redirect: 'manual'` hardcoded en `dist/webapi/jwks/remote.js`
// línea 19), preservando defense-in-depth: only same-registrable-domain +
// https + ≤3 hops. Cualquier otra cosa → throw `SsoJwksRedirectError`, que
// el pipeline del redeem mapea a `signature_invalid` (correcto: cualquier
// redirect anómalo del JWKS = "no pudimos establecer trust con el apex").
//
// Motivación (smoke production T1.1, 2026-05-23):
// El JWKS del apex `https://place.community/api/auth/sso-jwks` responde
// HTTP 307 → `https://www.place.community/api/auth/sso-jwks` por
// configuración Vercel platform-level apex→www. jose default fetch lo ve
// como respuesta inválida (no es 200) y throws — el redeem aterriza en
// `sso_error=signature_invalid` aunque la firma del ticket sea
// matemáticamente correcta. Verificado empíricamente con `verify-ticket.mjs`:
// mismo ticket contra apex → fail, contra www → pass. Diagnóstico completo
// en `docs/gotchas/jose-jwks-redirect-manual.md`.
//
// Por qué `customFetch` y no otras 8 opciones evaluadas:
//   - A. cambiar `NEXT_PUBLIC_APP_URL` a www: alta blast radius
//     (`rootDomain()` lo usa para cookie scoping cross-subdomain, rompería
//     Feature B).
//   - B. hardcode `www.place.community` en JWKS URL: frágil, rompe dev y
//     ata el código al deploy actual.
//   - C. follow simple sin validar target: pierde la defensa anti-hijack
//     que jose puso por buena razón (atacante en path del DNS podría
//     redirigir JWKS a un endpoint con su public key → tickets forjados
//     verificarían).
//   - D (esta): follow CON allowlist same-registrable. Restaura
//     funcionalidad sin perder la defensa. Production-grade.
//   - E. deshabilitar redirect Vercel apex→www: pierde SEO + impacto fuera
//     del scope SSO.
//   - F, G, H, I: descartadas por fragilidad / complica rotation.
//
// Decisión documentada en ADR-0032 addendum 2026-05-23 §"Same-registrable-
// domain redirect policy".

export type SsoJwksRedirectErrorCode =
  | "protocol_downgrade"
  | "cross_registrable_domain"
  | "too_many_redirects";

/**
 * Throw cuando un redirect del JWKS apex no cumple la policy
 * (same-registrable-domain + https + ≤maxRedirects hops). El pipeline del
 * redeem captura cualquier throw del JWKS fetch como `signature_invalid`
 * (defense-in-depth: no leak de qué falló al cliente).
 */
export class SsoJwksRedirectError extends Error {
  constructor(public readonly code: SsoJwksRedirectErrorCode) {
    super(`SSO JWKS redirect refused: ${code}`);
    this.name = "SsoJwksRedirectError";
  }
}

export type SafeRedirectFollowingFetchOptions = {
  /**
   * Máximo de redirects a seguir. Default 3 (Vercel apex→www es 1 hop;
   * +2 de buffer para casos benignos sin riesgo de loop). Cualquier valor
   * arriba indica config error → vale más rechazar que seguir.
   */
  readonly maxRedirects?: number;
};

const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Status codes 3xx que indican redirect con Location header. 304 NO está —
 * es `Not Modified`, semánticamente distinto y nunca emitido por un JWKS
 * fetch (no enviamos `If-None-Match`).
 */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Same-registrable-domain check naive (last-two-labels). Suficiente para
 * gTLDs (`place.community`, `nocodecompany.co`). NO maneja ccTLDs con
 * sufijo público multi-label (ej. `*.co.uk`, `*.com.ar`) — los trataría
 * como single registrable. Place no deploya bajo esas TLDs (verificado
 * 2026-05-23: apex `place.community` es gTLD). Si en el futuro se agrega
 * un custom domain bajo ccTLD multi-label, este helper acepta cambios sin
 * tocar consumers — la API pública es estable.
 */
function getTwoLabelRoot(host: string): string | null {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
}

function isSameRegistrableDomain(originHost: string, targetHost: string): boolean {
  const oh = originHost.toLowerCase();
  const th = targetHost.toLowerCase();
  if (oh === th) return true;
  const originRoot = getTwoLabelRoot(oh);
  if (!originRoot) return false;
  return th === originRoot || th.endsWith(`.${originRoot}`);
}

/**
 * Factory de un fetch-shaped function compatible con el `customFetch`
 * Symbol option de jose v6 `createRemoteJWKSet`. Sigue redirects bajo la
 * policy descrita en el header del archivo.
 *
 * Contract con jose:
 *   - Recibe `(url, init)` donde `init.method='GET'`, `init.signal` es un
 *     `AbortSignal.timeout(...)`, `init.headers` un Record, `init.redirect`
 *     siempre `'manual'`.
 *   - Retorna un `Response` para que jose lea `.json()` con el JWK Set.
 *   - Si tira, jose envuelve en `JOSEError` → el redeem captura como
 *     `signature_invalid`.
 *
 * Invariante: en cada hop forzamos `redirect: 'manual'` aunque el caller
 * no lo pase — la defensa contra browser auto-follow es nuestra, no del
 * caller (jose siempre lo pasa, pero protegemos contra futuros consumers).
 */
export function makeSafeRedirectFollowingFetch(
  opts?: SafeRedirectFollowingFetchOptions,
): typeof fetch {
  const maxRedirects = opts?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const initialUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const originHost = new URL(initialUrl).host;

    let currentUrl = initialUrl;
    // hops cuenta SÓLO los follow requests adicionales (el initial no
    // cuenta). Con maxRedirects=3 toleramos 1 initial + 3 follows = 4 total.
    for (let hops = 0; hops <= maxRedirects; hops++) {
      const res = await fetch(currentUrl, {
        ...init,
        redirect: "manual",
      });

      if (!REDIRECT_STATUSES.has(res.status)) {
        return res;
      }

      const location = res.headers.get("location");
      if (!location) {
        // 3xx sin Location: malformado. Retornamos para que jose decida
        // (típicamente throws con "Expected 200 OK").
        return res;
      }

      const target = new URL(location, currentUrl);

      if (target.protocol !== "https:") {
        throw new SsoJwksRedirectError("protocol_downgrade");
      }

      if (!isSameRegistrableDomain(originHost, target.host)) {
        throw new SsoJwksRedirectError("cross_registrable_domain");
      }

      currentUrl = target.toString();
    }

    throw new SsoJwksRedirectError("too_many_redirects");
  }) as typeof fetch;
}
