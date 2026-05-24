// Feature C · S11.3.B · validate-login-return-to: helper PURE que decide si
// una URL `?returnTo` recibida por la página apex `/[locale]/login` es safe
// de honrar tras autenticación. Canon V1: ADR-0033.
//
// Sin `next/headers`, sin fetches, sin SDK, sin DB — testeable directo con
// vitest, single owner Maxi sequential (código de seguridad).
//
// ## Policy V1 (intersección de reglas validadas vs precedent + best practice)
//
//   1. **ABSOLUTE URLs**: deben matchear (a) https + (b) same-registrable-
//      domain como el apex (`place.community`). Allowlist explícito del path:
//      `/api/auth/sso-issue` O `/api/auth/sso-init` ÚNICAMENTE (cualquier
//      otro path absoluto same-registrable-domain → `null`). El único
//      consumer V1 confirmado es Feature C SSO que emite estos dos paths
//      desde `redirectToApexLogin` (ver `src/app/api/auth/sso-issue/route.ts:145-153`).
//
//   2. **RELATIVE PATHs**: aceptados si empiezan con `/` + no contienen `//`
//      (protocol-relative) + no contienen scheme (`:` antes del primer `/`).
//      El path retorna preservado. Permite reusar el componente login para
//      futuros flows account-first internos del apex sin tocar este helper
//      (relative path aterriza en el apex mismo, same-origin del login,
//      sin vector cross-domain).
//
//   3. **Cualquier otro input** (null, undefined, empty, whitespace,
//      scheme-relative, attacker domain absoluto, paths con scheme injection,
//      etc.) → `null` (caller usa fallback Hub canónico).
//
// ## Por qué allowlist explícito y no allowlist abierto
//
// Defense in depth: el único consumer V1 confirmado es Feature C SSO. Si V2
// agrega nuevos paths (e.g. `/api/auth/oauth-callback`), DEBE pasar por ADR
// explícita + actualización del helper + test nuevo. Cost-of-mistake
// asimétrico: open-redirect = phishing vector severo, mientras que rechazar
// un path legítimo no-allowlisted = 1 line code change. Ampliar es trivial,
// retraerse post-leak es imposible (URLs malicious ya circulan).
//
// ## Precedent same-registrable-domain
//
// `src/shared/lib/sso/sso-jwks-fetcher.ts` (S11.1) usa
// `isSameRegistrableDomain` para la redirect policy del fetch JWKS — el
// mismo principio "registrable domain matching como invariante de
// intra-Place trust" se extiende co-localizado en este sub-módulo sin
// duplicar lógica (re-uso de la heurística two-label-root naive, suficiente
// para gTLDs `place.community`).

/** Paths absolutos canonicos del flow Feature C SSO. Ampliar requiere ADR. */
const ABSOLUTE_PATH_ALLOWLIST = new Set<string>([
  "/api/auth/sso-issue",
  "/api/auth/sso-init",
]);

/**
 * Same-registrable-domain check naive (last-two-labels), mismo principio que
 * `sso-jwks-fetcher.ts`. Suficiente para gTLDs (`place.community` two-label).
 * NO maneja ccTLDs multi-label (ej. `*.co.uk`): los trataría como single
 * registrable. Place no deploya bajo ccTLDs multi-label (verificado
 * 2026-05-23: apex `place.community` es gTLD); si en el futuro se requiere,
 * extender helper compartido con sso-jwks-fetcher sin tocar consumers.
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
 * Decide si `raw` (search param `returnTo` del login apex) es safe de honrar
 * tras autenticación.
 *
 * @param raw       Input bruto del search param (`searchParams.returnTo`).
 *                  Acepta `null`/`undefined` directamente del unwrap.
 * @param apexHost  Host del apex (`place.community` en prod, `localhost:3000`
 *                  en dev). Usado para `isSameRegistrableDomain` en absolute
 *                  URLs.
 * @returns         La URL/path sanitizado si valid, o `null` si caller debe
 *                  usar fallback (Hub canónico).
 */
export function validateLoginReturnTo(
  raw: string | null | undefined,
  apexHost: string,
): string | null {
  // Fast paths: null/undefined/empty/whitespace-only → fallback inmediato.
  if (typeof raw !== "string") return null;
  if (raw.length === 0) return null;
  if (raw.trim().length === 0) return null;

  // Branch 1: relative path (empieza con `/`, pero NO `//`).
  if (raw.startsWith("/")) {
    // Protocol-relative (`//attacker.com/...`): vector clásico open-redirect.
    if (raw.startsWith("//")) return null;
    // Scheme injection embedded en path (`/redirect?to=https://...` o similar):
    // bloqueamos defensivamente cualquier `://` en el path relativo.
    if (raw.includes("://")) return null;
    return raw;
  }

  // Branch 2: absolute URL — parse + valida shape via WHATWG URL.
  // URL constructor throws para inputs malformados o scheme-relative no-URL
  // (`javascript:`, `data:`, `mailto:`); ese throw lo capturamos como `null`.
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  // 2a. HTTPS-only (no HTTP cleartext, no `javascript:`, no `data:`).
  if (parsed.protocol !== "https:") return null;

  // 2b. Same-registrable-domain check vs apex.
  if (!isSameRegistrableDomain(apexHost, parsed.host)) return null;

  // 2c. Path debe matchear EXACTAMENTE un entry del allowlist (no substring,
  // no startsWith con `/foo` que también pasaría como prefix de `/foo/bar`).
  if (!ABSOLUTE_PATH_ALLOWLIST.has(parsed.pathname)) return null;

  // Match: preservar la URL completa tal cual llegó (incluye search + hash).
  return raw;
}
