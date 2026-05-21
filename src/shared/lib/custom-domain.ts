import { isReservedDomain } from "./reserved-domains";

// Validador de custom domains V1 (docs/features/custom-domain/spec.md +
// tests.md). SoT compartida client+server: la UI lo usa para feedback inline
// pre-submit y el Server Action lo re-aplica antes de tocar Vercel/DB
// (defense-in-depth). PURO: sin red, sin DB, sin `process.env` → unit-testeable.
//
// Decisiones explícitas V1:
// - ASCII estricto: cualquier char `> 127` o prefijo `xn--` en algún label
//   → `idn_not_supported`. IDN/punycode entra cuando los clientes lo pidan
//   (spec.md §Scope V1 OUT). Es una decisión consciente para que el mensaje
//   al owner sea claro ("Por ahora aceptamos solo dominios ASCII") en vez de
//   un "formato inválido" críptico ante un dominio que sí es estructuralmente
//   válido pero usa scripts no-ASCII.
// - Orden de chequeo = lo que el owner "ve primero": length → ASCII → format
//   → reserved. Así un `münchen.de` muestra "ASCII only" y no "wildcard
//   prohibido" (que sería técnicamente cierto si chequeáramos `*` antes).

export type ValidationReason =
  | "invalid_format"
  | "idn_not_supported"
  | "reserved";

export type ValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: ValidationReason };

// RFC 1123 label: 1–63 alfanum + guion interno; no leading/trailing hyphen.
// Forma single-char (`a`) o multi-char (`a-b`, `a1`, `1a`); rechaza `-`,
// `a-`, `-a`, `a_b`, espacios, símbolos.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Total RFC 1123 hostname length (sin trailing dot). 253 es el cap canónico
// (255 bytes wire format = 253 chars + 2 bytes length prefix).
const MAX_TOTAL_LENGTH = 253;

/**
 * Valida un custom domain según el contrato del custom-domain V1.
 *
 * Devuelve un discriminated union:
 * - `{ ok: true, normalized }` con el input lowercased + trimmed listo para
 *   persistir / pasar al wrapper de Vercel.
 * - `{ ok: false, reason }` con el motivo más "user-facing" (lo que el owner
 *   ve primero al type-ar): length/ASCII antes que format antes que reserved.
 *
 * No consulta red ni DB. Para reservados delega en `isReservedDomain`
 * (`./reserved-domains`) — su blocklist es la canónica de la feature.
 */
export function validateCustomDomain(input: string): ValidationResult {
  // 1) Normalización: trim + lowercase. Todo lo que sigue opera sobre `host`.
  const host = input.trim().toLowerCase();

  // 1.b) Length total. El owner que pega 500 chars de basura ve "inválido"
  // sin que tratemos de parsear nada. Vacío también cae acá (length 0).
  if (host.length === 0 || host.length > MAX_TOTAL_LENGTH) {
    return { ok: false, reason: "invalid_format" };
  }

  // 2) ASCII strict. Cualquier code point > 127 o prefijo `xn--` en algún
  // label → IDN. Se chequea antes de parsear labels porque el mensaje al
  // owner es específico ("ASCII only") y no queremos que un `münchen.de` se
  // reporte como "formato inválido" genérico.
  for (let i = 0; i < host.length; i++) {
    if (host.charCodeAt(i) > 127) {
      return { ok: false, reason: "idn_not_supported" };
    }
  }

  // Split por `.` para chequeos por-label. Si hay leading/trailing dot o
  // doble punto, alguno de los labels resulta vacío → cae en el check de
  // formato más abajo.
  const labels = host.split(".");

  // 2.b) Punycode explícito en CUALQUIER label.
  for (const label of labels) {
    if (label.startsWith("xn--")) {
      return { ok: false, reason: "idn_not_supported" };
    }
  }

  // 3) Format checks (RFC 1123).
  // 3.a) Al menos 2 labels (TLD obligatorio: `foo` solo es inválido).
  if (labels.length < 2) {
    return { ok: false, reason: "invalid_format" };
  }

  // 3.b) Wildcards prohibidos. Se chequea con `includes` para cubrir `*`,
  // `*.foo.com`, `foo.*.com`, etc. — todos invalid_format V1.
  if (host.includes("*")) {
    return { ok: false, reason: "invalid_format" };
  }

  // 3.c) IP literal v6 (chars `:`) — no tiene cabida en hostname.
  if (host.includes(":")) {
    return { ok: false, reason: "invalid_format" };
  }

  // 3.d) Cada label: 1–63 chars, alfanum + guion interno, sin leading/
  // trailing hyphen. La regex enforce todo eso; un label vacío (`""`) NO
  // matchea → captura `.com`, `foo..com`, `foo.com.` en un solo check.
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      return { ok: false, reason: "invalid_format" };
    }
  }

  // 3.e) IP literal v4 dotted (`192.168.1.1`): 4 labels todos numéricos. Se
  // chequea DESPUÉS del label regex (la regex deja pasar `192`/`168`/etc.
  // porque son alfanum válidos), pero antes de reserved (un IP no es un
  // dominio reservado, es un formato inválido).
  if (labels.length === 4 && labels.every((l) => /^[0-9]+$/.test(l))) {
    return { ok: false, reason: "invalid_format" };
  }

  // 4) Reservados (apex de Place, subdominios canónicos, providers PaaS, IP
  // literals que la blocklist también cubre). Delegado al módulo vecino.
  if (isReservedDomain(host)) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, normalized: host };
}
