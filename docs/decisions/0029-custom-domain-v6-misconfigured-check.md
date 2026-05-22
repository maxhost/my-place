# 0029 — Custom Domain: chequear V6 `misconfigured` además de V9 `verified` (cierre falsa-positiva)

- **Fecha:** 2026-05-22
- **Estado:** Aceptada
- **Alcance:** producto (UI del settings — `/settings/domain`) · arquitectura (lazy verification ahora consulta DOS endpoints Vercel + elimina short-circuit) · slice `custom-domain` (`getCustomDomainStatus` + `registerCustomDomainAction` cambian su lógica de decisión) · integración externa (suma consumo de `GET /v6/domains/{domain}/config` al wrapper Vercel)
- **Habilita:** Feature B (Custom Domain Host Routing) — bloqueada hasta que esta ADR cierre, porque rutear un dominio con `verified_at` falsa positiva sería catastrófico (visitantes externos verían el place pero el DNS no apunta a Vercel)
- **Refina:** ADR-0026 (Custom Domain V1: verificación lazy en page-load + lifecycle archived) — la lazy verification V1 era **incompleta**: solo consultaba `GET /v9/projects/{id}/domains/{domain}` (campo `verified` = "ownership challenge completado", sticky/append-only) e ignoraba `GET /v6/domains/{domain}/config` (campo `misconfigured` = "DNS apunta a Vercel + TLS emisible AHORA", dinámico). Esta ADR cierra el gap.
- **No supersede:** ADR-0001 (Place=IdP + OIDC sigue vigente), ADR-0010/0012 (RLS owner-only de `place_domain` intacta), ADR-0026 (resto de la decisión sigue vigente: lazy poll en page-load, partial unique, archived libera).
- **Difiere:** S6 del plan custom-domain original (cron `*/15` opcional V1.1) sigue diferido — el lazy poll con doble check V6+V9 cubre el caso porque `/settings/domain` es low-traffic page (solo owner). Si producción muestra patrón de "owners que nunca vuelven a la página y su DNS se rompe sin que nadie note", se reevalúa.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0026 (Aceptada 2026-05-21) decidió la **verificación lazy en page-load** del Server Component: cuando el owner abre `/settings/domain` y `place_domain.verified_at IS NULL`, el Server Component invoca `vercel.getDomainStatus(domain)`; si Vercel confirma `verified: true`, UPDATE `verified_at = now()` y la siguiente carga muestra estado verified. Si `verified: false`, retorna pending con `verification[]` records.

Esta decisión se basaba en un **modelo mental incorrecto** del campo `verified` de Vercel. La ADR-0026 asumió:

> "`verified: true` significa DNS está bien configurado + SSL fue emitido + el dominio está listo para servir tráfico."

La realidad de la API Vercel (verificado con docs oficiales 2026-05-22):

> "`verified: true` significa **ownership challenge completado** (nadie más en Vercel reclama este dominio). Es **sticky**: una vez true, queda true para siempre, independientemente de si el DNS apunta o no apunta a Vercel actualmente."

Existe **un segundo endpoint dedicado** que mide el estado dinámico actual:

> `GET /v6/domains/{domain}/config` retorna `{misconfigured: boolean, configuredBy, acceptedChallenges, recommendedIPv4, recommendedCNAME}`. El campo `misconfigured` es lo que el dashboard de Vercel muestra como "Invalid Configuration".

### Evidencia del bug en producción

**2026-05-22 ~01:52 UTC, prod (`my-place` deploy `d31e1cc`)**:

1. Owner del place `nocodecompany` registra `nocodecompany.co` desde `/settings/domain`.
2. Action `registerCustomDomainAction` corre:
   - INSERT `place_domain` (`verified_at = NULL`).
   - `vercel.addDomain("nocodecompany.co")` → Vercel responde HTTP 200 `{name: "nocodecompany.co", apexName: "nocodecompany.co", verified: true, verification: []}`.
   - **Por qué Vercel respondió `verified: true` inmediato**: docs Vercel oficiales muestran que el POST puede retornar `verified: true` con `verification: []` vacío cuando **el dominio no está en uso por otro proyecto Vercel** — ownership "implícita", no requiere challenge TXT. `nocodecompany.co` era dominio "limpio" en Vercel, lo asignó instantáneo.
3. ~0.6 segundos después: el `revalidatePath` dispara re-render del Server Component → `getCustomDomainStatus` corre → SELECT `verified_at = NULL` → llama `vercel.getDomainStatus("nocodecompany.co")` (endpoint V9) → Vercel sigue respondiendo `verified: true` (ownership ya establecida) → `persistVerifiedAt` ejecuta `UPDATE place_domain SET verified_at = now() WHERE verified_at IS NULL`.
4. **Estado en DB (verificado via MCP Neon)**:
   ```
   id: 959c6d09-af83-4a11-8cdf-fc11ca3d40a2
   domain: nocodecompany.co
   created_at: 2026-05-22T01:52:42.161Z
   verified_at: 2026-05-22T01:52:42.786Z   ← 0.625s después
   archived_at: null
   oauth_client_id: null
   ```
5. **Estado en Vercel dashboard (verificado por owner)**: "Invalid Configuration" con tabla DNS Records pidiendo `A @ 216.198.79.1`. El DNS del registrar de `nocodecompany.co` NUNCA apuntó a Vercel.
6. UI del settings muestra "Verificado, SSL activo" — **falsa positiva total**.

### Por qué el código actual no puede detectarlo

Dos fallos compuestos:

**(a) Endpoint equivocado** (`src/shared/lib/vercel/domains.ts:174-202` `addDomain` y `:210-234` `getDomainStatus`):

El wrapper consume `POST /v10/.../domains` y `GET /v9/.../domains/{domain}`. Ambos endpoints retornan el shape `{name, apexName, verified, verification[]}`. **Nunca se llama** a `GET /v6/domains/{domain}/config` que es el único que retorna el flag `misconfigured`.

**(b) Short-circuit que impide re-verificar** (`src/features/custom-domain/actions/get-custom-domain-status.ts:163-164`):

```typescript
if (baseRecord.verifiedAt !== null) {
  return { status: "verified", record: baseRecord };  // ← nunca llama a Vercel de nuevo
}
```

Aunque corrigiéramos el endpoint, el short-circuit impediría detectar regresiones futuras (DNS que se rompe después del verify inicial).

### Pattern oficial Vercel recomendado

Docs oficiales (`https://vercel.com/docs/multi-tenant/domain-management`) muestran el flow correcto:

```typescript
const mainDomainResponse = await vercel.projects.addProjectDomain({
  idOrName: projectName,
  requestBody: { name: mainDomain },
});

const checkConfiguration = await vercel.domains.getDomainConfig({
  domain: mainDomain,
});

if (mainDomainResponse.verified && !checkConfiguration.misconfigured) {
  // domain is ready to use
}
```

**Vercel explícitamente recomienda la conjunción `verified && !misconfigured`**. Nuestro código actual solo verifica el primer lado.

### Por qué este bug es bloqueante de Feature B (host routing)

Feature B (próxima, plan separado) implementará el routing `mi-marca.com → place del owner` vía función Postgres `app.lookup_place_by_domain(host)` `SECURITY DEFINER` que retorna `{place_id, slug}` solo si `verified_at IS NOT NULL AND archived_at IS NULL`. Si `verified_at` está set por falsa positiva (como `nocodecompany.co` hoy), B rutearía el host hacia el árbol place, pero los visitantes externos **nunca llegarían al edge de Vercel** (su DNS apunta a otra IP), verían errores. UX catastrófica.

Por lo tanto: este fix es **prerrequisito hard** de Feature B.

## Decisión

**1. El wrapper Vercel suma `getDomainConfig(domain)` que consume `GET /v6/domains/{domain}/config`.**

Nuevo type `DomainConfig`:
```typescript
type DomainConfig = {
  configuredBy: "A" | "CNAME" | "http" | "dns-01" | null;
  acceptedChallenges: ("dns-01" | "http-01")[];
  recommendedIPv4: string[];   // rank=1 values, normalizado
  recommendedCNAME: string[];  // rank=1 values, normalizado
  misconfigured: boolean;
};
```

Wrapper sigue el mismo pattern defensivo del módulo (`VercelResult<DomainConfig>` discriminated union, mappings de error consistentes con `addDomain`/`getDomainStatus`).

**2. `getCustomDomainStatus` elimina el short-circuit y SIEMPRE consulta V6.**

Nuevo flow:

```
1. loadActiveDomainRow(token, placeId).
2. SIEMPRE: vercelResult = await getDomainConfig(domain).
3. Branch:
   (a) V6 ok && misconfigured=false && verified_at NOT NULL → verified.
   (b) V6 ok && misconfigured=false && verified_at NULL → llamar V9 getDomainStatus.
       - V9 verified=true → persistVerifiedAt + verified.
       - V9 verified=false → pending con verification[] del V9 (TXT challenge case).
   (c) V6 ok && misconfigured=true && verified_at NOT NULL →
       resetVerifiedAt + pending con records V6 + wasDownreverted=true.
   (d) V6 ok && misconfigured=true && verified_at NULL →
       pending con records V6 (+ verification[] V9 si pendiente challenge).
   (e) V6 fail (network/auth/parse) →
       fallback al state DB + log estructurado. Si verified_at NOT NULL, mantener
       verified (no romper UX por transient). Si NULL, pending con vercelUnavailable=true.
```

**Cost de la decisión**: +1 round-trip a Vercel V6 por cada carga de `/settings/domain` (~50-150ms). Aceptable porque la página es **low-traffic** (solo owner del place, sin búsquedas externas o crawler). El user de un place típico abre `/settings/domain` 1-3 veces por configuración + 0 veces después.

**3. Reset `verified_at = NULL` cuando se detecta downreverted (caso `c`).**

Nueva función simétrica de `persistVerifiedAt`:
```typescript
async function resetVerifiedAt(token: string, id: string): Promise<Date | null> {
  // UPDATE place_domain SET verified_at = NULL WHERE id = $1 AND verified_at IS NOT NULL RETURNING ...
}
```

Esto permite que la próxima carga del page-load entre en branch (d) (pending) hasta que el owner re-configure DNS, momento en el que V6 reporta `misconfigured: false` y el flow vuelve a verified.

**4. UI banner "downreverted"** en el estado pending.

Discriminated union `CustomDomainState` agrega flag opcional `wasDownreverted?: boolean` en el caso `pending`. La UI (`domain-section-pending.tsx`) renderiza un banner calmo arriba de la tabla DNS records con copy explícito: "Detectamos que tu DNS dejó de apuntar a Place. Tu dominio ya no está activo — volvé a configurar los records que aparecen debajo."

**5. `registerCustomDomainAction` también consulta V6** después del `addDomain` exitoso.

Si Vercel responde `verified: true` al POST pero V6 reporta `misconfigured: true`, **NO se persiste `verified_at`** en el INSERT. El user ve pending state correcto desde el primer render del page, sin la ventana de 0.6s de falsa positiva.

**6. Records pending vienen prioritariamente de V6** (`recommendedIPv4` + `recommendedCNAME`).

V6 retorna el shape DNS estándar (A record IP o CNAME target) que el dashboard de Vercel muestra al user. Es la fuente más precisa de "qué tiene que configurar el user en su registrar". Si V6 retorna records vacíos pero V9 retorna `verification[]` (caso challenge TXT por dominio en uso por otro proyecto), se usan esos en su lugar.

## Alternativas rechazadas

### a) Cron `*/15` re-verificando todos los dominios verified

Mantendría el short-circuit en page-load (cero overhead) y delegaría el re-check a un job periódico que escanea `place_domain WHERE verified_at IS NOT NULL` cada 15 minutos y resetea los que tienen `misconfigured: true` en Vercel.

**Por qué rechazada**:
- Suma infra (cron handler + auth secret + Vercel cron config) que no es necesaria.
- Eventual consistency hasta 15 min: el owner ve "verified" por hasta 15 min antes de que el cron lo corrija. Si en ese tiempo navega entre `/settings/domain` y otras pages, la inconsistencia es visible.
- Para Feature B (host routing): un visitante de `mi-marca.com` cuyo DNS se rompió hace 5 min seguiría siendo ruteado al place por hasta 10 min más → UX rota.
- El page `/settings/domain` es low-traffic → el costo de +1 round-trip V6 por carga es despreciable.

Si en producción aparece volumen de places verified que justifique el cron (e.g. >100 places activos), se reevalúa. Por ahora YAGNI.

### b) Cache V6 con TTL corto (~60s) en memoria del Server Component

Reduciría el overhead a Vercel V6 cuando el owner refresca rápidamente la página varias veces. Implementación: `React.cache(...)` + key por `domain`.

**Por qué rechazada (V1)**:
- Complejidad añadida sin justificación todavía.
- Caso real: owner abre `/settings/domain` 1 vez, configura DNS, vuelve 30+ min después. Cache de 60s no se usa.
- Si la latencia molesta en V2, se agrega sin cambiar la API del wrapper.

Documentado como path V2 si métricas lo justifican.

### c) Disparar `POST /v9/.../domains/{domain}/verify` manualmente cuando V9 `verified: false`

El endpoint Vercel `POST /v9/projects/{id}/domains/{domain}/verify` fuerza una re-verificación del challenge TXT cuando V9 inicialmente retornó `verified: false`. Útil para el caso "dominio en uso por otro proyecto Vercel + el user configuró el TXT challenge".

**Por qué rechazada (V1)**:
- Para nuestro caso típico (dominios que NO están en uso por otro proyecto Vercel), V9 retorna `verified: true` al instante por ownership clear — no hay challenge que disparar.
- Para el caso challenge real, V9 retorna `verification[]` con el TXT a configurar; el owner configura el TXT en su registrar; el próximo lazy poll de `getDomainStatus` (V9) automáticamente detecta el TXT y retorna `verified: true`. No requiere disparar `POST verify` manualmente.
- Se reserva para V2 si surge demanda explícita (e.g. "verificar ahora" botón manual).

### d) Webhook de Vercel notificando cambios de status

Vercel no expone webhooks para domain status changes (sí para deploys/projects). Diferido a cuando Vercel lo provea.

## Consecuencias

**Positivas**:

- UI honesta: el estado "Verificado" implica de verdad "DNS configurado correctamente AHORA + ownership clara".
- Detección automática de DNS regresión: si el owner cambia DNS en su registrar (o el certificado SSL expira por algún motivo), la próxima carga del page lo detecta y vuelve a pending con records correctos.
- Feature B (host routing) tiene una invariante confiable: `verified_at IS NOT NULL` ↔ "dominio listo para servir tráfico hoy".
- Pattern industrial estándar: alineado con la guía oficial Vercel multi-tenant.

**Negativas / Costo**:

- +1 round-trip Vercel V6 por cada carga del page (~50-150ms agregado). Low-traffic page → impacto despreciable.
- +1 call si en S5 de la action register (POST + V6 check), añade ~150ms al submit del form. Aceptable (el user ya espera por el POST).
- Wrapper Vercel crece de 3 funciones a 4 (mantenibilidad: cada función ≤60 LOC, módulo total <400 LOC).
- ADR-0026 §"Verificación lazy" queda **refinada** (no superseded). El banner refinatorio explicita qué cambia y qué sigue vigente.

**Migración del state**:

- Filas legacy con `verified_at` falsa positiva (como `nocodecompany.co`) quedan corregidas en runtime: la próxima carga del page detecta `misconfigured: true` → `resetVerifiedAt` → next-state es pending con records V6. Sin migration de schema necesaria.
- Para acelerar el fix de filas conocidas, **un UPDATE manual via MCP Neon** post-deploy es suficiente (`UPDATE place_domain SET verified_at = NULL WHERE domain = 'nocodecompany.co' AND archived_at IS NULL`). Documentado en S3 del plan.

**Forward-compat**:

- Feature B (host routing edge): el `app.lookup_place_by_domain` SECURITY DEFINER seguirá consultando `verified_at IS NOT NULL` — la lógica de qué significa "verified" la maneja el lazy poll del slice (V6 + V9 + reset). Edge proxy no necesita conocer V6.
- Feature C (OIDC SSO): el provisioning del `oauth_client_id` se dispara en branch (a) o (b) del nuevo flow (cuando se persiste `verified_at`). Si el dominio se downreverted, el OIDC client queda con `redirect_uri` que podría no funcionar — Feature C decide su lifecycle (revocar al archive o re-provisionar al re-verify), no este ADR.

**Banner aplicado a ADR-0026**:

```markdown
> **Refinada por ADR-0029 (2026-05-22):** la lazy verification V1 era incompleta — solo consultaba V9 `verified` (ownership challenge completado, sticky) ignorando V6 `misconfigured` (DNS actual). El short-circuit de `getCustomDomainStatus:163-164` impedía detectar regresiones DNS post-verify. ADR-0029 cierra el gap: chequea ambos endpoints, elimina short-circuit, resetea `verified_at` cuando se detecta `misconfigured: true`. Resto de ADR-0026 sigue vigente (lazy poll en page-load, partial unique index, archived libera dominio).
```

## Verificación

Plan ejecutable detallado en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md` (S1-S3). Smoke checklist 7 escenarios documentado en el plan + sección "Verificación" del spec del feature.

### Smoke real S3 (2026-05-22)

**Setup**: post-deploy de `5a2eb7b` a prod (Vercel `dpl_CVnEJVKxKXhsibTWcfj2fg5mH3jv` READY). DB state pre-visita confirmado vía MCP Neon (`nocodecompany.co` con `verified_at = 2026-05-22T01:52:42.786Z`, la falsa positiva original).

**Scenario 1 — `nocodecompany.co` (data real del bug)**: el owner visita `https://mi-place.place.community/settings/domain`. El lazy poll ejecuta el nuevo flow:

1. `loadActiveDomainRow` → `verified_at NOT NULL`.
2. `getDomainConfig('nocodecompany.co')` → `misconfigured: true` (DNS no apunta a Vercel todavía).
3. `decideDomainFlow` retorna `kind: "verified_reset"` con records V6.
4. `resetVerifiedAt` UPDATE: `verified_at = NULL`.
5. UI render: `status: "pending"`, `wasDownreverted: true`, tabla DNS con records V6.

**Verificación DB post-visita** (MCP Neon, mismo turno):

```sql
SELECT verified_at FROM place_domain WHERE domain = 'nocodecompany.co';
-- verified_at = NULL  ✓ auto-reset ejecutado por branch (c)
```

El **core fix funcionó verde sobre data real**: V6 detectó el bug, el flow ejecutó la rama correcta, la DB quedó coherente, la UI mostró pending en vez de la falsa positiva. Cerrado el bug original.

### Scenarios 2-7

Cubiertos por unit tests pusheados (no requirieron smoke manual):

| # plan | Cobertura test |
|---|---|
| 2 — Register nuevo dominio DNS no apuntando | `register-custom-domain.test.ts` (V6 misconfigured=true case) |
| 3 — Configurar DNS bien → verified | `v6-helpers.test.ts` branch (b) |
| 4 — Verified → romper DNS → pending | `v6-helpers.test.ts` branch (c) auto-reset + `domain-section.test.tsx` banner downreverted |
| 5 — V6 down → fallback | `v6-helpers.test.ts` branch (e) |
| 6 — Dominio en uso por otro proyecto Vercel | tests V9 verified=false flow |
| 7 — Archive | sin cambios en este fix, tests existentes |

### Polish UX descubierto en smoke (NO bloqueante del core fix, plan separado)

El scenario 1 reveló 2 bugs descendientes que están deferred desde el helper original y se transforman en un nuevo plan:

| Bug | Causa | Plan |
|---|---|---|
| `v6ConfigToDnsRecords` setea `name = domain` siempre → apex muestra `nocodecompany.co` cuando provider DNS espera `@` | `custom-domain.ts:200-212`, comentario literal *"Apex `@` notation es polish separado de B+C S1"* | **Task #110** — S4 polish: apex `@` + DNS shape filter |
| `decideDomainFlow` combina `[...v9, ...v6]` indiscriminadamente; el helper emite **todos** los `recommendedIPv4` + `recommendedCNAME` sin filtrar por shape del domain → A + A + CNAME al apex (RFC 1034 inválido, CNAME no convive con A en apex) | `_v6-helpers.ts:82-90` + helper | **Task #110** (mismo) |

El user con `nocodecompany.co` queda en pending state con instrucciones incorrectas hasta que se ejecute task #110. El bug **verified-false-positive original** está cerrado — task #110 cubre polish UX, no correctitud del estado de la DB.

## Detalle operativo canónico

- Wrapper Vercel: `src/shared/lib/vercel/domains.ts` (post-S1).
- Lazy poll: `src/features/custom-domain/actions/get-custom-domain-status.ts` (post-S2).
- Register action: `src/features/custom-domain/actions/register-custom-domain.ts` (post-S2).
- UI banner: `src/features/custom-domain/ui/domain-section-pending.tsx` (post-S2).
- i18n: `src/i18n/messages/{es,en,fr,pt,de,ca}.json` § `placeSettings.domain.downrevertedBanner` (post-S2).
- ADR refinada: `docs/decisions/0026-custom-domain-v1-lazy-verification.md` (banner top).
- Bug narrative: `docs/features/custom-domain/bug-fix-verified-false-positive.md`.
