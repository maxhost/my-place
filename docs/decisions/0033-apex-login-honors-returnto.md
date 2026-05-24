# 0033 — Apex login honra `?returnTo` para cerrar el cold-start SSO desde custom domain (Feature C S11.3)

- **Fecha:** 2026-05-23
- **Estado:** Aceptada
- **Alcance:** página apex `/[locale]/login` (Server Component) · slice `src/features/access/` (`AccessFlow` + `useAccessForm`) · sub-módulo `src/shared/lib/sso/` (helper PURE nuevo `validateLoginReturnTo` co-locado con `sso-state`) · `src/i18n/messages/{es,en,fr,pt,de,ca}.json` (sin cambio — la sesión es invisible al user, sin copy nueva) · sin impacto en DB/migrations/RLS/cookies/proxy/middleware/Feature B (`custom-domain-routing`) ni en el flow `sso-init → sso-issue → sso-redeem` (los 3 handlers ya emiten `returnTo` correctamente, ver `src/app/api/auth/sso-issue/route.ts:145-153`)
- **Habilita:** que el cold-start SSO desde custom domain (M1 — visitor anónimo navega a `nocodecompany.co/settings` sin sesión apex previa) aterrice transparentemente en el path original solicitado en lugar de descartar el contexto y mandar al Hub canónico. Cierra bug T1.3 detectado en smoke owner-driven 2026-05-23 post-S11.2 (las 4 Server Actions ya funcionan zone-aware; el flow SSO completo ya mintea cookie local válida; el único gap restante es el login apex que ignora `?returnTo`).
- **Refina parcialmente:** ADR-0032 §2 step 2 (`sso-issue` emite redirect a `https://place.community/{locale}/login?returnTo=<sso-issue URL completa>` — el comportamiento ya documentado funciona; este ADR cierra el contrato del lado consumidor del `returnTo` que ADR-0032 asumió implícito). Sin cambiar el flow técnico V1 ni el shape de los 4 endpoints `/api/auth/sso-*`. No supersede ninguna ADR previa.
- **No supersede:** ADR-0001 (topología "dos mundos") · ADR-0008 (vía "Acceso" account-first, ADR-0009 cierre) · ADR-0014/0015/0016/0019 (paradigma vertical-slice del `access` slice) · ADR-0031 (Feature B host routing) · ADR-0032 (Signed Ticket pattern, §§1-12 intactos).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0032 (2026-05-22) cerró Feature C V1: silent SSO cross-domain desde custom domain via Signed Ticket pattern (4 endpoints `/api/auth/sso-{init,issue,redeem,jwks}` + cookie `__Host-place_sso_session` 7d emitida por el redeem en custom domain). Post-deploy 2026-05-23 dos sub-sesiones cerraron bugs descubiertos en smoke production:

- **S11.1** (ADR-0032 §12 "Same-registrable-domain redirect policy"): jose v6 hardcodea `redirect: 'manual'` en el fetcher JWKS, chocando con redirect platform-level Vercel apex→www. Fix `customFetch` Symbol option con policy same-registrable-domain + https + ≤3 hops. Cookie `__Host-place_sso_session` empezó a setearse correctamente con `sub=<neon_auth_user_id>` matcheando RLS.
- **S11.2** (sin ADR independiente — close documentado en `spec.md` §"S11.2 fix Opción B"): 4 Server Actions broken-on-custom-domain por RFC 6265 cookie scope. Fix Opción B: nuevo helper coordinador `getAuthenticatedDbForRequest` zone-aware que detecta `HostZone` del request + lee la cookie correcta + dispatcha al primitivo apropiado (`getAuthenticatedDb` Neon Auth en apex, `getAuthenticatedDbWithVerifier` SSO local en custom domain). 4 Server Actions migradas (`update-default-locale`, `register-custom-domain`, `archive-custom-domain`, `get-custom-domain-status`).

Post-S11.2 smoke owner-driven verde T1.2 (3/3): los 3 paths owner-driven en custom domain (`/settings` form populated + `/settings/domain` dominio configurado + cambiar locale persiste) pasaron. **Sub-sesión M1 del smoke** (cold-start sin sesión apex previa: navegación incógnita directa a `nocodecompany.co/settings`) reveló un cuarto bug que ni T1.1 ni T1.2 podían detectar — porque ambos partían de owner ya logueado en apex.

### Evidencia del bug (smoke M1, 2026-05-23 post-S11.2)

User abre ventana de incógnito + navega a `https://nocodecompany.co/settings`:

1. Page sin sesión local SSO → silent SSO trigger S10 → `redirect('/api/auth/sso-init?returnTo=/settings')`.
2. `sso-init` setea `__Host-place_sso_state` + redirect a apex `sso-issue` con `returnTo=/settings` preservado en query.
3. `sso-issue` detecta `getSessionJwt() === null` (no hay sesión Neon Auth) → `redirectToApexLogin(requestUrl, defaultLocale)` (`src/app/api/auth/sso-issue/route.ts:145-153`).
4. `redirectToApexLogin` construye correctamente `continueUrl = ${apexBaseUrl()}${requestUrl.pathname}${requestUrl.search}` (URL completa al `sso-issue` con todos los query params incluyendo `returnTo=/settings`) + `loginUrl.searchParams.set("returnTo", continueUrl)` + redirect 302 a `https://www.place.community/es/login?returnTo=https%3A%2F%2Fplace.community%2Fapi%2Fauth%2Fsso-issue%3Faud%3Dnocodecompany.co%26state%3DGE2_7CxDkFgcu7Se_mPG0999K7vDO9_lZTlieC_VhGY%26nonce%3DGuza_5HdTWhldcncL7fE3w%26returnTo%3D%252Fsettings`.
5. User aterriza en login apex. Loguea con email + password válidos.
6. **OBSERVADO**: navega a `https://app.place.community/es` (Hub canónico). **ESPERADO**: navegar al `returnTo` (URL del `sso-issue`) para resumir el flow → ticket emitido → redeem en custom domain → cookie local SSO seteada → aterriza en `nocodecompany.co/settings`.

### Smoking guns (5 ubicaciones de código, evidencia pre-fix)

| # | Ubicación | Cita pre-fix | Patología |
|---|---|---|---|
| 1 | `src/app/(marketing)/[locale]/login/page.tsx:22` | `type Props = { params: Promise<{ locale: string }> };` | Tipo de props NO incluye `searchParams` — el `?returnTo` enviado por `sso-issue` es invisible al Server Component (Next.js App Router sólo expone search params si se los pide en el tipo). |
| 2 | `src/app/(marketing)/[locale]/login/page.tsx:38-41` | `const token = await getSessionJwt(); if (token !== null) { redirect(\`https://app.place.community/${locale}/\`); }` | Guard "ya logueado" redirige a Hub canónico hardcoded — descarta cualquier `returnTo` aunque viniera en query. |
| 3 | `src/app/(marketing)/[locale]/login/page.tsx:81-88` | `<AccessFlow labels={labels} auth={auth} locale={locale} termsHref=… privacyHref=… homeHref=… />` | Page no propaga ningún `returnTo` (ni puede — no lee `searchParams`) al `AccessFlow`. El componente cliente no tiene visibilidad del intent. |
| 4 | `src/features/access/ui/access-flow.tsx:52` | `onSuccess: () => navigate(\`https://app.place.community/${locale}/\`)` | El callback de submit exitoso navega hardcoded al Hub canónico. Aun si `AccessFlow` recibiera `returnTo`, la línea 52 ignora cualquier override. |
| 5 | `src/features/access/ui/use-access-form.ts:23,76` | `onSuccess: () => void;` y `if (res.status === "ok") opts.onSuccess();` | La superficie del hook es `onSuccess: () => void` sin args ni surface para `returnTo`. La máquina de estado dispara `onSuccess()` literal en submit exitoso sin contexto del destino. |

Los 5 puntos forman una cadena coherente: la página NO lee `searchParams.returnTo` (smoking gun #1+#3), el guard "ya logueado" tampoco lo respeta (#2), y el componente cliente está cableado para descartarlo aun si llegara (#4+#5). El bug NO es del SSO flow (que emite `returnTo` correctamente) ni del componente Hub (que sólo recibe navegaciones), sino del **consumidor del `returnTo` en el login apex**.

### Scope del bug

- **M1 (cold start, target del fix)**: visitor anónimo → custom domain `/settings` → silent SSO → apex login → loguea → **descarta `returnTo`**. ROJO en smoke M1 2026-05-23.
- **M2 (sesión apex activa, cookie local SSO expirada)**: visitor con sesión Neon Auth válida → custom domain `/settings` → silent SSO → `sso-issue` detecta sesión apex → emite ticket directo → redeem → cookie local seteada. **Nunca visita login apex** → bug no se materializa. VERDE en smoke T1.2 2026-05-23.
- **M3 (ambos expirados, equivalente a M1)**: cold start con cookie Neon Auth expirada. Mismo path que M1 — bug se materializa idéntico. No probado independiente (subsumido por M1).
- **Otros consumers del login apex pre-existentes** (signup desde landing, login directo desde apex marketing): no afectados — la ruta natural post-auth ES el Hub canónico, el behavior actual es correcto para ellos. El fix **respeta este default**: cuando `?returnTo` no viene en query → comportamiento idéntico al actual (Hub canónico).

### Por qué este bug no se detectó antes

ADR-0032 §2 step 2 documentó que `sso-issue` "redirige a `https://place.community/{locale}/login?returnTo=<encoded sso-issue URL>` (preserva flow tras login)". El verbo "preserva" asumía que el login apex consumiría el `returnTo`. Esa asunción NO era válida — el login apex pre-existe Feature C, fue construido en S9 del Hub V1 (ADR-0008/0009) para el flow account-first, sin contemplar redirect-after-login.

Feature C nunca exercitó M1 hasta el smoke owner-driven post-S11.2: T1.1 partía de owner ya logueado en apex (silent SSO mintea ticket sin pasar por login apex); T1.2 también. Sólo el cold-start incógnita expone el gap. El bug es **pre-existing en el login apex**; Feature C lo *expone* sin causarlo (es la primera feature que enviaría users a `/login?returnTo=…` esperando que se honre).

## Decisión

**Cerrar el contrato del lado consumidor del `?returnTo` en el login apex**: la página `/[locale]/login` lee `searchParams.returnTo`, lo valida con un helper PURE nuevo (`validateLoginReturnTo`), y propaga el destino sanitizado a `AccessFlow`. El componente cliente honra el override en el guard "ya logueado" Y en el callback `onSuccess`. Si `returnTo` ausente o inválido → comportamiento backwards-compat (Hub canónico hardcoded actual).

**Production-grade, no quick-fix**. Helper PURE separado para testabilidad sin `next/headers`/SDK/DB (12 TDD tests cubriendo allowlist de paths permitidos + reglas same-registrable-domain HTTPS + edge cases). Wire-up minimal en page + AccessFlow + useAccessForm sin tocar otras piezas (login Server Action, signup Server Action, terms/privacy pages, Hub).

### Estructura del fix (4 archivos código + 3 archivos tests)

```
src/shared/lib/sso/
  validate-login-return-to.ts             ← NUEVO helper PURE (~80 LOC)
  __tests__/
    validate-login-return-to.test.ts      ← NUEVO 12 tests (~150 LOC)

src/app/(marketing)/[locale]/login/
  page.tsx                                 ← M (92 → ~110 LOC)
                                              + lee searchParams.returnTo
                                              + valida con validateLoginReturnTo
                                              + propaga returnTo a AccessFlow
                                              + guard "ya logueado" honra returnTo

src/features/access/ui/
  access-flow.tsx                          ← M (227 → ~240 LOC)
                                              + prop returnTo?: string
                                              + onSuccess respeta returnTo si presente, sino Hub canónico

  use-access-form.ts                       ← M (120 → ~125 LOC)
                                              + opts.onSuccess: (override?: string) => void
                                                (firma extendida backwards-compat)

  __tests__/
    access-flow.test.tsx                   ← M (3 tests existentes + 2 nuevos)
                                              + nuevo: respeta returnTo cuando viene en props
                                              + nuevo: sin returnTo → Hub canónico (regression)
```

**LOC tracking**: page 92→~110 (+18), access-flow 227→~240 (+13), use-access-form 120→~125 (+5), validate-login-return-to.ts ~80 nuevo, tests ~150+~40 nuevos. Total ~306 LOC nuevo (~120 código + ~186 tests). Sub-cap `shared/lib/sso/` 1100 → ~1180 LOC (queda dentro del cap; ADR-0032 §5 addendum tras S11.1 estableció sub-cap 1100; S11.3 lo lleva a 1180 — bumpear cap a 1200 en S11.3.B como addendum-line si necesario, single-line ADR mod sin sub-versión separada).

### Contrato del helper PURE `validateLoginReturnTo`

```typescript
// src/shared/lib/sso/validate-login-return-to.ts
//
// Helper PURE que decide si una URL `?returnTo` recibida por la página apex
// de login es safe de honrar tras autenticación. Sin `next/headers`, sin
// fetches, sin SDK, sin DB — testeable directo con vitest.
//
// Policy V1 (intersección de reglas validadas vs S11.1 same-registrable-domain
// precedent + open-redirect best practice):
//
//   1. ABSOLUTE URLs: deben matchear (a) https + (b) same-registrable-domain
//      como el apex (`place.community`). Allowlist explícito del path:
//      `/api/auth/sso-issue` O `/api/auth/sso-init` ÚNICAMENTE. Cualquier
//      otro path absoluto same-registrable-domain → rechazo (defense in depth:
//      el único consumer V1 es Feature C SSO; ampliar requiere ADR explícita).
//
//   2. RELATIVE PATHs: aceptados si empiezan con `/` + no contienen `//`
//      (protocol-relative) + no contienen scheme (`:` antes del primer `/`).
//      El path retorna preservado. Permite reusar el componente login para
//      futuros flows account-first internos del apex sin tocar este helper.
//
//   3. Cualquier otro input (null, undefined, empty, scheme-relative,
//      attacker domain absoluto, paths con scheme injection, etc.) → `null`
//      (caller usa fallback Hub canónico).
//
// PRECEDENT: `src/shared/lib/sso/sso-jwks-fetcher.ts` (S11.1) usa
// `getRegistrableDomain` + `isSameRegistrableDomain` para la redirect policy
// del fetch JWKS — co-localizamos esta validación con el mismo principio
// (registrable domain matching como invariante de "intra-Place trust").

export function validateLoginReturnTo(
  raw: string | null | undefined,
  apexHost: string,
): string | null;
```

**12 tests TDD canónicos** (RED → GREEN antes de wire-up):

1. `null` → `null` (default sin returnTo).
2. `undefined` → `null`.
3. Empty string → `null`.
4. Whitespace-only → `null`.
5. Relative path simple (`/settings`) → `/settings` (preservado).
6. Relative path con query+hash (`/foo?x=1#y`) → preservado.
7. Protocol-relative (`//attacker.com`) → `null`.
8. Scheme-relative no-http (`javascript:alert(1)`) → `null`.
9. Absolute attacker domain (`https://attacker.com/settings`) → `null`.
10. Absolute same-registrable-domain + path allowlist (`https://place.community/api/auth/sso-issue?aud=...`) → preservado.
11. Absolute same-registrable-domain + path NO en allowlist (`https://place.community/admin`) → `null`.
12. Absolute same-registrable-domain HTTP (no HTTPS) → `null`.

### Wire-up `page.tsx` (cambios canónicos)

```typescript
// Tipo de props extendido para que Next.js exponga search params:
type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string }>;
};

// Lectura + validación del returnTo:
export default async function LoginPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { returnTo: rawReturnTo } = await searchParams;
  setRequestLocale(locale);

  const safeReturnTo = validateLoginReturnTo(rawReturnTo, APEX_HOST);

  const token = await getSessionJwt();
  if (token !== null) {
    // Guard "ya logueado": si vino `returnTo` válido, honrar (cierra cold-start
    // SSO M2 hipotético: user vuelve manual a login con sesión apex activa).
    // Sin returnTo → Hub canónico (comportamiento backwards-compat pre-S11.3).
    redirect(safeReturnTo ?? `https://app.place.community/${locale}/`);
  }

  // ... (resto idéntico, salvo propagación del returnTo al AccessFlow):
  return (
    <main id="contenido">
      <AccessFlow
        labels={labels}
        auth={auth}
        locale={locale}
        returnTo={safeReturnTo ?? undefined}
        termsHref={`/${locale}/terminos`}
        privacyHref={`/${locale}/privacidad`}
        homeHref={`/${locale}`}
      />
    </main>
  );
}
```

### Wire-up `AccessFlow` (cambios canónicos)

```typescript
export function AccessFlow({
  labels,
  auth,
  locale,
  returnTo,                      // NUEVO prop opcional
  termsHref,
  privacyHref,
  homeHref,
  navigate = defaultNavigate,
}: {
  labels: AccessLabels;
  auth: AccessSubmit;
  locale: string;
  /** Override del destino post-auth. Validado por validateLoginReturnTo en la
   *  page (NUNCA confiar en este input client-side sin validación previa). */
  returnTo?: string;
  termsHref: string;
  privacyHref: string;
  homeHref: string;
  navigate?: (url: string) => void;
}) {
  const a = useAccessForm({
    labels,
    auth,
    onSuccess: () => {
      // Si la page propagó returnTo (ya validado server-side), honrar.
      // Sino → Hub canónico (default backwards-compat para flows pre-Feature-C
      // como signup desde landing apex).
      navigate(returnTo ?? `https://app.place.community/${locale}/`);
    },
  });
  // ... (resto idéntico)
```

### Wire-up `useAccessForm` (cambio minimal)

La superficie del hook NO se extiende — `onSuccess: () => void` queda igual. La decisión `returnTo vs Hub canónico` vive en el componente `AccessFlow` (closure sobre `returnTo`). El hook permanece agnóstico del destino — pattern actual respetado, separación de concerns intacta.

```typescript
// use-access-form.ts: cero cambios en la firma del hook.
// El callback opts.onSuccess sigue siendo `() => void`. AccessFlow lo construye
// con la closure correcta sobre returnTo.
```

**Beneficio del approach**: minimal blast radius (3 archivos código + 1 nuevo helper), backwards-compat preservada (sin returnTo → behavior pre-S11.3 idéntico), separation of concerns intacta (validation = shared/lib helper PURE, decision = page Server Component, propagation = component prop, execution = closure sobre prop).

## Alternativas rechazadas

### 1. Hardcodear `redirect(returnTo)` en `loginAction` Server Action (descartada)

`loginAction` (Server Action en `auth-actions.ts`) podría leer cookies/headers para detectar `returnTo` y disparar `redirect()` server-side. Rechazada:

- **Server Actions Better Auth/Neon Auth NO devuelven redirect interno** — el patrón canónico es retornar `{status: "ok"}` y dejar al cliente navegar (verificado en `src/features/access/auth-actions.ts:loginAction`). Cambiar este contrato requiere ADR aparte + refactor cross-cutting.
- **`returnTo` viene en URL del browser, NO en form data ni cookie**: el Server Action no tiene visibilidad nativa del search param sin sniffing `headers().get('referer')` (frágil).
- **Mismo bug existe en signup, login, futuras forms**: la fix correcta es vivir en el lugar donde el `returnTo` SÍ existe naturally — el Server Component page que recibe `searchParams`.

### 2. Reescribir flow Feature C para que `sso-issue` mintee tickets sin sesión apex previa (no aplicable)

Imposible por design: el ticket es la *prueba de identidad del user en apex* que el custom domain redime. Sin sesión apex previa no hay `sub` que firmar. El login apex ES el paso necesario del cold-start M1. La pregunta es sólo si redirige al user al `returnTo` correcto post-login o si lo manda a Hub.

### 3. Cookie de "intended destination" pre-login (over-engineering)

Setear cookie `__Host-place_pending_return_to` cuando `sso-issue` redirige a login, leer en login submit, borrar tras consumir. Rechazada:

- **Doble state machine** (cookie + query) sin beneficio — el query `?returnTo` ya viaja en URL del browser.
- **Stale cookies cross-flow**: si user abre dos pestañas con flows distintos, las cookies se pisan.
- **Más LOC, más superficie de bugs, sin ganancia funcional vs leer searchParams**.

### 4. Mover el silent SSO trigger al middleware en lugar del page (out of scope — riesgo regression)

Una alternativa estructural sería disparar el silent SSO desde un middleware/proxy nivel para evitar el round-trip via login apex cuando hay sesión apex válida. Out of scope S11.3:

- **El bug T1.3 es del lado consumer del `returnTo`, no del trigger del silent SSO**. La fix es ortogonal a dónde se dispara el silent SSO.
- **Cambiar el proxy/middleware = riesgo de tocar Feature B (host routing)** que está estable production.
- **V2 follow-up posible** si telemetría muestra que el round-trip apex login es UX-costoso para M1. V1: el round-trip es aceptable (M1 es first-touch, single-time per browser); el fix actual ya lo hace transparente post-login.

### 5. Allowlist abierto (relative paths sin restricción + cualquier same-registrable-domain HTTPS) en `validateLoginReturnTo` (rechazada — over-permissive V1)

V1 conservador: allowlist explícito de path absolutos (`/api/auth/sso-{issue,init}` ÚNICAMENTE) + relative paths abiertos. Justificación:

- **Único consumer V1 confirmado**: Feature C SSO emite `?returnTo=https://place.community/api/auth/sso-issue?...` desde `redirectToApexLogin`. Documentado en `src/app/api/auth/sso-issue/route.ts:145-153`.
- **Defense in depth**: allowlist explícito previene que un atacante registre algún future redirect intra-Place que sirva como vector (e.g. si V2 agrega `/admin/impersonate` y olvida sanitización, el login apex no se convierte en redirect helper).
- **Relative paths abiertos**: justificado porque cualquier path relativo aterriza en el apex mismo (same-origin del login) — no es vector de open-redirect cross-domain. El bound es la propia confianza en routes del apex (que ya pasa por su propio auth/RLS).
- **Ampliar el allowlist V2** requiere ADR explícita + actualización del helper + test nuevo. Cost-of-mistake asimétrico (open-redirect = phishing vector severo).

## Consecuencias

### Positivas

1. **M1 cold-start SSO funciona end-to-end transparente** post-fix: visitor anónimo navega a `nocodecompany.co/settings` → silent SSO → apex login → submit → returnTo al `sso-issue` → ticket emitido → redeem en custom domain → cookie local SSO seteada → aterriza en `nocodecompany.co/settings` con sesión local. Cierra el último gap funcional de Feature C V1.
2. **Backwards-compat**: flows pre-Feature-C (signup desde landing, login directo desde apex marketing) sin returnTo siguen yendo al Hub canónico — comportamiento idéntico al pre-S11.3.
3. **Reusable**: el contrato `?returnTo` queda disponible para future flows account-first del apex (e.g. invites, password reset, future ADR-0008 expansion). El helper PURE `validateLoginReturnTo` es el single point of validation.
4. **Defense in depth**: open-redirect prevention vía allowlist explícito + same-registrable-domain check + HTTPS-only. Precedente de S11.1 (`sso-jwks-fetcher` same-registrable-domain policy) extendido coherentemente al login.
5. **Testabilidad**: helper PURE = 12 TDD tests sin mocks. Wire-up testeable con RTL (2 tests nuevos cubriendo respeta-returnTo + regression Hub canónico sin returnTo). Total ~14 nuevos tests.

### Neutras

1. **Sub-cap `shared/lib/sso/`**: actual 1100 LOC (post-S11.1) → ~1180 post-S11.3.B. Dentro del cap si lo bumpeamos a 1200 en addendum single-line en S11.3.B (mismo patrón S3.5 → S11.1 bumps de 800 → 1000 → 1100). Documentar en ADR-0032 §5 addendum como bump puntual sin sub-versión separada.
2. **Tipo de props del page**: agregar `searchParams: Promise<{returnTo?: string}>` cambia el contrato pero es additive (los call sites Next.js manejan automáticamente). Sin riesgo de TS errors en otros consumidores (el page es entry-point, no se importa de otros lados).

### Negativas

1. **Surface adicional de bugs en el page del login**: agregar `searchParams` significa que cualquier futuro query param se vuelve potencialmente reachable. Mitigation: el page solo extrae `returnTo` explícitamente, ignorando el resto. El tipado en TS lo refleja (`{returnTo?: string}` no `Record<string, string>`).
2. **Validation policy es V1 conservadora**: si V2 necesita expandir el allowlist (e.g. agregar `/api/auth/oauth-callback`), requiere modificación del helper + test + posible ADR. Acceptable tradeoff (cost-of-mistake asimétrico).

## Plan de implementación

S11.3 ejecutada en 4 sub-sesiones con guardrails idénticos a S11.2 (production-grade, LOC estrictos, parallel agents disjoint, locked files con verificación diff, TDD obligatorio, tag por sub-sesión para rollback granular):

- **S-1 Save Point** (✅ DONE): tag `baseline/pre-s11.3-fix-returnto` = `17b5df5` (= S11.2 close). Suite verde verificada (typecheck + lint + 682/682 tests + build). Comando rollback total: `git reset --hard baseline/pre-s11.3-fix-returnto`.
- **S11.3.A** (este commit): Docs canónica — ADR-0033 + spec write-back §"T1.3 inicial ROJO + S11.3 fix" + plan-sesiones §"S11.3.A→D rows + desviación #5" + gotcha `apex-login-returnto-honored.md` + README updates. Single owner Maxi sequential (5-6 docs cohesivos, sin agentes — drift improbable, scope docs-only).
- **S11.3.B**: helper PURE `validateLoginReturnTo` + 12 TDD tests + addendum ADR-0032 §5 bump sub-cap 1100 → 1200. Single owner Maxi (código de seguridad — same-registrable-domain validation crítica, sin paralelización).
- **S11.3.C**: Wire-up page.tsx + AccessFlow + useAccessForm (no se toca — superficie hook intacta) + 2 tests RTL nuevos + ajuste de 3 tests existentes. Single owner Maxi (3 archivos cohesivos, paralelización innecesaria para ≤3 files).
- **S11.3.D**: Smoke M1 owner-driven + docs close + push autorizado bundle B+C+D + smoke production retry M1 retry VERDE + final write-back. Single owner Maxi.

Detalle ejecutivo (objetivos por sesión, locked files, parallel agents decisions, pre/post-commit checklist, LOC tracking) en `docs/features/custom-domain-sso/plan-sesiones.md` §"Mapeo S11.3.A → S11.3.D".

## Pointers operacionales

- **Save point pre-S11.3**: tag `baseline/pre-s11.3-fix-returnto` = `17b5df5` (= `baseline/feature-c-s11.2-done`).
- **Gotcha postmortem**: `docs/gotchas/apex-login-returnto-honored.md` (creado en S11.3.A) — documenta el síntoma confuso ("loguear funciona pero descarta el destino") + el modelo mental correcto (returnTo es contrato del lado consumer del login, no del SSO flow).
- **ADR canónica V1 Feature C**: `docs/decisions/0032-custom-domain-sso-signed-ticket.md` — §2 step 2 documentó la emisión correcta de returnTo desde `sso-issue`; este ADR-0033 cierra el contrato del lado consumer.
- **Spec del feature**: `docs/features/custom-domain-sso/spec.md` §"T1.3 inicial ROJO" + §"S11.3 fix" (write-back en S11.3.A) + §"T1.3 retry post-fix VERDE" (write-back en S11.3.D post-smoke).
- **Plan ejecutivo single source of truth**: `docs/features/custom-domain-sso/plan-sesiones.md`.
- **Precedent same-registrable-domain policy**: `src/shared/lib/sso/sso-jwks-fetcher.ts` (S11.1) — co-localizamos `validateLoginReturnTo` en mismo sub-módulo con mismo principio (registrable domain matching como invariante intra-Place).
