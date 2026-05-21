# 0026 — Custom Domain V1: verificación lazy en page-load + lifecycle archived con partial unique

- **Fecha:** 2026-05-21
- **Estado:** Aceptada
- **Alcance:** producto (sección "Dominio" del `/settings` deja de ser "Próximamente" en V1.1) · arquitectura (lazy verification on page-load + cron `*/15` opcional como safety net) · modelo de datos (partial unique index sobre `place_domain.domain WHERE archived_at IS NULL`) · integración externa (Vercel Domains API como SoT de verificación + SSL, ya decidido en ADR-0001) · slice `place-settings` (segunda sección activable tras `language`)
- **Habilita:** las sesiones S1–S5 del plan custom-domain (`docs/features/custom-domain/plan-sesiones.md`) — schema migration · foundations shared/lib · Server Actions del slice · UI `<DomainSection>` · page sub-ruta y activación sidebar
- **Refina:** ADR-0001 (Auth: OIDC IdP propio, identidad separada y custom domains) — la verificación V1 NO usa cron continuo con back-off como el contexto de ADR-0001 sugiere implícitamente; en V1.1 es lazy poll en page-load + cron `*/15` opcional. ADR-0001 sigue vigente en todo lo demás (Place es IdP, 1 OIDC client confidencial por custom domain, identidad separada).
- **No supersede:** ADR-0001 (la decisión de Place=IdP+OIDC sigue válida), ADR-0010/0012 (RLS owner-only de `place_domain` queda intacta), ADR-0017 (aprovisionamiento por migraciones), ADR-0023/0025 (App Shell + sidebar V1.1).
- **Difiere a planes posteriores:** Feature B (host routing `mi-place.com → place` por `place_domain.verified_at`) y Feature C (OIDC SSO + callback handler + provisioning del `oauth_client_id`). Este V1 deja la columna `oauth_client_id` NULL y documenta el path retroactivo en una futura ADR-0027.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0001 (Aceptada 2026-05-15) cerró las decisiones macro de auth + custom domains:
- Place es su propio OIDC Identity Provider (Better Auth OIDC Provider plugin).
- Un OIDC client confidencial por custom domain, provisionado al verificar.
- Verificación delegada a **Vercel Domains API** (POST `/v10/projects/{id}/domains` + polling) como única fuente de verdad de `verified_at` + SSL.
- Schema `place_domain` (id, placeId, domain UNIQUE, verifiedAt, oauthClientId, createdAt, archivedAt) ya en `data-model.md` y `src/db/schema/index.ts:133-156` con RLS owner-only (ADR-0012).

Lo que ADR-0001 NO cierra (y esta ADR cierra):

1. **Cómo se hace el "polling" exactamente.** ADR-0001 dice "polleamos el estado hasta `verified: true`" sin especificar mecanismo. Las opciones realistas son:
   - **(a) Cron continuo cada minuto** con back-off exponencial, columnas `next_check_at`/`attempt_count`/`last_check_error` en `place_domain`.
   - **(b) Lazy poll en page-load** del Server Component: cada vez que el owner abre `/settings/domain` y la fila tiene `verified_at IS NULL`, el page llama Vercel API antes de renderear.
   - **(c) Webhook de Vercel** que actualiza `verified_at`.
   
   La opción (a) es sobre-engineering para V1 (cron de 1k+ executions/día sin nadie esperando + columnas de tracking) — el owner típicamente pega DNS, cierra el laptop, vuelve 30 min después: él **es** el polling natural. La (c) requiere endpoint público + verificación de firma + infra que Vercel todavía no provee para domain events (la API de webhooks de Vercel es para deploys/projects, no domain status).

2. **Lifecycle de "archived":** ADR-0001 menciona "revocado al archivar el dominio" pero no especifica si el dominio puede re-registrarse. La columna `archived_at` existe pero `place_domain.domain` tiene UNIQUE global, lo que impide reuso post-archive.

3. **Multi-domain por place:** El schema permite múltiples filas por `place_id`, pero no hay constraint que enforce 1 en V1 vs N en V2. Decisión pendiente.

4. **OIDC client provisioning timing:** Si se provisiona al `verified_at` (Feature C), ¿qué pasa con dominios verificados hoy (V1) cuando Feature C entre? Necesita un path retroactivo.

5. **Forward-compat de Feature B (host routing):** el lookup desde el proxy edge no tiene claim de sesión → RLS owner-only sobre `place_domain` filtra a 0 rows. Necesita ser una función `SECURITY DEFINER` cuando Feature B entre.

Esta ADR cierra las 5 antes de empezar la implementación V1.

## Decisión

### 1. Verificación V1 = lazy poll en page-load + cron `*/15` opcional como safety net

El Server Component de `/settings/domain/page.tsx` invoca un helper `getCustomDomainStatus(placeId)` que:
- Lookup row activa: `SELECT ... FROM place_domain WHERE place_id=$1 AND archived_at IS NULL LIMIT 1`.
- Si `verified_at IS NOT NULL` → retorna `{status:"verified", ...}`.
- Si `verified_at IS NULL` → llama `vercel.getDomainStatus(domain)`:
  - Si verified=true: `UPDATE place_domain SET verified_at=now()` + retorna `{status:"verified"}`.
  - Si verified=false: retorna `{status:"pending", dnsRecords}` (records vienen de Vercel response, no se persisten en DB).
  - Si Vercel falla (5xx/red): retorna `{status:"pending", dnsRecords:null, vercelUnavailable:true}`.

La UI del Client Component refresca cada 30s vía `router.refresh()` mientras `verifiedAt === null` — sin tocar nada del state local, dejando el Server Component decidir en cada render. **Cero estado de polling en el cliente; cero columnas de tracking en DB.**

**Safety net opcional (S6 del plan, V1.1):** un cron `*/15 * * * *` que poll todos los rows pending no archivados. Sin back-off, sin `next_check_at` — query simple + UPDATE simple. Se activa solo si en producción se observa que owners cierran el tab y nunca vuelven a `/settings/domain` durante el período de propagación DNS. Si lazy poll cubre 99% de los casos (esperable), S6 se difiere indefinidamente.

**Decisión asociada — DNS records NO se persisten en DB.** Los DNS records que Vercel devuelve en el POST son recuperables vía GET en cada lazy poll. Persistirlos sería estado duplicado que puede divergir; mantenerlos volátiles es simple y consistente. Cero schema delta para `dns_records`.

### 2. Lifecycle "archived libera el dominio" → partial unique index

Reemplazar el constraint actual:

```sql
-- Antes (Drizzle: text("domain").notNull().unique()):
ALTER TABLE place_domain ADD CONSTRAINT place_domain_domain_unique UNIQUE (domain);
```

Por un partial unique index:

```sql
-- Migration 0008:
ALTER TABLE place_domain DROP CONSTRAINT IF EXISTS place_domain_domain_unique;
CREATE UNIQUE INDEX place_domain_domain_active_unq
  ON place_domain (domain)
  WHERE archived_at IS NULL;
```

Consecuencias:
- Un dominio archivado puede ser re-registrado por el mismo o distinto owner.
- El history queda en DB (filas archivadas) para auditoría futura; la UI nunca las muestra.
- Si un dominio archivado se re-registra, una nueva fila nace con `verified_at NULL` y todo el ciclo de verificación se ejecuta de nuevo (cero asunción de "ya estaba verificado antes").

UNIQUE violation en INSERT activo (caller intenta registrar dominio que YA está activo en otro place) atrapada y mapeada explícitamente: `code: '23505'` → `{status:"error", reason:"domain_taken"}`. UX: "Ese dominio ya está vinculado a otro lugar de Place."

### 3. Single-domain por place en V1; schema forward-compat para multi-domain V2

El schema permite múltiples filas por `place_id`, pero la **UI y los Server Actions enforce 1 dominio activo por place en V1**. Pre-check en `register-custom-domain.ts`:

```sql
SELECT EXISTS (SELECT 1 FROM place_domain WHERE place_id = $1 AND archived_at IS NULL);
```

Si EXISTS → `{status:"error", reason:"limit_reached"}`. UX: "Ya tenés un dominio vinculado. Removelo antes de agregar otro."

V2+: cuando se quiera permitir multi-domain (e.g. `comunidad.empresa.com` + `eventos.empresa.com`), la única edición es quitar este pre-check + ajustar la UI. Cero migration. **El subdomain canónico `{slug}.place.community` SIEMPRE funciona**, sin importar cuántos custom domains tenga (V1 = 0 o 1; V2+ = 0..N).

### 4. OIDC client provisioning (`oauth_client_id`) queda NULL en V1; ADR-0027 lo provisiona retroactivamente

La columna `oauth_client_id` existe en el schema desde el día uno (ADR-0001), pero su provisioning depende del flow OIDC del IdP (Better Auth OIDC Provider plugin) que entra con **Feature C**. En V1:
- Las filas se crean con `oauth_client_id: NULL`.
- Al verificarse (`verified_at = now()`) NO se provisiona el client.
- El custom domain queda "verificado por Vercel" + SSL emitido, pero todavía sin login functional desde `mi-place.com` (eso es Feature C).

**Cuando Feature C entre**, ADR-0027 (futura) documentará un **script idempotente de provisioning retroactivo** que:
1. Lee todos los `place_domain` con `verified_at IS NOT NULL AND oauth_client_id IS NULL`.
2. Por cada uno: invoca el provisioning del plugin OIDC → recibe `client_id` + `client_secret`.
3. `UPDATE place_domain SET oauth_client_id = $1` + almacena secret en secret manager.
4. Idempotente: re-correrlo sobre rows ya provisionadas es no-op.

Este path retroactivo **es la decisión, no un edge case**: V1 está diseñado sabiendo que C va a ejecutar este script.

### 5. Forward-compat Feature B: el proxy edge usará `SECURITY DEFINER`

Feature B (`docs/features/custom-domain-routing/` futura) modificará `src/shared/lib/host-routing.ts` para resolver `mi-place.com → place` vía lookup en `place_domain`. **El proxy edge corre SIN claim de sesión** (Cloudflare-style edge, antes del Server Component handshake) → RLS owner-only sobre `place_domain` filtraría a 0 rows.

La solución prevista (no se implementa en V1, sólo se documenta): una función Postgres `app.lookup_place_by_domain(host text) RETURNS jsonb` con `SECURITY DEFINER` que retorna `{place_id, slug, verified}` sin requerir claim. El proxy la invoca como cliente anónimo gateado por la propia función.

V1 NO toca `host-routing.ts` ni crea la función. Cuando Feature B entre, este nota anticipa el approach.

## Alternativas rechazadas

- **Cron continuo cada minuto con back-off exponencial + columnas `next_check_at`/`attempt_count`/`last_check_error`.** Sobre-engineering para V1 — 1k+ executions/día con Vercel rate limit ocioso, columnas de tracking que duplican estado, complejidad de back-off math. El usuario natural-mente "polea" al volver al page. Rechazado por YAGNI; si en producción se observa el caso "owner nunca vuelve" se activa la safety net S6 (cron simple `*/15` sin back-off, sin columnas).

- **Webhook de Vercel para domain events.** La API de webhooks de Vercel hoy no soporta domain status events (sólo deployment/project events). Requeriría que Vercel agregue el event type, lo cual escapa de nuestro control. Si se agrega en futuro, swap del lazy poll por webhook es 1 sesión.

- **Persistir DNS records en DB** (columna `dns_records jsonb` en `place_domain`). Estado duplicado que puede divergir del SoT de Vercel; mantenerlos volátiles + recuperarlos en cada lazy poll es más simple y consistente. Trade-off aceptado: latencia extra de ~200ms en page-load pending (única vez por carga; nadie está cronometrando).

- **Polling on-demand via botón "Verificar ahora"** explícito en UI. El user pidió explícitamente "automático, sin botón" — el lazy poll en page-load es el "automático" más simple posible (correr en cada visit es suficientemente automático para V1).

- **UNIQUE global sin partial index + soft delete simbólico** (archived_at sin liberar). Dominio archivado permanecería "ocupado" eternamente — owner que se equivocó al typear nunca puede corregir; owner que cambia de marca pierde el dominio viejo permanentemente. Rechazado por UX pobre.

- **Multi-domain V1.** Aumenta superficie de UI (listing, current vs alternative, default), de error handling (qué dominio usa el invitation link), de Server Actions (set/unset default). No es requirement V1; YAGNI hasta que aparezca cliente que lo pida. Schema queda forward-compat.

- **Provisionar OIDC client en S3 al verificar.** Acopla V1 al SDK de Better Auth OIDC Provider que todavía no está cableado (Feature C). Si la provisión falla post-verify, estado inconsistente que requiere reintento. Provisioning retroactivo via ADR-0027 desacopla cleanly.

## Consecuencias

- **V1 ship-able sin Feature B ni C**: el owner registra + verifica + ve el badge "Verificado, SSL activo"; el subdomain canónico sigue siendo el único working URL (no hay routing custom todavía). Esto es **estado válido del flow**, no incompleto: el owner sabe que su dominio está validado por Vercel y SSL emitido, listo para activarse cuando B y C entren.
- **Lazy poll incrementa latencia de page-load pending** en ~200-500ms (round-trip a Vercel API). Aceptable para `/settings/domain` (low traffic, owner espera la verificación de todas formas). Pages verified no pagan el costo (no hay llamada a Vercel cuando `verified_at IS NOT NULL`).
- **Cron `*/15` (S6) puede sumarse sin schema delta** si en producción se justifica. Decisión arquitectónica no condiciona ese path.
- **Provisioning retroactivo del `oauth_client_id`** queda como deuda explícita, documentada en este ADR + futura ADR-0027. No es "olvido" sino "diferimiento intencional".
- **Migración 0008 requiere reconciliación si hay rows pre-existentes con `domain` duplicado activo** (no debería en MVP, pero pre-flight check `SELECT COUNT(*)` antes de migrar).
- **`docs/multi-tenancy.md` §"Dominios propios"** se actualiza para reflejar el lazy poll vs "polleamos" genérico. ADR-0001 recibe un banner "Refinada por ADR-0026".

## Detalle operativo canónico

- Flow UX completo (estados · transiciones · error mapping): `docs/features/custom-domain/spec.md`.
- Schema delta (migration 0008): `docs/data-model.md` § actualizada.
- Wrapper Vercel API + Zod schemas: `src/shared/lib/vercel/domains.ts` (S2 del plan).
- Server Actions (defense-in-depth canon): `src/features/place-settings/actions/{register,archive,get-status}-custom-domain.ts` (S3 del plan).
- UI Client Component (4 estados + auto-refresh + confirm dialog + copy-to-clipboard): `src/features/place-settings/ui/domain-section.tsx` (S4 del plan).
- Page sub-ruta + activación sidebar: `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` + `src/features/nav-place/ui/nav-place-items.tsx` (S4 del plan).
- Cron safety net opcional V1.1: `src/app/api/cron/verify-domains/route.ts` + `vercel.json` (S6 diferible).
