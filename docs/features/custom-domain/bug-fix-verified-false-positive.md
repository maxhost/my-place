# Bug: Custom Domain marca `verified` como falsa positiva

- **Fecha de detección:** 2026-05-21
- **Fecha de diagnóstico y fix planeado:** 2026-05-22
- **Status:** Diagnosticado · fix decidido en ADR-0029 · plan en ejecución (`.claude/plans/wise-greeting-mccarthy.md`)
- **Severidad:** Crítica — bloquea promoción de Feature B (Custom Domain Host Routing)
- **Deploy afectado:** Custom Domain V1 (Feature A) — commit `d31e1cc`, prod `2026-05-21`

## Resumen ejecutivo

Custom Domain V1 marca un dominio como "Verificado, SSL activo" en la UI de `/settings/domain` apenas el owner lo registra, aunque Vercel reporte "Invalid Configuration" en su dashboard y el DNS del registrar nunca haya apuntado a Vercel. La falsa positiva proviene de un modelo mental incorrecto del campo `verified` de la API Vercel (sticky/ownership) combinado con un short-circuit en el lazy poll que impide re-verificar una vez `verified_at` quedó set. El fix canónico se decidió en ADR-0029: sumar consumo de `GET /v6/domains/{domain}/config` (campo `misconfigured`) y eliminar el short-circuit.

## Síntomas observados

- **UI del settings (`/settings/domain`)**: el owner del place `nocodecompany` registra `nocodecompany.co`; menos de un segundo después, la sección muestra el estado "Verificado, SSL activo" en verde, sin tabla DNS pendiente. Screenshot: `glados-images/Captura-de-pantalla-2026-05-21-a-las-9.09.20-p.-m..png`.
- **Vercel dashboard**: en simultáneo, la página del dominio en Vercel muestra el banner rojo "Invalid Configuration" + tabla "DNS Records" pidiendo configurar `A @ 216.198.79.1`. El dominio nunca pasó al estado "Valid". Screenshot: `glados-images/Captura-de-pantalla-2026-05-21-a-las-9.13.32-p.-m..png`.
- **Comportamiento real del dominio**: visitar `https://nocodecompany.co` no resuelve a Vercel — el DNS del registrar apunta a otra IP. Si Feature B (host routing) estuviera deployada, la `lookup_place_by_domain` SECURITY DEFINER hubiera ruteado el host hacia el place pero los visitantes nunca habrían llegado al edge Vercel.

## Evidencia técnica

**Estado en DB** (verificado via MCP Neon `run_sql` el 2026-05-22):

```
id:           959c6d09-af83-4a11-8cdf-fc11ca3d40a2
domain:       nocodecompany.co
created_at:   2026-05-22T01:52:42.161Z
verified_at:  2026-05-22T01:52:42.786Z    ← 0.625s después del created_at
archived_at:  null
oauth_client_id: null
```

El delta de 0.625 segundos entre `created_at` y `verified_at` descarta cualquier hipótesis de "DNS pre-configurado en una sesión anterior" — la verificación se completó dentro del mismo flow del register action.

**Estado en Vercel dashboard**: "Invalid Configuration", tabla DNS Records con `A @ 216.198.79.1`, sin checks marcados en verde. Visible en screenshot 2 (`9.13.32-p.-m.`).

**Logs Vercel** (verificados via MCP `get_runtime_logs` 2026-05-22): el deploy actual NO emite el log de error `[vercel] VERCEL_API_TOKEN o ...` que el wrapper produce cuando faltan env vars. Esto confirma que las env vars Vercel SÍ están configuradas correctamente y que el POST a `/settings/domain` contactó la API exitosamente — no hay falla silenciosa de red ni de auth.

## Investigación paso a paso

**1. Hipótesis inicial (descartada): UX issue de apex domain.** Primera lectura del bug sugirió que el owner había escrito el dominio con prefix incorrecto (`name: "mi-marca.com"` en lugar de `"@"`) y que la action lo había aceptado. Descartada al revisar el screenshot 2: Vercel mostraba "Invalid Configuration" pero el dominio listado era `nocodecompany.co` correctamente (apex). El input estaba bien; el problema no era de validación.

**2. Hipótesis A (descartada): DNS pre-configurado de una sesión anterior.** Si el owner había configurado el DNS previamente y luego archivado/recreado el registro, el lazy poll podría haber capturado un `verified: true` legítimo viejo. Descartada al ver el delta de 0.6s entre `created_at` y `verified_at` en la fila DB — todo ocurrió dentro del mismo register.

**3. Hipótesis confirmada: doble fallo del código.** Re-leyendo `addDomain` (`src/shared/lib/vercel/domains.ts:174-202`) y `getDomainStatus` (`:210-234`), ambos endpoints (POST V10 + GET V9) retornan el shape `{name, apexName, verified, verification[]}` pero **ninguno mide el estado dinámico del DNS**. Combinado con el short-circuit en `getCustomDomainStatus:163-164` (`if (baseRecord.verifiedAt !== null) return verified`), una vez que el campo se setea no hay forma de detectar regresión.

**4. Confirmación con docs Vercel.** Consulta via MCP `search_vercel_documentation` reveló el pattern oficial multi-tenant (`https://vercel.com/docs/multi-tenant/domain-management`):

```typescript
if (mainDomainResponse.verified && !checkConfiguration.misconfigured) {
  // domain is ready to use
}
```

Vercel explícitamente recomienda la conjunción de DOS endpoints. El nuestro solo cubría el primer lado.

## Causa raíz

- **Endpoint usado** (`GET /v9/projects/{id}/domains/{domain}`): retorna `verified: boolean` que mide "ownership challenge completado" — es **sticky/append-only**: una vez `true`, queda `true` para siempre, independiente de si el DNS apunta o no apunta a Vercel hoy.
- **Endpoint correcto faltante** (`GET /v6/domains/{domain}/config`): retorna `misconfigured: boolean` que mide "DNS apunta a Vercel + TLS emisible AHORA" — es **dinámico**, refleja el estado real momentáneo.
- **Por qué Vercel respondió `verified: true` al POST inicial**: cuando el dominio NO está en uso por otro proyecto Vercel, la ownership se establece "implícita" sin requerir challenge TXT. `nocodecompany.co` era dominio "limpio" en el ecosistema Vercel, lo asignó instantáneo con `verification: []` vacío.
- **Short-circuit (`get-custom-domain-status.ts:163-164`)**: una vez `verified_at` está set en DB, el lazy poll no vuelve a contactar Vercel — aunque corrigiéramos el endpoint, no detectaríamos regresiones futuras.

## Decisión del fix

La decisión canónica está en `docs/decisions/0029-custom-domain-v6-misconfigured-check.md`. Texto literal del primer punto de su sección Decisión:

> **1. El wrapper Vercel suma `getDomainConfig(domain)` que consume `GET /v6/domains/{domain}/config`.** Nuevo type `DomainConfig` con campos `configuredBy`, `acceptedChallenges`, `recommendedIPv4`, `recommendedCNAME`, `misconfigured`.

El resto de la ADR define: eliminación del short-circuit, branch tree del nuevo flow del lazy poll, `resetVerifiedAt` cuando se detecta downreverted, banner UI "DNS dejó de apuntar a Place", y consulta V6 también dentro del register action para evitar la ventana de 0.6s de falsa positiva en el primer render.

## Plan de implementación

Ejecutable detallado en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`. Sesiones:

- **S0** — Documentación previa (este doc + banner refinatorio en ADR-0026 + entrada en `docs/decisions/README.md`).
- **S1** — Wrapper Vercel: nueva función `getDomainConfig` + type `DomainConfig` + tests.
- **S2** — Integración slice: `getCustomDomainStatus` y `registerCustomDomainAction` consumen V6, UI banner downreverted, i18n en 6 idiomas.
- **S3** — Smoke real en preview Vercel (7 escenarios), reset manual via MCP Neon del row `nocodecompany.co`, push autorizado.

## Lecciones aprendidas

- **Asunciones sobre semántica de APIs externas DEBEN verificarse contra docs oficiales antes de implementar.** ADR-0026 asumió "verified == DNS OK" sin chequear el shape real de la respuesta Vercel. Costó un deploy a prod + bug visible.
- **Lazy poll con short-circuit "una vez verified, siempre verified" rompe el principio de eventually consistent** cuando el estado externo (DNS) puede cambiar independientemente del estado interno (DB). El short-circuit es válido solo si la fuente de verdad externa es append-only — Vercel `verified` lo es, pero "DNS configurado" no.
- **Smoke real en producción descubrió el bug.** El smoke manual era una sesión S5 esencial del Feature A original; saltearla habría dejado el bug latente hasta Feature B.
- **Pattern oficial Vercel multi-tenant** (`vercel.domains.getDomainConfig` + check `misconfigured`) es la referencia industrial. Cuando la integración tiene un pattern oficial documentado, seguirlo desde el inicio ahorra el ciclo de descubrir-bug → diagnosticar → re-leer-docs → refactorear.

## Referencias

- **ADR-0026** — Custom Domain V1 lazy verification (refinada por ADR-0029): `docs/decisions/0026-custom-domain-v1-lazy-verification.md`.
- **ADR-0029** — V6 misconfigured check (este fix): `docs/decisions/0029-custom-domain-v6-misconfigured-check.md`.
- **Plan ejecutable** — `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`.
- **Vercel docs**:
  - Pattern oficial multi-tenant: `https://vercel.com/docs/multi-tenant/domain-management`
  - POST V10 add-a-domain-to-a-project: `https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project`
  - GET V9 get-a-project-domain: `https://vercel.com/docs/rest-api/sdk/projects/get-a-project-domain`
  - GET V6 get-a-domain-s-configuration: `https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration`
