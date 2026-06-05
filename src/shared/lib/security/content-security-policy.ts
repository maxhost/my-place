// Content-Security-Policy strict (nonce-based) — Phase 2.I.
//
// Defense-in-depth principal contra XSS: con `'strict-dynamic'` el browser
// IGNORA `'self'` y allowlists de host para scripts, y ejecuta SÓLO los que
// llevan el nonce per-request (o los cargados por un script ya nonce-ado). Un
// atacante con un sink de inyección (nombre del place, email del invitee,
// displayName) queda sin poder ejecutar `<script>` propio: no conoce el nonce.
//
// El nonce se genera por request en `src/proxy.ts` y viaja al render vía el
// header de request `Content-Security-Policy` (Next lo lee y lo aplica a sus
// propios `<script>` de framework) + `x-nonce` (para `<Script nonce>` manuales,
// hoy inexistentes — reservado para futuro). Ver proxy.ts §CSP.
//
// **Edge-safe**: el proxy corre en el edge runtime de Next; este módulo usa
// SÓLO Web APIs (`crypto`, `btoa`) — nada de `Buffer`/Node API.

const CSP_HEADER = "content-security-policy" as const;
const NONCE_HEADER = "x-nonce" as const;

export { CSP_HEADER, NONCE_HEADER };

// Genera un nonce único por request. `crypto.randomUUID()` = 122 bits de
// entropía (imposible de adivinar dentro de la ventana de una respuesta), y
// `crypto` está disponible en el edge runtime (Web Crypto global). El UUID se
// base64url-ea (sin `+`/`/`/`=`) para evitar cualquier ambigüedad de parsing
// en el atributo `nonce` y en el header.
export function generateNonce(): string {
  return btoa(crypto.randomUUID())
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Construye el header CSP completo con el nonce embebido. Directivas (Phase 2.I
// del tracker `docs/tech-debt-pre-v1.3.md`):
//   - default-src 'self': base restrictiva; todo lo no-listado cae acá.
//   - script-src + nonce + 'strict-dynamic': sólo scripts firmados (ver arriba).
//   - style-src 'unsafe-inline': Tailwind v4 inyecta estilos inline + el theming
//     del owner usa atributos `style={{}}` (place-card, place-preview). No hay
//     forma práctica de nonce-ar atributos style → 'unsafe-inline' es el costo
//     aceptado (los style-attr no son un vector XSS de ejecución de código).
//   - img-src data/blob/https: avatares, logos del place y Storage (Phase 1.G).
//   - font-src self+data: fuentes self-hosted (next/font) + inline data URIs.
//   - connect-src: fetch/XHR/WebSocket del browser. Neon/Upstash por el driver
//     serverless (precautorio); Sentry (`*.ingest.*.sentry.io`) para los beacons
//     de error del SDK client (ADR-0047) — sin esto el reporte violaría CSP.
//   - frame-ancestors 'none': anti-clickjacking (authoritative; X-Frame-Options
//     DENY queda como refuerzo legacy).
//   - form-action 'self': los forms sólo postean al propio origin.
//   - base-uri 'self': bloquea inyección de `<base>` que reescriba URLs relativas.
//   - upgrade-insecure-requests: el browser auto-upgradea http→https.
export function buildContentSecurityPolicy(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.neon.tech wss://*.neon.tech https://*.upstash.io https://*.sentry.io",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests",
  ];

  return directives.join("; ");
}
