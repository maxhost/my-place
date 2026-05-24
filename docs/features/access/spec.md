# Vía "Acceso" (slice `access`) — Spec

> _Spec creado 2026-05-23 (DS S4, post-Feature C V1 cerrada). **Status: V1 implementado y deployed** — el slice está vivo en producción cubriendo el login form del apex (`place.community/{locale}/login`) y el signup account-first reusable desde `/crear` (place-first wizard, modo Cuenta). Decisiones canónicas en [ADR-0008](../../decisions/0008-dos-vias-de-entrada.md) (dos vías de entrada), [ADR-0009](../../decisions/0009-cierre-subpuntos-adr-0008.md) (cierre sub-puntos), [ADR-0014](../../decisions/0014-split-onboarding-place-creation-access.md) (split del onboarding en 3 slices), [ADR-0018](../../decisions/0018-jwt-neon-auth-y-place-first-two-phase.md) (signup sólo identidad; `ensureAppUser` difiere a TX1 del create authed) y [ADR-0033](../../decisions/0033-apex-login-honors-returnto.md) (login honra `?returnTo` para cerrar cold-start SSO M1). Simplificación cross-slice canónica en [`docs/features/inbox/spec.md`](../inbox/spec.md) §"Auth + redirects" (S5c del Hub V1: elimina la elección post-auth "create/join"; el Hub cubre esos flujos)._

## Contexto

El producto presenta **dos vías de entrada** (ADR-0008): la CTA pública place-first ("Crear tu place" → wizard 3 pasos) y la vía "Acceso" (login form account-first). Esta spec cubre la segunda: el formulario que ejerce `email + password` para login / signup, montado en `place.community/{locale}/login`. Es el único path canónico para que un visitor anónimo cree o use una sesión Neon Auth en el apex.

ADR-0014 (2026-05-19) separó el monolito original `onboarding` en tres slices vertical-slice acíclicos: **`place-wizard`** (UI puro multi-step del wizard place-first), **`place-creation`** (Server Action `createPlaceAction` + tipo canónico `PlaceFirstCredentials`) y **`access`** (este slice: form login/signup + Server Actions `loginAction`/`signUpAccountAction`). El criterio: cada slice tiene un solo motivo para cambiar y una superficie pública mínima. `access` es feature→feature **unidireccional** hacia `place-creation` (lee sólo el tipo `PlaceFirstCredentials`), nunca cita `place-wizard`. Esto sostiene el invariante del paradigma (`CLAUDE.md` §Paradigma).

Post-S5c del Hub V1 (2026-05-19, `docs/features/inbox/spec.md` §"Auth + redirects"), el slice se simplificó: la pantalla post-auth de "elegir qué hacer" ("crear un place" / "unirme") **se eliminó**. El Hub canónico (`app.place.community/{locale}/`) ya cubre esos flujos con CTAs del estado vacío ("Crear un lugar" → `/crear?from=hub` → wizard authed; "Unirme" deshabilitado per ADR-0009). Eliminar la elección dropeó 7 keys i18n + la dependencia legacy de `place-wizard` desde `access`, dejando el slice acíclico puro.

Post-Feature-C V1 (2026-05-23, ADR-0032/0033), el slice ganó una responsabilidad adicional menor pero crítica para cerrar el cold-start SSO M1: el form acepta un prop opcional `returnTo` que la page apex propaga sólo si pasa el helper PURE `validateLoginReturnTo` (allowlist explícito de paths absolutos + relative paths abiertos). El hook `useAccessForm` quedó **intacto**; el cambio vive 100% en el closure del `onSuccess` que arma `AccessFlow`. Detalle en ADR-0033 y `docs/features/inbox/spec.md` §"Auth + redirects — addendum post-S11.3".

## Slice

**Nombre canónico**: `access` (carpeta `src/features/access/`).

**Estructura** (5 archivos runtime + 1 archivo de tests, LOC medidos `wc -l` 2026-05-23):

```
src/features/access/
├── auth-actions.ts            #  61 LOC  Server Actions: loginAction + signUpAccountAction
├── public.ts                  #  15 LOC  Barrel: exports estables consumidos por las pages
└── ui/
    ├── access-flow.tsx        # 240 LOC  Componente CLIENTE (form + tabs login/signup)
    ├── access-labels.ts       #  65 LOC  Tipos: AccessLabels, AccessSubmit, AccessResult, AccessCredentials
    ├── use-access-form.ts     # 120 LOC  Máquina de estado del form (separada del render)
    └── __tests__/
        └── access-flow.test.tsx  # 235 LOC  jsdom + RTL + userEvent, fakes inyectados (9 casos)
```

**LOC totales**: 501 runtime + 235 tests = **736 LOC**. Cap feature 1500 → ~50% headroom positivo. Ningún archivo cerca de 300.

**Public surface** (`public.ts`, paradigma vertical-slice: las pages importan SÓLO de acá):

```typescript
export { AccessFlow } from "./ui/access-flow";
export type { AccessLabels, AccessSubmit } from "./ui/access-labels";
export { loginAction, signUpAccountAction } from "./auth-actions";
```

**Dependencies**:

- `@/shared/lib/auth` (`getAuth()`): wrapper Neon Auth, único punto de contacto con el provider desde el slice.
- `@/features/place-creation/public` (`PlaceFirstCredentials`): tipo canónico de credenciales del signup, **único acoplamiento feature→feature**. Unidireccional, sin ciclo (ADR-0014/0015).
- React 19 primitives en el cliente: `useState`, `useId`, `useRef`. Sin librerías de form externas (decisión: el form es chico, la máquina cabe en 120 LOC; agregar `react-hook-form` o similar sería ceremonia).

**Sin dependencias internas**: el slice NO toca DB directo, NO llama `lookupPlaceByDomain` ni helpers SSO, NO importa de `inbox`/`settings`/`custom-domain-*`. Su única superficie cross-system es Neon Auth vía `getAuth()`.

**Consumers V1** (sólo dos pages del apex marketing):

1. **`src/app/(marketing)/[locale]/login/page.tsx`** — consumer completo. Monta `<AccessFlow>` con `loginAction` + `signUpAccountAction` cableados como puertos `auth`; pasa `locale` + `returnTo` (validado por `validateLoginReturnTo`, ADR-0033) + textos traducidos del namespace `access`.
2. **`src/app/(marketing)/[locale]/crear/page.tsx`** — consumer parcial. Reusa **sólo** `signUpAccountAction` como prop `onCreateAccount` del `<PlaceWizard>` en modo place-first (anónimo, 3 pasos). En modo authed (`?from=hub`) no se usa porque la sesión ya existe. Reuso por puerto, sin acoplamiento al form.

## Flow del slice

El slice contiene UN form con DOS modos (`login` / `signup`) seleccionables por tabs. La página consumer monta el form, pasa los Server Actions vivos como puertos y queda en el destino post-auth (cross-subdomain navigate al Hub o al destino `returnTo` validado).

### Login (modo default)

```
1. User aterriza en place.community/{locale}/login.
2. Page Server Component verifica sesión apex (`getSessionJwt`):
   - Si hay token Y returnTo válido → redirect(returnTo).        ← ADR-0033
   - Si hay token Y sin returnTo → redirect("https://app.place.community/{locale}/").
   - Si null → renderiza <AccessFlow> en modo login default.
3. User completa email + password → submit.
4. `useAccessForm.handleSubmit()` toma el lock (submittingRef anti-doble-click) y
   llama `auth.login(email, password)` (puerto = `loginAction` Server Action vivo).
5. `loginAction` → `getAuth().signIn.email({email, password})`:
   - OK → cookie Neon Auth `Domain=.place.community` seteada en la respuesta.
     Retorna `{status: "ok"}`.
   - Error o exception → retorna `{status: "login_failed"}`. No expone el SDK.
6. Form recibe ok → dispara `onSuccess()` (closure armado por AccessFlow):
   - Si returnTo viene de la page → navigate(returnTo).          ← ADR-0033
   - Sin returnTo → navigate("https://app.place.community/{locale}/").
7. Browser sigue el navigate (window.location.assign), la cookie apex viaja
   cross-subdomain, el Hub renderiza autenticado.
```

### Signup (tab "Crear cuenta")

```
1. User aterriza en /login y clickea tab "Crear cuenta".
2. Form muestra 3 campos adicionales: displayName + checkbox términos.
3. User completa email + password (≥8) + displayName + acepta términos → submit.
4. `useAccessForm.handleSubmit()` llama `auth.signUp({email, password, displayName})`
   (puerto = `signUpAccountAction` Server Action vivo).
5. `signUpAccountAction` → `getAuth().signUp.email({email, password, name})`:
   - OK + `data.token` presente → cookie Neon Auth seteada en la respuesta.
     Retorna `{status: "ok"}`. **NO crea `app_user`** (ADR-0018: difiere a TX1
     del create authed en la request SIGUIENTE, idempotente).
   - Error / sin `data.token` / exception → retorna `{status: "signup_failed"}`.
6. ok → mismo navigate cross-subdomain al Hub (o `returnTo` validado).
7. La cuenta queda en estado "cuenta sin place" (ADR-0008 §4) — legítimo:
   el Hub renderiza el estado vacío con CTAs "Crear un lugar" / "Unirme".
```

### Estado vivo del form (`useAccessForm`)

Hook separado del render por el cap de archivo (`access-flow.tsx` ya en 240 LOC) y para testear comportamiento sin acoplarse al JSX. Expone:

- **Estado controlado**: `email`, `password`, `displayName`, `terms` (boolean), `mode` (`login` | `signup`).
- **Touched-on-blur**: `emailTouched`, `passwordTouched`, `displayNameTouched`. Los errores no se muestran hasta el primer blur del campo — evita ruido inicial.
- **Validez derivada**:
  - `emailValid` → regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` sobre `email.trim()`.
  - `passwordValid` → `password.length >= 8`.
  - `displayNameValid` → `trim().length` entre 1 y 80.
- **canSubmit**: AND de los validators según mode (signup además requiere `terms` checked + displayName válido).
- **Idempotencia**: `submittingRef` (ref, no state) bloquea reentradas — mismo patrón que `usePlaceWizard` (place-wizard S8b). Doble click no dispara dos auths (testeado: `idempotencia: doble click no dispara dos autenticaciones`).
- **Notices**: `noticeText` derivado de `login_failed` / `signup_failed` con copy desde `labels` (i18n centralizada en la page, no en el hook).
- **switchMode(next)**: limpia notice al cambiar tab; **preserva** campos email/password (el user no pierde lo escrito al alternar).
- **onSuccess** (callback inyectado por `AccessFlow`): closure sobre `returnTo`. La decisión "returnTo vs Hub canónico" vive en `AccessFlow`, **no en el hook** — hook agnóstico del destino (separation of concerns; documentado en `access-flow.tsx:62-67` + ADR-0033 §"Wire-up `useAccessForm`").

### Borde cross-system (`auth-actions.ts`) — calmo y honesto

Los Server Actions son el ÚNICO punto del slice que toca el SDK Neon Auth. Avisos cozytech (`docs/producto.md` § tono):

- **login fallido**: causa abrumadora = credenciales inválidas. Aviso: "No pudimos iniciar sesión. Revisá tus datos." **No afirma** "email no existe" ni "contraseña incorrecta" — eso filtraría existencia de cuentas (vector de enumeración).
- **signup fallido**: causa más probable = email ya registrado. Aviso: "No pudimos crear la cuenta. ¿Quizás ya tenés una? Probá iniciar sesión." Sugiere camino sin afirmar código de error SDK no verificado.
- **Excepciones nunca burbujean al cliente** — todo `try/catch` retorna `AccessResult` discriminado por `status`. El SDK podría tirar excepciones sin tipo estable; el slice las traduce a un shape conocido.

**Por qué no se chequea el código exacto del SDK**: documentado en `auth-actions.ts:7-15`. El método `signIn.email` retorna distintos shapes según versión del SDK Neon Auth managed; afirmar un código sin verificarlo en preview es frágil. Status: TBD verificado en preview Vercel (mismo estatus que el método de token, ADR-0018 §"Open").

## Wire-up con `?returnTo` (ADR-0033, post-S11.3)

Post-Feature-C V1 cerrada (2026-05-23, smoke owner-driven M1 verde), el slice acepta un destino post-auth alternativo al Hub canónico. **El cambio NO toca `useAccessForm`** — vive 100% en el closure del `onSuccess` que arma `AccessFlow`.

### Contrato

`AccessFlow` acepta prop opcional `returnTo?: string`. En `onSuccess`:

```typescript
onSuccess: () =>
  navigate(returnTo ?? `https://app.place.community/${locale}/`),
```

Sin `returnTo` → fallback Hub canónico **idéntico** al comportamiento pre-S11.3 (signup desde landing, login directo desde apex marketing).

### Validación

El componente NO valida `returnTo` — **confía en que la page apex ya lo validó server-side** con `validateLoginReturnTo` (helper PURE en `src/shared/lib/sso/validate-login-return-to.ts`, S11.3.B). El comment en `access-flow.tsx:44-51` lo enuncia explícito: "NUNCA confiar en este input client-side sin validación server-side previa — el componente sólo lo navega".

Policy V1 del validator (matriz canónica completa en ADR-0033 §"Contrato del helper PURE" y replicada en `docs/features/inbox/spec.md` §"Auth + redirects — addendum post-S11.3"):

- Relative paths (`/foo?x=1#y`) sin `//` ni `://` → ✓ preservado.
- Absolute HTTPS + same-registrable-domain + path ∈ `{/api/auth/sso-issue, /api/auth/sso-init}` → ✓ preservado.
- Cualquier otro (protocol-relative, scheme injection, attacker domain, HTTP no-HTTPS, path no-allowlistado) → `null` → page usa fallback Hub.

Allowlist explícito (Set literal, no `startsWith` ni `substring`): ampliar V2 requiere ADR aparte. Cost-of-mistake asimétrico — open-redirect = vector phishing severo. Precedente same-registrable-domain del sub-módulo `shared/lib/sso/`: el fetcher de JWKS (S11.1) usa el mismo principio.

### Backwards-compat

Cero regresión en los flows pre-Feature-C: signup desde landing, login directo desde apex marketing, navegación a `/login` sin query, futuros consumers internos no migrados → `safeReturnTo === null` → fallback Hub. Verificado por test `regression: sin returnTo → Hub canónico (flows pre-Feature-C intactos)` en `access-flow.test.tsx:203`.

## Continuidad con `ensureAppUser` (ADR-0018)

El signup **NO crea `app_user`** — sólo la identidad Neon Auth. La fila `app_user` se siembra de forma idempotente en la TX1 de `createPlaceAction` (Server Action del slice `place-creation`) en la request SIGUIENTE, donde la cookie ya viaja y `auth.token()` da el JWT.

Por qué no acá: `data.token` del `signUp.email` es un token de SESIÓN opaco, **no un JWT** (evidencia preview 2026-05-19). Intentar `getAuthenticatedDb` con ese token fallaba y el signup entero se reportaba como fallido aunque la cuenta SÍ se creaba — bug observable y corregido en ADR-0018. El comment de `auth-actions.ts:35-44` documenta la razón con cita verbatim.

"Cuenta sin place" (ADR-0008 §4) es un **estado legítimo** del producto: el user puede signup y luego ir al Hub (renderiza estado vacío con CTAs) sin obligación de crear un place inmediato. La idempotencia de `ensureAppUser` garantiza que si después crea o joinea, el `app_user` se siembra sin colisión.

## Testing

**Unit tests** (jsdom + RTL + userEvent, 9 casos en `access-flow.test.tsx`):

1. Arranca en login (email+contraseña, sin nombre) y alterna a signup.
2. Login exitoso → navigate cross-subdomain al Hub en el locale activo.
3. Login fallido → aviso calmo, sigue en el form (no navega).
4. Signup llama `auth.signUp` con los datos de cuenta y navega al Hub.
5. Signup no se envía sin aceptar los términos.
6. Signup fallido → aviso calmo que sugiere iniciar sesión (no navega).
7. ADR-0033: respeta `returnTo` si la page lo propaga → navigate al destino SSO en vez del Hub.
8. ADR-0033 regression: sin `returnTo` → Hub canónico (flows pre-Feature-C intactos).
9. Idempotencia: doble click no dispara dos autenticaciones.

**Borde cross-system NO vitest-testeable**: `loginAction` + `signUpAccountAction` arrastran `next/headers` + Neon Auth managed vivo → su correctitud es **tipo/build + smoke preview Vercel** (canon documentado en `auth-actions.ts:7-9` y en `docs/features/settings/tests.md:146`). Mismo criterio que `createPlaceAction`, `logoutAction`. No es deuda — es la frontera definida del slice; testear el SDK no agrega valor sobre lo que tipo+preview ya cubren.

## Fuera de V1 (diferido)

- **Password reset**: no V1. El SDK Neon Auth lo soporta; la UI + el flow del email entran cuando un user real lo pida.
- **Social auth** (Google, Apple, etc.): TBD. ADR-0001 §1 lo prevé como opcional; sin owner real pidiéndolo, no se prioriza.
- **"Unirme" funcional**: deshabilitado per ADR-0009 §2. El directorio público de places no existe V1; las invitaciones se entran por el link del email (no por el menú "Acceso").
- **Magic link / passwordless**: no V1. Requiere flow email + página de confirmación.
- **Lookup por email cross-slice**: ADR-0008 §"Zonas a confirmar" → resuelto en ADR-0009 como Server Action privilegiado **server-only** (email verificado). No expuesto al cliente.
- **Multi-factor (TOTP, WebAuthn)**: TBD post-V1; el SDK Neon Auth tiene soporte, requiere UX dedicada.

## Gotchas relevantes

- **`next-intl` ICU template + `t.raw`**: el label `terms` ("Acepto los {terms} y la {privacy}.") usa placeholders ICU que `next-intl` interpreta como FORMATTING_ERROR si se invoca `t("terms")` directo. La page invoca `t.raw("terms")` y `AccessFlow` parte client-side con `String.prototype.split`. Detalle en `docs/gotchas/next-intl-icu-template-raw.md`.
- **`window.location.assign` por puerto `navigate`**: testeado con fakes inyectados (no tocamos `window` global en jsdom). Mismo patrón que `NavHubLayout` del Hub V1.
- **Login con sesión vigente**: el guard server-side previene que un user logueado caiga en el form y re-cree sesión. ADR-0033 lo extiende para honrar `returnTo` si el user vuelve manual a `/login?returnTo=...` (intent de reanudar SSO supera default Hub).
- **Apex login `?returnTo` no implementado pre-S11.3**: bug pre-existing documentado en `docs/gotchas/apex-login-returnto-honored.md`. Feature C lo expuso sin causarlo — es la primera feature que envía users a `/login?returnTo=…` esperando honor. Fix wire-up minimal en S11.3.C (3 archivos código: page → component → hook intacto).
- **`searchParams` del Server Component es `Promise`** (Next 16): la page debe declararlo en el tipo `Props` y `await searchParams` antes de leer `returnTo`. Si el tipo no lo declara, Next NO expone el param y `?returnTo` es invisible. Documentado en `apex-login-returnto-honored.md`.

## Pointers

**Código del slice**:
- `src/features/access/auth-actions.ts` — Server Actions (61 LOC).
- `src/features/access/public.ts` — barrel (15 LOC).
- `src/features/access/ui/access-flow.tsx` — componente CLIENTE (240 LOC).
- `src/features/access/ui/use-access-form.ts` — máquina de estado (120 LOC).
- `src/features/access/ui/access-labels.ts` — tipos (65 LOC).
- `src/features/access/ui/__tests__/access-flow.test.tsx` — tests (235 LOC, 9 casos).

**Consumers V1**:
- `src/app/(marketing)/[locale]/login/page.tsx` — consumer completo (apex login).
- `src/app/(marketing)/[locale]/crear/page.tsx` — consumer parcial (`signUpAccountAction` como port del wizard place-first).

**Helpers relacionados** (fuera del slice, consumidos por las pages):
- `src/shared/lib/auth.ts` — wrapper Neon Auth (`getAuth()`).
- `src/shared/lib/session.ts` — `getSessionJwt` (usado por las pages para el guard "ya logueado").
- `src/shared/lib/sso/validate-login-return-to.ts` — validator del `?returnTo` (ADR-0033 S11.3.B).
- `src/shared/lib/root-domain.ts` — `rootDomain()` pasado al validator para la same-registrable-domain check.

**Decisiones canónicas**:
- ADR-0008 — Dos vías de entrada: CTA (place-first) vs "Acceso" (account-first).
- ADR-0009 — Cierre de los sub-puntos abiertos de ADR-0008 ("Unirme" deshabilitado, lookup-by-email server-only).
- ADR-0014 — Split del onboarding monolítico en 3 slices (`place-wizard`, `place-creation`, `access`).
- ADR-0018 — JWT Neon Auth + signup difiere `ensureAppUser` a TX1 del create authed (refina ADR-0008 §2).
- ADR-0033 — Apex login honra `?returnTo` para cerrar cold-start SSO M1 (refina S5b del Hub V1 y cierra Feature C M1).

**Cross-slice canon**:
- `docs/features/inbox/spec.md` §"Auth + redirects" — guard "ya logueado" del login y redirect post-auth al Hub canónico.
- `docs/features/inbox/spec.md` §"Auth + redirects — addendum post-S11.3" — wire-up del `?returnTo` y matriz canónica de validación.
- `docs/features/onboarding/plan-sesiones.md` — bitácora histórica de cuándo se construyó `access` (S9 del plan onboarding original) y cómo evolucionó (S5c del Hub V1: simplificación post-elección).
- `docs/features/custom-domain-sso/spec.md` §"Conclusión final Feature C V1" — única feature V1 que emite `/login?returnTo=…` (consumer único del contrato ADR-0033).
