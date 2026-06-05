# 0049 — Content-Security-Policy strict (nonce-based) compuesta en el proxy

- **Fecha:** 2026-06-05
- **Estado:** Aceptada
- **Alcance:** Tech debt Phase 2.I (de `docs/tech-debt-pre-v1.3.md`). Decisión de la estrategia CSP para V1: política strict nonce-based con `'strict-dynamic'`, generada por request en `src/proxy.ts`, las directivas finales, el gating a producción, y la resolución de los forward-references de ADR-0047 (Sentry ingest) y ADR-0048 (storage media) sobre el `connect-src`/`img-src`.
- **Habilita:** defense-in-depth principal contra XSS. La app tiene varios sinks de user-generated content (nombre del place, email del invitee, displayName de miembros); con `'strict-dynamic'` el browser ejecuta SÓLO scripts que llevan el nonce per-request, así que un atacante que logre inyectar `<script>` en un sink queda sin poder ejecutarlo (no conoce el nonce).
- **Refina:** Phase 0.D (`next.config.ts` security headers) — que dejó la CSP explícitamente afuera con un placeholder ("CSP permisiva tendría valor marginal + Phase 2 la rehace strict"). Reconcilia ese comentario.
- **Cierra forward-references:** ADR-0047 §"future Phase 2.I deberá agregar Sentry ingest a CSP `connect-src`" y ADR-0048 §"future Phase 2.I deberá agregar media a `img-src`/`connect-src`".
- **No supersede:** ninguna ADR previa.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

### El gap

Phase 0.D agregó 5 security headers estáticos en `next.config.ts` (HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options) pero NO incluyó `Content-Security-Policy`: una CSP permisiva (con `'unsafe-inline'` en `script-src`) tiene valor marginal — sólo bloquea scripts cross-origin, no `<script>alert(1)</script>` inyectado inline, que es el vector real. La decisión fue diferir a una CSP strict bien hecha en Phase 2.

### Threat model V1

Lo que QUEREMOS bloquear: ejecución de scripts inyectados vía los sinks de user-generated content (XSS reflejado/almacenado). El mecanismo correcto es nonce + `'strict-dynamic'`: el browser ignora `'self'`/allowlists de host para `script-src` y ejecuta sólo lo nonce-ado (o lo cargado transitivamente por un script ya nonce-ado).

Lo que NO: la app NO tiene `<script>` inline propios, ni `dangerouslySetInnerHTML`, ni `next/script` (auditado). El theming dinámico del owner usa atributos `style={{}}` (no `<style>` tags ni scripts). Sentry client se carga vía el bundle de Next (`instrumentation-client.ts`), no via `<script>` manual → Next lo noncea solo.

## Decisión

**CSP strict nonce-based, compuesta por request en `src/proxy.ts`, activa sólo en producción.**

### Mecánica del nonce

El nonce **no puede** ser un header estático de `next.config.ts` (cambia por request) → se compone en el proxy:

1. `prepareCsp(req)` genera el nonce y **muta `req.headers`** con `x-nonce` + `Content-Security-Policy` ANTES de branchear por zona.
2. Next lee el nonce del header **de request** `Content-Security-Policy` forwardeado al render y noncea automáticamente sus `<script>` de framework. `x-nonce` queda disponible para `<Script nonce>` manuales (hoy ninguno).
3. Propagación por zona:
   - `marketing`/`inbox`: `next-intl` middleware copia `new Headers(req.headers)` para su forward interno → hereda nonce + CSP sin intervención.
   - `place`/`custom-domain`/`inbox` (rewrites manuales): forwardean `req.headers` vía `NextResponse.rewrite(url, { request: { headers: req.headers } })`. En `inbox` el locale viaja en el PATH (`/inbox/[locale]/`), no en un header, así que forwardear `req.headers` no pisa el routing del locale.
4. `applyCsp(res, csp)` setea el header CSP **en la respuesta** de cada rama.

El nonce usa `crypto.randomUUID()` + `btoa` (base64url) — **edge-safe** (Web APIs, sin `Buffer`/Node API), porque el proxy corre en el edge runtime de Next.

### Directivas finales

```
default-src 'self';
script-src 'self' 'nonce-<>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' https://*.neon.tech wss://*.neon.tech https://*.upstash.io https://*.sentry.io;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
upgrade-insecure-requests
```

- `style-src 'unsafe-inline'`: Tailwind v4 inyecta estilos inline + el theming del owner usa atributos `style={{}}`. No hay forma práctica de nonce-ar style-attr; no son vector de ejecución de código → costo aceptado.
- `connect-src ... https://*.sentry.io`: cierra el forward-ref de ADR-0047. El SDK Sentry client POSTea beacons de error a `*.ingest.<region>.sentry.io`; sin esto, el reporte violaría la CSP (regresión de observabilidad). El wildcard CSP `*.sentry.io` matchea subdominios multi-nivel.
- `img-src ... https:`: cierra el forward-ref de ADR-0048 (media/R2). `https:` cubre cualquier origen https de imagen (logos del place, avatares V1.3+, Storage) sin necesidad de listar `media.place.community` puntualmente.
- `frame-ancestors 'none'`: authoritative anti-clickjacking; X-Frame-Options DENY queda como refuerzo legacy.

### Gating a producción

La CSP se emite **sólo con `NODE_ENV=production`**. `next dev` usa `eval` (React Refresh/HMR) + websockets del dev server; una CSP strict los bloquearía y rompería el dev. Además la suite E2E (Playwright) corre sobre `next dev` (apex `lvh.me`) — una CSP strict en dev la volvería flaky. Prod queda 100% strict; smoke local vía `pnpm build && pnpm start`. (Es práctica estándar: la propia guía CSP de Next reconoce que dev necesita `'unsafe-eval'`.)

## Alternativas rechazadas

- **α CSP permisiva (`'unsafe-inline'` en script-src)**: no protege contra el vector real (inline injection). Era el placeholder de 0.D; descartada por diseño.
- **β CSP hash-based (sin nonce)**: requeriría hashear cada script inline en build-time; no escala con scripts dinámicos de framework + obliga a recalcular hashes en cada cambio. Nonce per-request es el patrón canónico de Next para App Router.
- **γ CSP en `next.config.ts` (header estático)**: imposible — el nonce debe ser per-request. Un CSP estático sin nonce sería permisivo (vuelve a α).
- **δ CSP `Report-Only` V1**: útil para calibrar sin romper, pero la política es chica y auditable (codebase sin scripts inline); el smoke prod confirma 0 self-block. Un `report-uri`/`report-to` a Sentry queda diferible a una sesión futura de observability (Sentry ingest de CSP violations), anotado como opcional en el tracker.
- **ε CSP strict también en dev (con `'unsafe-eval'` + ws dev origin)**: complica el código con ramas dev/prod y arriesga la suite E2E sobre `next dev`. Gating limpio a producción es menor superficie + cero riesgo para E2E.
- **ζ Propagar el nonce vía React Context a `<Script>` components**: innecesario — el repo no tiene scripts manuales y Next noncea su framework leyendo el header de request. `x-nonce` queda seteado por si aparece un caso futuro.

## Consecuencias

- **Positivas**: XSS execution bloqueada en prod (defense-in-depth real); política auditada end-to-end (smoke confirmó los 15 `<script>` de framework con el mismo nonce que el header → 0 self-block); cierra los forward-refs de 0047/0048; `Permissions-Policy` tightened de paso (+payment, usb, browsing-topics).
- **Costos / deuda futura**:
  - `style-src 'unsafe-inline'` es el eslabón menos strict (inevitable con Tailwind v4 + style-attr). No es vector de ejecución; revisar si una futura versión de Tailwind soporta nonce-ado de estilos.
  - Sin CSP en dev: las violaciones sólo se ven en prod build. Mitigado con el smoke `pnpm build && pnpm start`.
  - Cuando un consumer client-side de Storage aparezca (avatares V1.3, ADR-0048 dejó la plataforma lista pero sin consumers V1), esa sesión deberá agregar el origen R2 a `connect-src` para los presigned PUT desde el browser (`img-src https:` ya cubre la lectura).
  - `report-uri`/`report-to` no incluido V1 — sin telemetría de violaciones CSP en prod hasta que se active.

## Implementación

- `src/shared/lib/security/content-security-policy.ts` — `generateNonce()` + `buildContentSecurityPolicy(nonce)` (puro, edge-safe) + constantes `CSP_HEADER`/`NONCE_HEADER`.
- `src/proxy.ts` — `prepareCsp`/`applyCsp`/`rewriteWithCsp`; mutación de `req.headers` pre-branch + aplicación por zona.
- `next.config.ts` — `Permissions-Policy` tightened + comentario CSP reconciliado (la CSP vive en el proxy).
- Tests: `content-security-policy.test.ts` (11) + `proxy-csp.test.ts` (6, incl. guard de no-CSP fuera de prod); `proxy.test.ts` (8) sin regresión.
- **Commit**: `9e01b6d` · **Tag**: `baseline/phase-2-I-csp-strict-done`.
