// Gate de "este host NO puede ser custom domain de un place" para la feature
// custom-domain V1 (ADR-0026 · docs/features/custom-domain/). Módulo PURE sin
// deps externas: lo importa `validateCustomDomain` (Agent A del mismo S2) y la
// dependencia es unidireccional — por eso vive en `shared/lib/` standalone, no
// dentro de la feature.
//
// QUÉ bloquea:
//   1) Apex EXACTOS del propio sistema (e.g. `place.community`) — no se puede
//      reclamar el dominio principal del marketing como custom del place.
//   2) SUFFIXES de PaaS gratuitos (`.vercel.app`, `.netlify.app`, `.github.io`,
//      `.ngrok.io`) y del propio apex (`.place.community`) — un dominio
//      "regalado" por un proveedor no debe poder reclamarse como custom: el
//      owner real es el provider, no quien lo configura. Bloquear es seguro;
//      desbloquear casos legítimos es trivial si surgieran.
//   3) IP literals v4/v6 — un IP no es un dominio reclamable (no se puede
//      verificar TXT en una IP). El rechazo formal de "no es un dominio"
//      también lo hace `validateCustomDomain` por `invalid_format`, pero acá
//      lo tratamos como "reservado" para que ese caller pueda devolver un
//      `reserved_domain` cuando el input parsea como IP — defensa en
//      profundidad.
//
// POR QUÉ string-matching simple (no PSL): para V1 no necesitamos parsear
// dominios reales con Public Suffix List. La lista de PaaS gratuitos es corta,
// estática y conocida; agregarla a `RESERVED_DOMAIN_SUFFIXES` es trivial.
// El día que necesitemos PSL real (e.g. para anti-abuse fino) se introduce
// una dep externa y se documenta en una ADR aparte.

/**
 * Apex EXACTOS reservados — host completo, sin subdominio. Se chequean por
 * igualdad estricta (case-insensitive) contra el `domain` normalizado.
 */
export const RESERVED_DOMAINS: ReadonlyArray<string> = ["place.community"];

/**
 * Suffixes reservados — siempre con punto inicial (`.example.com`) para que el
 * match `endsWith` no acepte el apex desnudo (`example.com`) ni pegue contra
 * suffixes "pegados" sin separador (`fooexample.com`).
 */
export const RESERVED_DOMAIN_SUFFIXES: ReadonlyArray<string> = [
  ".place.community",
  ".vercel.app",
  ".netlify.app",
  ".github.io",
  ".ngrok.io",
];

// IPv4 estructural: 4 octetos decimales. La validez de rango (0–255 por
// octeto) se verifica aparte en `isIpv4Literal` — el regex solo asegura la
// forma "n.n.n.n".
const IPV4_SHAPE_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// IPv6 lax: cualquier cosa que parezca IPv6 (al menos un `:`, hex + `:`) o el
// prefijo IPv4-mapped (`::ffff:1.2.3.4`). No es validador RFC 4291 — para V1
// alcanza con "parece IPv6 → bloquear" (defensa en profundidad; la forma
// canónica de un custom domain es un nombre DNS, no una IP).
const IPV6_LAX_RE = /^(::ffff:)?[0-9a-f:.]+$/i;

/** ¿`domain` parsea como IPv4 literal con octetos válidos 0–255? */
function isIpv4Literal(domain: string): boolean {
  const match = IPV4_SHAPE_RE.exec(domain);
  if (!match) return false;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(match[i]);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return false;
  }
  return true;
}

/** ¿`domain` parece IPv6 literal? (criterio lax — bloquear es seguro). */
function isIpv6Literal(domain: string): boolean {
  if (!domain.includes(":")) return false;
  return IPV6_LAX_RE.test(domain);
}

/**
 * ¿`domain` está reservado y NO puede ser custom domain de un place?
 *
 * Normaliza (trim + lowercase) y chequea, en orden:
 *   1. Igualdad exacta contra `RESERVED_DOMAINS` (apex del sistema).
 *   2. `endsWith` contra `RESERVED_DOMAIN_SUFFIXES` (PaaS gratuitos + apex
 *      como suffix).
 *   3. IP literal v4 (con octetos válidos 0–255).
 *   4. IP literal v6 (criterio lax — contiene `:` y matchea forma razonable).
 *
 * Returns `false` para string vacío y para dominios reclamables comunes
 * (`mi-marca.com`, `foo.co.uk`, etc.). El rechazo formal por formato inválido
 * NO es responsabilidad de este módulo — eso lo hace `validateCustomDomain`.
 */
export function isReservedDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) return false;

  if (RESERVED_DOMAINS.includes(normalized)) return true;

  for (const suffix of RESERVED_DOMAIN_SUFFIXES) {
    if (normalized.endsWith(suffix)) return true;
  }

  if (isIpv4Literal(normalized)) return true;
  if (isIpv6Literal(normalized)) return true;

  return false;
}
