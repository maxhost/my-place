> **Cierre operativo S11.2, 2026-05-23**: bundle S11.2.A foundation + S11.2.B migration + S11.2.C close (commits `20b44e8` + `bebfbf4` + `5e62f0d`) pusheado a `maxhost/main` con autorización explícita del user · deploy production `dpl_2vhnAC2REbcjGgureWp85VRqpzj6` (commit `5e62f0d`) READY en ~42s con alias `nocodecompany.co` mapeado · **smoke T1.2 owner-driven VERDE 3/3** (form de locale populated zone-aware en `nocodecompany.co/settings` + sección "Dominio configurado" en `/settings/domain` + UPDATE de locale persiste + revalida) · **smoke server-side sanity VERDE 4/4** (`nocodecompany.co/` 200 + 2 paths `/settings*` 307 → `sso-init` + JWKS apex 200) · 4 Server Actions migradas mecánicamente (`update-default-locale`, `register-custom-domain`, `archive-custom-domain`, `get-custom-domain-status`) sin tocar la lógica DB, sólo dropeando `requireSessionJwt` + `getAuthenticatedDb` + el param `token: string` interno. Tag final S11.2: `baseline/feature-c-s11.2-done` = `17b5df5`. Bug T1.2 (4 Server Actions broken-on-custom-domain por RFC 6265 cookie scope) cerrado. Detalle del journey: `docs/features/custom-domain-sso/spec.md` §"S11.2 — fix Opción B" + §"T1.2 retry post-fix VERDE". Esta ADR formaliza la decisión arquitectónica que la sub-sesión S11.2 instanció en código (Path A elegido en DS S5: ADR independiente, no addendum de ADR-0032, porque el helper es ortogonal al SSO y vive fuera de `src/shared/lib/sso/`).

# 0034 — Zone-aware DB helper para Server Actions agnósticas de zona (Feature C S11.2 retroactiva)

- **Fecha:** 2026-05-23 (instanciación en código) · **ADR redactada:** 2026-05-24 (DS S5, Docs Sweep retroactiva)
- **Estado:** Aceptada
- **Alcance:** módulo nuevo `src/shared/lib/db-for-request.ts` (integrator async) + `src/shared/lib/db-for-request-decision.ts` (PURE decision helper) + `src/shared/lib/__tests__/db-for-request.test.ts` (8 tests PURE) · migración mecánica de 4 Server Actions owner-only que cruzan zonas apex↔custom-domain (`src/features/place-settings/actions/update-default-locale.ts` + `src/features/custom-domain/actions/{register,archive}-custom-domain.ts` + `src/features/custom-domain-verification/actions/get-custom-domain-status.ts`) · sin impacto en DB/migrations/RLS/cookies/proxy/middleware ni en los primitivos `getAuthenticatedDb` (Feature A) y `getAuthenticatedDbWithVerifier` (Feature C S4) que el helper coordinator REUSA sin modificar.
- **Habilita:** que cualquier Server Action o RSC con efectos owner-only se ejecute correctamente tanto en apex (`*.place.community`, cookie Neon Auth `Domain=.place.community`) como en custom domain (`nocodecompany.co`, cookie SSO local `__Host-place_sso_session` host-only) sin que el caller necesite saber a priori en qué zona corre. Cierra bug T1.2 detectado en smoke owner-driven post-S11.1 (las 4 Server Actions retornaban error/none al ejecutarse desde custom domain porque sólo intentaban leer la cookie Neon Auth, que NO existe en custom domains por RFC 6265).
- **Refina parcialmente:** ADR-0032 §6 (continuidad RLS post-SSO local): el `sub` del local session JWT coincide con el `sub` Neon Auth original; ADR-0034 formaliza el DISPATCH layer que aprovecha esa continuidad para que el código RLS-aware sea agnóstico de zona. Sin cambiar ningún claim, función SQL, policy ni cookie. Sin supersedir nada (los 2 primitivos `getAuthenticatedDb` y `getAuthenticatedDbWithVerifier` quedan intactos como capas de abajo).
- **No supersede:** ADR-0001 (topología "dos mundos") · ADR-0004 (Drizzle como ORM) · ADR-0006 (provisión `app_user` + RLS base) · ADR-0011 (`app.current_user_id()`) · ADR-0031 (Feature B host routing) · ADR-0032 (Signed Ticket SSO).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0032 (2026-05-22) cerró Feature C V1: silent SSO cross-domain desde custom domain via Signed Ticket pattern (4 endpoints `/api/auth/sso-{init,issue,redeem,jwks}` + cookie `__Host-place_sso_session` 7d emitida por el redeem en custom domain). ADR-0032 §6 documentó que el `sub` del local session JWT coincide con el `sub` del Neon Auth JWT original — continuidad RLS preservada por design (`app.current_user_id()` retorna lo mismo en ambas zonas).

Lo que ADR-0032 NO documentó (porque emergió como bug en smoke production post-deploy) es **cómo el código de aplicación accede al token correcto según la zona donde corre**. Feature A había canonizado `getAuthenticatedDb(token, fn)` (Feature A `src/shared/lib/db.ts`) como integrator único: el caller lee el JWT Neon Auth con `getSessionJwt()` y se lo pasa al helper. Feature C S4 agregó un primitivo paralelo `getAuthenticatedDbWithVerifier(token, verifier, fn)` (`src/shared/lib/sso/db-with-verifier.ts`) que acepta verifier custom — para que la cookie SSO local se verifique con `verifyLocalSession` en lugar de la JWKS Neon Auth. **Ambos primitivos son correctos**; el gap era que **el caller (Server Action) tenía que saber a priori qué primitivo invocar**, lo cual implícitamente requería saber en qué zona corría.

Las 4 Server Actions afectadas (todas owner-only, montadas en pages que corren tanto en apex como en custom domain por design) habían sido escritas pre-Feature-C asumiendo el modelo Feature A: `requireSessionJwt() → getAuthenticatedDb(token, fn)`. Funcionaban perfectamente desde `*.place.community` (la cookie Neon Auth es `Domain=.place.community`, scope cross-subdomain). **No funcionaban desde custom domain** — `requireSessionJwt()` retornaba `null` porque la cookie Neon Auth no llega al custom domain por RFC 6265 §5.4 (cookies con `Domain=` no se envían a hosts de domain distinto).

### Evidencia del bug (smoke owner-driven post-S11.1, 2026-05-23)

User autenticado en `place.community` navega a `https://nocodecompany.co/settings`. La cookie `__Host-place_sso_session` se setea correctamente (Feature C S10 + S11.1 cerrados). Layout zona-place (`src/app/(app)/place/[placeSlug]/layout.tsx`) detecta la cookie + renderea el chrome con el locale del place. Page settings (`/settings/page.tsx`) renderea el form con valor actual del locale leído via RLS (también funciona — la cookie SSO está disponible para el render). **El form submit dispara `updateDefaultLocaleAction`** → la Server Action llamaba `requireSessionJwt()` → null (no hay cookie Neon Auth en custom domain) → `{status: 'error'}` retornado al cliente → UI muestra fallo aunque el form era válido y el user estaba "logueado" (con sesión SSO local activa).

Mismo patrón en `/settings/domain`: `getCustomDomainStatusAction` retornaba `none` falso (form se renderizaba como "sin dominio configurado" aunque DB tenía la fila verified), `registerCustomDomainAction` y `archiveCustomDomainAction` retornaban error genérico al submit.

### Por qué este bug no se detectó pre-deploy

Tests unitarios cubren cada primitivo aisladamente; el integrador end-to-end requiere request real con cookies reales con el host correcto. Tests E2E con Playwright fueron deferred V1 (ver ADR-0032 spec.md §"Testing fuera V1"). Smokes de Feature B (S6) + Feature C S11 (smoke production T1.1) cubrieron el SSO mint + JWKS fetch + redirect chain — pero NO ejercitaron Server Actions owner-only desde custom domain (Server Actions requieren form submit interactivo, no se cubren con curl headless). Smoke owner-driven post-S11.1 (T1.2) fue el primer ejercicio interactivo del path completo, y reveló el gap inmediatamente.

### Por qué el bug NO es del SSO flow ni de los primitivos

- **El SSO flow está correcto**: emite cookie local `__Host-place_sso_session` con `sub` matcheando Neon Auth (verificado en T1.1 post-S11.1). Sub-cap LOC, separación de concerns, alternativas rechazadas — todo intacto en ADR-0032.
- **`getAuthenticatedDb` (Feature A) está correcto**: hace exactamente lo que Feature A documentó (verificar JWT Neon Auth + inyectar claims tx-local). Su contrato es "vos pasame el token, yo me ocupo de claims+RLS". Cambiar ese contrato rompería Feature A retroactivamente.
- **`getAuthenticatedDbWithVerifier` (Feature C S4) está correcto**: documentado en ADR-0032 §6 como el primitivo paralelo con verifier injectable. Su contrato es simétrico: "vos pasame el token + verifier, yo me ocupo de claims+RLS".

**Lo que faltaba era una capa COORDINADORA**: detectar la zona del request → leer la cookie apropiada → dispatchar al primitivo correcto. Esa capa NO existía. Cada Server Action habría tenido que reinventarla in-line — drift garantizado, código repetido, surface de bugs amplificada.

## Decisión

**Crear un helper coordinador zone-aware en `src/shared/lib/db-for-request.ts`** que detecta la zona del request, lee la cookie correcta y dispatcha al primitivo apropiado. Las Server Actions consumen el helper coordinador (`getAuthenticatedDbForRequest(fn)`) en lugar de los primitivos directos.

**Seam-split estructural** (canon del codebase, precedente en `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts` y en `src/shared/lib/host-routing.ts`):

- `src/shared/lib/db-for-request-decision.ts` — **PURE**. Sin `next/headers`, sin Neon Auth SDK, sin DB. Recibe `HostZone` + `CookieJarLike` + `expectedHost` → retorna `AuthBranchDecision` (discriminated union). Vitest-testable directo sin mocks complejos.
- `src/shared/lib/db-for-request.ts` — **integrator async**. Cruza `next/headers` + `resolveHostWithCustomDomains` + `getSessionJwt` + primitivos `getAuthenticatedDb` / `getAuthenticatedDbWithVerifier`. NO se vitest'ea (convención canon: integradores async cross-system se verifican por tipo/build + smoke).

### Dispatch table del coordinator

| HostZone | Cookie SSO local presente | Decisión | Primitivo invocado |
|---|---|---|---|
| `custom-domain` | sí | `sso-local` | `getAuthenticatedDbWithVerifier(token, verifyLocalSession, fn)` con check `host` claim === host actual |
| `custom-domain` | no | `no-session` | throw `NoSessionError` (sin fallback a Neon Auth — su cookie NO existe en custom domain) |
| `place` / `marketing` / `inbox` | (irrelevante) | `neon-auth-needed` | `getSessionJwt()` → token → `getAuthenticatedDb(token, fn)` ó throw `NoSessionError` si null |

### Contrato del helper

```typescript
// src/shared/lib/db-for-request.ts
export async function getAuthenticatedDbForRequest<T>(
  fn: (sql: SqlExecutor, claims: { sub: string }) => Promise<T>,
): Promise<T>;
```

Pipeline:

1. Lee `host` header + `cookies()` (next/headers).
2. Normaliza host (lowercase, trim puerto) → `expectedHost`.
3. `resolveHostWithCustomDomains(hostHeader, undefined, lookupPlaceByDomain)` → `HostZone`.
4. `decideAuthBranch(hostZone, cookieJar, expectedHost)` → `AuthBranchDecision` (PURE).
5. Dispatch según `decision.kind`.

El callback `fn` recibe `claims: {sub: string}` — superset estructural mínimo común a `VerifiedClaims` (Neon Auth) y `LocalSessionClaims` (SSO local). El callsite queda agnóstico de qué primitivo se usó adentro.

### Invariantes garantizadas

1. **Fail-closed real**: cualquier path sin sesión válida → `NoSessionError` ANTES de tocar el pool. El caller (Server Action) catchea y retorna `{status: 'error'}` UX-equivalente al fallo de auth pre-Feature-C.
2. **Defense-in-depth host claim**: en `sso-local`, el verifier chequea `host` claim === host actual del request (defense contra cookie robada re-presentada en otro custom domain). El primitivo `verifyLocalSession` ya enforce-aba esto (Feature C S4); el coordinator lo preserva propagando `expectedHost` verbatim.
3. **No-doxx en `NoSessionError`**: el error NO discrimina causa (custom-domain sin cookie SSO vs apex sin cookie Neon Auth) — UX-equivalente. El log estructurado interno SÍ distingue (event = `db_for_request_no_session`, branch = `<kind>`).
4. **Seam-split testing**: el integrador NO se vitest'ea (cruza next/headers + SDK + DB). Sólo `decideAuthBranch` se vitest'ea (8 tests PURE) — convención canon `update-default-locale.ts:13`.

### Invariante de uso (canonical going forward)

**Todo nuevo Server Action o RSC con efectos owner-only que pueda ejecutarse desde una page montada en zona-place (`/place/[placeSlug]/...`) DEBE usar `getAuthenticatedDbForRequest` en lugar de `getAuthenticatedDb` directo**, salvo que el caller esté provadamente confinado a zona apex/inbox (e.g. handlers de `/api/auth/sso-issue` que sólo corren en apex por design del flow SSO). Esta invariante NO está enforced por tipo (`getAuthenticatedDb` sigue exportado por compatibilidad con los call sites apex-only), pero está documentada in-code en el header de `db-for-request.ts` y en `docs/gotchas/zone-aware-db-cookie-source.md`.

## Alternativas rechazadas

### 1. In-line zone detection en cada Server Action (Opción A descartada)

Cada Server Action lee `host` header + `cookies()` + decide qué primitivo invocar. Rechazada:

- **Drift garantizado**: 4 Server Actions hoy + N futuras = N×implementaciones del mismo dispatch logic. Inevitablemente divergen (típicamente: alguna olvida normalizar `host`, otra usa cookie name string-literal en vez de constante exportada, una tercera no chequea `expectedHost` propagation).
- **Surface de bugs amplificada**: el dispatch es CRÍTICO de seguridad (decide qué token verificar contra qué autoridad). Replicarlo invita el bug clásico "olvidé el host check en esta Action específica".
- **Testabilidad fragmentada**: cada Server Action requeriría sus propios mocks de `next/headers` + zone detection en sus tests; con seam-split centralizado, sólo el coordinator necesita mocks (y como cruza SDK real, ni siquiera se mockea — se verifica por tipo/build + smoke).

### 2. Extender `getAuthenticatedDb` (Feature A) con zone detection (Opción C descartada)

Modificar `src/shared/lib/db.ts:getAuthenticatedDb` para que internamente detecte zona + cookie + dispatch. Rechazada:

- **Rompe el primitivo Feature A retroactivamente**: el contrato actual es "vos me pasás token, yo verifico contra Neon Auth JWKS". Cambiar a "yo me ocupo de leer la cookie también" elimina la capacidad del caller de pasar tokens en contextos donde la cookie no es la fuente (e.g. tests que pasan tokens fixture, o flows futuros con bearer header).
- **Mezcla concerns**: el primitivo verifica claims+RLS. La coordinación de fuente de cookie es responsabilidad de capa superior. Mezclarlas viola separation of concerns.
- **Forward-compat dañado**: si V2 agrega un tercer branch (e.g. bearer header en M2M API), el primitivo crece sin parar. La capa coordinator es la que crece.

### 3. Pasar token + zona explícitamente desde el caller (Opción D descartada)

Cada page que monta un form leería zona+token + lo pasaría al Server Action via form data. Rechazada:

- **Server Actions reciben FormData del browser, NO contexto server-side**: la zona+token tendrían que viajar como hidden input → vector de tampering (el cliente puede mentir sobre la zona). El server tiene que re-verificar igual → no ahorra trabajo.
- **Cross-cutting concern fuera del flow de datos del form**: el form contiene datos del DOMINIO (locale, dominio a registrar, etc.). Inyectar metadatos de routing en el FormData ensucia el contrato form↔Action.
- **Rompe Server Actions invocadas no-form** (e.g. `getCustomDomainStatusAction` que retorna estado del dominio sin form, llamada desde un RSC).

### 4. Compartir cookie cross-domain entre apex y custom domains (Opción E descartada — imposible por RFC)

Setear la cookie de sesión con `Domain=` que abarque ambos hosts. **No es una alternativa real, es físicamente imposible por RFC 6265 §5.4** — cookies no pueden cubrir dominios registrables distintos (`place.community` y `nocodecompany.co` son registrable domains diferentes). Documentado in-depth en ADR-0032 §"Alternativas rechazadas" #2.

### 5. Hardcodear el coordinator dentro de `db-with-verifier.ts` (Opción F descartada — mezcla SSO con coordinator)

Hacer que `getAuthenticatedDbWithVerifier` (Feature C S4) detecte zona internamente y dispatch a `getAuthenticatedDb` si no hay cookie SSO. Rechazada:

- **Rompe el primitivo Feature C S4 retroactivamente**: el contrato actual es "vos me pasás token+verifier, yo verifico y abro tx". Inyectar zone detection mezcla primitive con coordinator.
- **Atrapar el coordinator dentro del sub-módulo `src/shared/lib/sso/`** lo convierte conceptualmente en parte del SSO ticket, cuando NO lo es — el coordinator es ortogonal al SSO (Feature A pre-SSO también necesitaría coordinator si V2 agrega segunda fuente de cookie en apex). Por eso el helper vive en `src/shared/lib/` raíz, no en `src/shared/lib/sso/`.

### 6. Migrar las Server Actions a Route Handlers `/api/...` para evitar el dispatch (out of scope, descarta el paradigma)

Convertir las 4 Server Actions a Route Handlers que parsean cookies manualmente. Rechazada:

- **Server Actions son el paradigma del codebase para mutaciones owner-only**: convertirlas degrada el patrón, requiere reescribir todos los call sites (forms con `action={...}`) + perder los beneficios de progressive enhancement.
- **El bug es independiente del paradigma**: Route Handlers tendrían el MISMO problema si llamaran `getAuthenticatedDb` directo desde un custom domain. La fix es el coordinator, no cambiar de runtime.

## Consecuencias

### Positivas

1. **4 Server Actions owner-only funcionan transparentemente en ambas zonas** post-fix: T1.2 smoke owner-driven 3/3 VERDE (form populated zone-aware + dominio configurado visible + UPDATE de locale persiste+revalida). Cierra el gap funcional crítico de Feature C V1 para owners que operan desde custom domain.
2. **Pattern reusable** para cualquier Server Action o RSC con efectos futura: el invariante "todo lo zone-agnostic usa `getAuthenticatedDbForRequest`" es trivial de internalizar + enforceable en code review. Documentado en `docs/gotchas/zone-aware-db-cookie-source.md`.
3. **Continuidad RLS preservada sin cambios SQL**: el `sub` inyectado por ambos branches es el mismo (ADR-0032 §6); `app.current_user_id()` retorna el mismo valor → 0 cambios en policies. Verificado empíricamente en T1.2.
4. **Separation of concerns intacta**: 
   - `getAuthenticatedDb` (Feature A) sigue siendo el primitivo Neon Auth puro.
   - `getAuthenticatedDbWithVerifier` (Feature C S4) sigue siendo el primitivo verifier-injectable puro.
   - `decideAuthBranch` es la decisión PURE testeable.
   - `getAuthenticatedDbForRequest` es la composición async que coordina ambos primitivos.
5. **Testabilidad**: 8 tests TDD PURE cubren todos los branches del dispatch sin tocar SDK/DB/headers. El integrador async se verifica por tipo/build + smoke (canon `update-default-locale.ts:13`).
6. **Forward-compat para V2**: si V2 agrega un tercer branch (bearer header en M2M API, magic link cookie en marketing, etc.), se extiende `AuthBranchDecision` con un nuevo `kind` + un nuevo case en el dispatch. Los primitivos siguen intactos.

### Neutras

1. **Costo de zone resolution repetido**: cada `getAuthenticatedDbForRequest` invocation repite zone resolution + lookup `app.lookup_place_by_domain` (en custom domain) + cookie read. En multi-helper Server Actions con 3 calls internas = 3× roundtrips. El SQL lookup es SECURITY DEFINER STABLE + prepared stmt cached al pool, costo ~1ms; aceptable V1. **V1.1 follow-up si telemetría demanda**: memoizar la decisión con `React.cache` dentro del helper (similar pattern al de `getPlaceForZone`).
2. **Ubicación del helper fuera de `src/shared/lib/sso/`**: vive en `src/shared/lib/` raíz porque es ortogonal al SSO (coordina entre 2 primitivos, no implementa SSO). Decisión consciente — el sub-módulo SSO mantiene su sub-cap LOC propio (1400, ADR-0032 §5) sin contaminarse con coordinator.

### Negativas

1. **`getAuthenticatedDb` directo sigue exportado** como capa primitiva — un developer futuro podría seguir consumiéndolo en un Server Action que pueda correr desde custom domain → bug repite. Mitigation: documentado en gotcha + invariante explícito en `db-for-request.ts` header + code review enforcement. Sin enforcement por tipo (lint custom rule sería over-engineering V1).
2. **2 fuentes de truth para "abrir DB autenticada"** en el codebase: el primitivo Feature A y el coordinator zone-aware. Acceptable porque cada uno tiene contrato distinto + use case distinto (primitivo para flows confinados a una zona; coordinator para flows zone-agnostic). Documentado in-code in-line.

## Plan de implementación

S11.2 ejecutada en 3 sub-sesiones con guardrails idénticos a S11.1 (production-grade, LOC estrictos, TDD obligatorio, tag por sub-sesión):

- **S11.2.A foundation** (commit `20b44e8`): crear `db-for-request-decision.ts` PURE (84 LOC) + `db-for-request.ts` integrator async (128 LOC) + `__tests__/db-for-request.test.ts` (137 LOC, 8 tests cubriendo todos los branches del dispatch + edge cases del cookie name + propagation de expectedHost). Sin tocar las 4 Server Actions todavía — pura foundation.
- **S11.2.B migration** (commit `bebfbf4`): migración mecánica de las 4 Server Actions. Dropear imports `requireSessionJwt` + `getAuthenticatedDb`; dropear param `token: string` de helpers internos; colapsar 2 `try/catch` (uno por `requireSessionJwt`, otro por `getAuthenticatedDb`) en uno solo alrededor de `getAuthenticatedDbForRequest` (`NoSessionError` cae al outer catch → UX-equivalente al error genérico previo). Sin tocar lógica de DOMINIO (SQL queries, validation, revalidate paths).
- **S11.2.C smoke + close** (commit `5e62f0d`): smoke production T1.2 owner-driven 3/3 VERDE + smoke server-side sanity 4/4 VERDE + write-back de evidencia en spec.md + push autorizado por el user + tag `baseline/feature-c-s11.2-done`.

**Save point**: `baseline/feature-c-s11.1-done` (commit pre-S11.2). Rollback total: `git reset --hard baseline/feature-c-s11.1-done`.

**LOC tracking final**:
- `src/shared/lib/db-for-request.ts`: 128 LOC (cap 300, dentro)
- `src/shared/lib/db-for-request-decision.ts`: 84 LOC (cap 300, dentro)
- `src/shared/lib/__tests__/db-for-request.test.ts`: 137 LOC (8 tests)
- 4 Server Actions: net change ≈ -40 LOC total (simplificación por dropear `requireSessionJwt` + param `token`)

## Pointers operacionales

- **Save point pre-S11.2**: `baseline/feature-c-s11.1-done` (commit post-S11.1 close-out).
- **Tag de cierre S11.2**: `baseline/feature-c-s11.2-done` = `17b5df5` (deploy production `dpl_2vhnAC2REbcjGgureWp85VRqpzj6`).
- **Gotcha postmortem**: `docs/gotchas/zone-aware-db-cookie-source.md` — documenta el síntoma confuso ("Server Action falla con `error/none` cuando se la invoca desde custom domain aunque el user esté autenticado") + el modelo mental correcto (la cookie Neon Auth NO existe en custom domain por RFC 6265 §5.4; usar el coordinator en cualquier Server Action zone-agnostic).
- **Código canónico**:
  - Coordinator integrator: `src/shared/lib/db-for-request.ts`.
  - PURE decision: `src/shared/lib/db-for-request-decision.ts`.
  - Tests PURE: `src/shared/lib/__tests__/db-for-request.test.ts`.
  - Primitivos consumidos: `src/shared/lib/db.ts:getAuthenticatedDb` (Feature A) + `src/shared/lib/sso/db-with-verifier.ts:getAuthenticatedDbWithVerifier` (Feature C S4).
- **4 Server Actions migradas** (consumers V1):
  - `src/features/place-settings/actions/update-default-locale.ts`
  - `src/features/custom-domain/actions/register-custom-domain.ts`
  - `src/features/custom-domain/actions/archive-custom-domain.ts`
  - `src/features/custom-domain-verification/actions/get-custom-domain-status.ts`
- **ADR canónica Feature C V1**: `docs/decisions/0032-custom-domain-sso-signed-ticket.md` — §6 documentó la continuidad RLS (`sub` matching cross-zone). ADR-0034 formaliza el dispatch que aprovecha esa continuidad.
- **Spec del feature con journey detallado**: `docs/features/custom-domain-sso/spec.md` §"S11.2 — fix Opción B" + §"T1.2 retry post-fix VERDE".
- **Precedent seam-split estructural** (PURE + impure paralelos): `src/app/(app)/place/[placeSlug]/_lib/get-place-for-zone.ts` (impuro) + `src/shared/lib/host-routing.ts` (PURE) — mismo principio aplicado por `db-for-request.ts` + `db-for-request-decision.ts`.
