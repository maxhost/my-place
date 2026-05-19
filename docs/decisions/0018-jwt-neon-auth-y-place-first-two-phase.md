# 0018 — Adquisición del JWT de Neon Auth (`auth.token()`) y place-first two-phase

- **Fecha:** 2026-05-19
- **Estado:** Aceptada
- **Alcance:** auth (seam token→JWT→RLS), onboarding (flujo place-first y signup account-first)
- **Cierra:** el TBD de **ADR-0006 §Consecuencias** ("método exacto de obtención del token de sesión de Neon Auth para el backend"). **Refina** (no supersede) ADR-0005 §1 y ADR-0008 §2 en su detalle de implementación. **Invalida** la resolución incorrecta de ese TBD que se había escrito como hecho en `auth-config.ts`, `stack.md` y `multi-tenancy.md` (que afirmaban `auth.getAccessToken()` "verificado 2026-05-18").

Las ADR son registro histórico: no se editan, se reemplazan/corrigen con una nueva ADR que la supersede.

## Contexto

Cutover de producción 2026-05-19. Síntoma: `signUp` creaba el usuario en Neon Auth pero el place **nunca** se creaba (cuenta huérfana). Diagnóstico con evidencia reproducible (instrumentación temporal + runtime logs Vercel + introspección Neon MCP), NO hipótesis:

- `signUp.email().data.token` y `getSession().session.token` son el **token de sesión OPACO** de Neon Auth (Better Auth), **no un JWT**. Pasárselo a `verifyAccessToken`/`jwtVerify` → `ERR_JWS_INVALID` (jose `JWSInvalid`: no es un JWS compacto).
- `auth.getAccessToken()` (endpoint `get-access-token`) es el **token OAuth de un proveedor externo** (exige `providerId`), otro concepto — no el JWT de sesión para RLS. La afirmación "JWT vía `auth.getAccessToken()`, verificado 2026-05-18" en `auth-config.ts`/`stack.md`/`multi-tenancy.md` era una resolución **incorrecta** del TBD de ADR-0006 (no estaba verificada de verdad contra el flujo vivo).
- El JWT JWKS-verificable se emite por el endpoint **`/token`** del plugin JWT de Neon Auth → método server **`auth.token()`** (el SDK server no expone `getJWTToken`, que es del cliente vanilla).
- `auth.token()` lee la sesión del **request** (cookie). `signUp` setea la cookie en su **respuesta** pero NO es re-legible en la **misma invocación** del Server Action (premise de implementación que ADR-0005 §1 / plan S5b asumían "single submit / misma invocación"). Por eso place-first no puede resolver identidad+DB en una sola invocación.

Verificado en producción (2026-05-19, branch `production`): con el fix, place `the-company` creado, cadena `place_ownership → app_user → neon_auth.user` íntegra, RLS correcta.

## Decisión

1. **El JWT para RLS se obtiene con `auth.token()`** (endpoint `/token`, plugin JWT). **Nunca** `signUp().data.token` ni `getSession().session.token` (sesión opaca) ni `auth.getAccessToken()` (OAuth de proveedor). El backend lo verifica con `jose`+JWKS (`NEON_AUTH_JWKS_URL`) e inyecta `request.jwt.claims` en la tx; `sub` = `neon_auth.user.id`.
2. **Place-first es two-phase** (refina ADR-0005 §1 a nivel implementación; el "single submit" sigue siendo cierto a nivel **producto**: el owner da un solo click "Crear"): request 1 = `signUp` (crea identidad y **establece la cookie de sesión** en su respuesta); request 2 = creación en **modo authed** (la cookie ya viaja → `auth.token()` da el JWT → `ensureAppUser` TX1 → `app.create_place` TX2).
3. **El signup (place-first y account-first) crea SOLO la identidad** (Neon Auth `signUp`). `ensureAppUser` se **difiere** a la TX1 del create authed — es idempotente y "cuenta sin place" es estado legítimo (ADR-0008 §4). Refina el wording "signUp + `ensureAppUser`" de ADR-0008 §2: el `ensureAppUser` ya no es eager en el Server Action de signup (hacerlo eager con el token de sesión rompía el signup entero).
4. `createPlaceAction(input)` es **siempre authed** (sin parámetro `credentials`): toma la sesión vigente (`getSession` para perfil) + `auth.token()` para el JWT.

## Alternativas rechazadas

- **`auth.getAccessToken()` / token de `signUp` / `getSession().session.token`.** Empíricamente inválidos (`ERR_JWS_INVALID` / concepto OAuth). Era el premise erróneo.
- **Single-invocation place-first** (resolver signup+JWT+DB en una sola request, ADR-0005 §1 / plan S5b a nivel impl). Imposible: la cookie de `signUp` no es re-legible en esa invocación; `auth.token()` no tendría sesión.
- **Hack de cookie** (serializar a mano la cookie de sesión de Better Auth para `auth.token()`). Parche acoplado a internals del SDK — rechazado (production-grade, sin parches).

## Consecuencias

- Cierra el TBD de ADR-0006. ADR-0005 §1 y ADR-0008 §2 quedan **refinados en implementación** (su decisión de producto/arquitectura de fondo sigue vigente; ver sus encabezados de corrección).
- `auth-config.ts`, `stack.md`, `multi-tenancy.md` se **corrigen en su lugar** (docs operativos no-ADR): el método es `auth.token()`.
- Place-first hace 2 requests; idempotencia y "cuenta sin place" (ADR-0005 §4 / ADR-0008 §4) ya cubrían el estado intermedio — no es gap.
- **Watch:** la correctitud del wiring vivo del SDK Neon Auth es de tipo/build + verificación en deploy (seam-split), NO vitest — ya verificado en prod 2026-05-19.

## Detalle operativo canónico

- Token→JWT→RLS: `docs/multi-tenancy.md` § RLS (corregido), `docs/stack.md` (corregido).
- Flujo two-phase: `src/features/place-wizard/use-place-wizard.ts` (FASE 1/FASE 2), `src/features/place-creation/actions.ts` (`createPlaceAction` authed, `acquireSessionJwt` = `auth.token()`), `src/features/access/auth-actions.ts` (`signUpAccountAction` solo-identidad).
- Encabezados de corrección en ADR-0005, ADR-0006, ADR-0008 apuntan acá.
