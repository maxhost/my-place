// Types compartidos del slice `place-settings/domain` (feature
// custom-domain V1, ADR-0026 + `docs/features/custom-domain/spec.md`).
//
// Estos tipos los consumen las 3 Server Actions (`register-custom-domain`,
// `archive-custom-domain`, `get-custom-domain-status`), el UI Client Component
// `<DomainSection>` (S4), y el page `/settings/domain/page.tsx` (S4). Vive
// en `types/` (no en `actions/`) porque es shared read-only entre las 3
// actions — paralelización limpia en S3.
//
// El único helper RUNTIME del módulo es `mapPgErrorToActionError`, una
// función pura que mapea errores de Postgres al enum `RegisterError`.
// Testeada en isolation (`__tests__/custom-domain.test.ts`); su correctitud
// cubre el branching crítico del INSERT del action `register` cuando choca
// con la partial unique index `place_domain_domain_active_unq` (S1).

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
 */
export type CustomDomainState =
  | { status: "none" }
  | {
      status: "pending";
      record: CustomDomainRecord;
      dnsRecords: DnsRecord[] | null;
      vercelUnavailable?: boolean;
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
