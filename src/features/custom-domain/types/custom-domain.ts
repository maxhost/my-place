// Types + helpers puros compartidos del slice `custom-domain` (ADR-0026,
// ADR-0028, ADR-0030). Consumidos por las 2 Server Actions del slice
// (`register-custom-domain`, `archive-custom-domain`), el UI Client
// Component `<DomainSection>`, el page `/settings/domain/page.tsx`, y
// también por el sub-slice `custom-domain-verification` cross-slice
// (mappers Vercel → `DnsRecord[]`, ADR-0030).
//
// Helpers RUNTIME del módulo (todos puros + testeados):
//   - `mapPgErrorToActionError(err)`: PG `23505` → `domain_taken`.
//   - `vercelRecordsToDnsRecords(records)`: V9 `verification[]` →
//     `DnsRecord[]` con fallback `name → domain → ""`.
//   - `v6ConfigToDnsRecords(config, domain)`: V6 `recommendedIPv4` +
//     `recommendedCNAME` → `DnsRecord[]` (un A por IPv4, un CNAME por
//     hostname, `name = domain` siempre).
//
// Los 3 helpers viven acá (no en cada action ni en el sub-slice de
// verification) porque su shape de salida es `DnsRecord` — SoT del tipo
// vive acá, los helpers que producen instancias viven junto al tipo.
// Cross-slice consumption: `custom-domain-verification` los importa via
// `@/features/custom-domain/public`.

import type { DomainConfig } from "@/shared/lib/vercel";

/**
 * Estado consolidado del custom domain de un place desde el punto de vista
 * del owner que abre `/settings/domain`:
 *
 * - `"none"`: el place NO tiene fila activa en `place_domain`. UI muestra
 *   form vacío para registrar el primero.
 * - `"pending"`: existe fila pero `verified_at IS NULL`. Vercel devolvió
 *   los DNS records que el owner debe pegar en su provider. UI muestra
 *   tabla de records + auto-refresh.
 * - `"verified"`: `verified_at IS NOT NULL`. UI muestra badge "Verificado,
 *   SSL activo" + botón remover.
 *
 * No incluye `"archived"` — el page filtra `archived_at IS NULL`, así que
 * el archived nunca se materializa como estado de UI (decisión spec
 * `docs/features/custom-domain/spec.md`).
 */
export type CustomDomainStatus = "none" | "pending" | "verified";

/**
 * DNS record que el owner debe configurar en su provider (Cloudflare,
 * Google Domains, etc.) para verificar el dominio. El wrapper de Vercel
 * (`@/shared/lib/vercel`) expone un shape más permisivo (`name?` y
 * `domain?` ambos opcionales por compat con la API); el slice lo
 * normaliza a un shape estricto pensado para la UI (los 3 campos
 * requeridos, sin metadata extra de Vercel).
 */
export type DnsRecord = {
  /** Tipo de record DNS — típicamente `"A"`, `"CNAME"`, `"TXT"`. */
  type: string;
  /** Host del record (e.g. `_vercel.comunidad.mi-marca.com`). */
  name: string;
  /** Valor del record (e.g. `cname.vercel-dns.com` o un TXT challenge). */
  value: string;
};

/**
 * Fila activa de `place_domain` proyectada al cliente.
 *
 * `verifiedAt`:
 * - `Date` ⇒ dominio verificado por Vercel; SSL activo; el host-routing
 *   (Feature B futura) puede resolverlo.
 * - `null` ⇒ pending; el lazy poll del page (`get-custom-domain-status`)
 *   se encarga de re-consultar Vercel y persistir el verified_at cuando
 *   corresponda.
 *
 * No expone `archivedAt`: el page filtra `archived_at IS NULL`, todos
 * los records que la UI ve son activos por construcción.
 */
export type CustomDomainRecord = {
  id: string;
  domain: string;
  verifiedAt: Date | null;
  createdAt: Date;
};

/**
 * Estado entregado por `getCustomDomainStatus` al Server Component del
 * page. Discriminated union: la UI ramifica por `status` y obtiene
 * exactamente los campos que necesita en cada rama.
 *
 * `vercelUnavailable` (en pending): true si la última llamada al wrapper
 * de Vercel falló (red, 5xx, rate limit). UI muestra notice calmo
 * "estamos verificando, intentaremos de nuevo en breve"; los DNS records
 * se recuperan en la próxima carga del page (lazy poll, ADR-0026 §1).
 * En ese caso `dnsRecords` es `null` (no `[]`) — semánticamente
 * distinto: `null` = "no sabemos qué pegar todavía"; `[]` = "Vercel
 * confirmó cero records pero el dominio sigue pending" (caso teórico,
 * no observable en producción).
 *
 * `wasDownreverted` (en pending, ADR-0029): true cuando el lazy poll
 * detectó que un dominio que estaba `verified` se rompió en DNS
 * (V6 `misconfigured: true`). El flow puso `verified_at = NULL` en DB
 * y la UI debe mostrar un banner explicando al owner que tiene que
 * reconfigurar sus records. Es un sub-estado de pending — la tabla DNS
 * se muestra normal, sólo se agrega el banner arriba.
 */
export type CustomDomainState =
  | { status: "none" }
  | {
      status: "pending";
      record: CustomDomainRecord;
      dnsRecords: DnsRecord[] | null;
      vercelUnavailable?: boolean;
      wasDownreverted?: boolean;
    }
  | { status: "verified"; record: CustomDomainRecord };

/**
 * Razones por las que `registerCustomDomainAction` puede fallar.
 * Cada una mapea a un copy localizado en `placeSettings.domain.error*`
 * (i18n S4). Orden de aparición espeja el orden en que el action puede
 * fallar (validación → reservados → IDN → DB → Vercel).
 */
export type RegisterError =
  | "invalid_domain"
  | "reserved"
  | "idn_not_supported"
  | "domain_taken"
  | "limit_reached"
  | "vercel_unavailable"
  | "generic";

export type RegisterCustomDomainResult =
  | {
      status: "ok";
      record: CustomDomainRecord;
      dnsRecords: DnsRecord[];
    }
  | { status: "error"; reason: RegisterError };

/**
 * Razones por las que `archiveCustomDomainAction` puede fallar.
 * `"not_found"` cubre tanto "domainId no existe" como "RLS filtró por
 * no-owner" — UX-equivalente, no doxxeamos rows de otros places.
 */
export type ArchiveError = "not_found" | "generic";

export type ArchiveCustomDomainResult =
  | { status: "ok" }
  | { status: "error"; reason: ArchiveError };

/**
 * Helper PURO: mapea errores del driver Postgres (`pg`) al enum
 * `RegisterError` del action `register`. Único caso interesante hoy es
 * `code === "23505"` (unique_violation) cuando el INSERT en
 * `place_domain` choca contra la partial unique index
 * `place_domain_domain_active_unq` (S1, ADR-0026) → significa que el
 * dominio ya está activo en otro place (mismo o distinto owner). Todos
 * los demás errores colapsan a `"generic"` — la UX no tiene nada
 * accionable que comunicar al owner, salvo "probá de nuevo".
 *
 * Strict equality contra el string `"23505"` (Postgres expone el code
 * como string en `node-postgres`); si por alguna razón llegara como
 * number, lo tratamos como genérico — defense-in-depth.
 *
 * Testeado en `__tests__/custom-domain.test.ts`. Ningún otro lugar del
 * codebase debe replicar este mapeo: los Server Actions importan esta
 * función para mantener el enum como SoT.
 */
export function mapPgErrorToActionError(err: unknown): RegisterError {
  if (typeof err !== "object" || err === null) return "generic";
  if (!("code" in err)) return "generic";
  const code = (err as { code: unknown }).code;
  if (code === "23505") return "domain_taken";
  return "generic";
}

/**
 * V9 `verification[]` (shape permisivo del wrapper Vercel: `{type, name?,
 * value, domain?}`) → `DnsRecord[]` estricto del slice. Fallback
 * `name → domain → ""` porque el wrapper deja ambos campos opcionales.
 * Consumido por el sub-slice `custom-domain-verification` + el action
 * `register-custom-domain` (al recibir el response V9 post-`addDomain`).
 */
export function vercelRecordsToDnsRecords(
  records: ReadonlyArray<{
    type: string;
    name?: string;
    value: string;
    domain?: string;
  }>,
): DnsRecord[] {
  return records.map((r) => ({
    type: r.type,
    name: r.name ?? r.domain ?? "",
    value: r.value,
  }));
}

/**
 * V6 `recommendedIPv4` + `recommendedCNAME` (response normalizada por el
 * wrapper Vercel, ADR-0029) → `DnsRecord[]` del slice. Un A record por
 * cada IPv4 + un CNAME por cada hostname; `name = domain` siempre (V6
 * no provee host del record — apex-level por design). Apex `@` notation
 * es polish separado de B+C S1.
 */
export function v6ConfigToDnsRecords(
  config: DomainConfig,
  domain: string,
): DnsRecord[] {
  const records: DnsRecord[] = [];
  for (const ipv4 of config.recommendedIPv4) {
    records.push({ type: "A", name: domain, value: ipv4 });
  }
  for (const cname of config.recommendedCNAME) {
    records.push({ type: "CNAME", name: domain, value: cname });
  }
  return records;
}
