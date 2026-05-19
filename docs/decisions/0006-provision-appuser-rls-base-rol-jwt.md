# 0006 — Provisión de `app_user`, RLS base y modelo rol/JWT

- **Fecha:** 2026-05-16
- **Estado:** Aceptada
- **Alcance:** auth (fundamento), arquitectura (saga signup), multi-tenancy (RLS), modelo de datos
- **Ajusta:** ADR-0005 §2 (mecanismo de creación de `app_user`) y cierra los TBD acotados de RLS/rol no-admin de ADR-0004. No supersede: refina con hechos verificados.

> ⚠️ **CORRECCIÓN 2026-05-19 — leer antes de aplicar esta ADR.** El TBD de §Consecuencias ("método exacto de obtención del token de sesión de Neon Auth para el backend") fue **resuelto MAL** en `auth-config.ts`/`stack.md`/`multi-tenancy.md` (afirmaban `auth.getAccessToken()` "verificado 2026-05-18" — falso: eso es token OAuth de proveedor; el de `signUp`/`getSession` es de sesión opaco, no JWT). **Queda CERRADO por ADR-0018**: el JWT JWKS-verificable se obtiene con **`auth.token()`** (endpoint `/token`, plugin JWT). El resto de ADR-0006 (provisión `app_user` vía Server Action + guard JIT `ensureAppUser`, modelo rol/JWT, RLS base) **sigue vigente**.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

La autenticación es el fundamento: si el usuario no se autentica y no se provisiona su identidad de producto de forma correcta, las RLS y todas las features se construyen sobre arena. ADR-0005 §2 habló de un "hook transaccional al signup" para crear `app_user`. Antes de S1 se verificó el modelo real de Neon Auth contra la doc oficial (no asumir):

- **Neon Auth es un servicio gestionado** (REST API hosteada por Neon; el `base_url` es un endpoint `neonauth…neon.tech`). No es un Better Auth self-hosted en nuestra app.
- **No hay webhooks ni hooks server-side de creación de usuario.** La página de webhooks de Neon Auth da 404; el SDK server de Next.js (`createNeonAuth`) no expone callbacks/eventos de lifecycle.
- **`auth.signUp.email()` es invocable desde un Server Action** y devuelve el usuario sincrónicamente. `auth.getSession()` da la sesión/usuario en Server Components/Actions/Route Handlers.
- Las tablas de auth viven en el schema `neon_auth` del propio Postgres (`user, session, account, verification, jwks`, + plugin organization). Son library-owned y las gestiona Neon Auth (no hay tabla `users_sync` en el modelo Better Auth: `neon_auth.user` es la tabla real).
- Neon RLS: el JWT **no** viaja implícito a Postgres. El backend recibe el token, lo verifica con **JWKS**, e inyecta los claims en la transacción (`set_config('request.jwt.claims', …, true)`); las funciones `auth.user_id()` / `auth.jwt()` los leen. Roles: `neondb_owner` = admin (BYPASSRLS); `authenticated`/`anonymous` los usa la **Data API**; se puede crear un rol custom no-admin para enforcar RLS desde el backend.

## Decisión

**1. Provisión de `app_user` = orquestación app-side en nuestro Server Action de signup + guard JIT idempotente.** No hay "hook" de Neon Auth ni trigger sobre la tabla library-owned `neon_auth.user` (frágil: la gestiona Neon). El patrón production-grade, derivado de los hechos:

- El **Server Action de signup que nosotros controlamos** llama `auth.signUp.email()` → con el id devuelto, en la misma request, una transacción de app (`public`) hace **upsert idempotente** de `app_user` (clave `auth_user_id`, conflicto → no-op) + handle random + (en el flujo owner) `place` + `place_ownership` + `membership`.
- **Guard JIT idempotente `ensureAppUser(authUserId)`**: antes de cualquier operación de dominio, en **toda entrada autenticada** (signup, login posterior, invitación, "join" del directorio, reintentos, edge cases), se garantiza que `app_user` existe (upsert idempotente). Invariante: *ninguna operación de dominio corre sin `app_user`*. Fuerte consistencia en el punto de uso, sin acoplarse a internals de Neon Auth, sin depender de webhooks (no existen).
- Esto **reemplaza el wording "hook transaccional al signup"** de ADR-0005 §2 / ADR-0001 / `data-model.md`: el "hook" conceptual es **nuestro** Server Action + el guard JIT, no un callback de Neon Auth.

**2. RLS base = aislamiento por owner; el resto, por feature.** RLS se implementa **incremental por feature**, pero la base entra en S1:

- **`app_user`**: el usuario solo lee/actualiza su propia fila. Predicado: `auth.user_id() = app_user.auth_user_id`.
- **Tablas con `place_id`** (`place`* , `membership`, `place_ownership`, `invitation`, y futuras tablas de features): policy base = "la fila pertenece a un place que el usuario actual ownea":

  ```sql
  EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = <tabla>.place_id
      AND au.auth_user_id = (select auth.user_id())
  )
  ```
  (\*`place` se referencia por `place.id = <…>.place_id`; para `place` la condición es sobre su propia `id`.)
- Owner → CRUD completo solo en su place; places A/B/C aislados automáticamente. El acceso de **miembros** (tier, grupo, config de thread/library/eventos) se agrega **encima** de esta base, por-feature, en sus propias ADRs/specs. La base no concede nada a miembros: eso es deliberado.
- Expresado en Drizzle con `pgPolicy`/`crudPolicy` + `authenticatedRole` + predicados custom (`drizzle-orm/neon`).

**3. Modelo rol/JWT.**

- Las queries de dominio corren bajo un **rol Postgres custom NO-admin** (nombre a fijar en S1, p.ej. `app_authenticated`) con `GRANT` mínimos y **sin** `BYPASSRLS`. `neondb_owner` (admin, BYPASSRLS) **solo** para migraciones (`drizzle-kit`), **nunca** en runtime de la app.
- El backend obtiene el JWT de la sesión de Neon Auth, lo **verifica con JWKS** (`NEON_AUTH_JWKS_URL`) y **inyecta los claims** en la transacción antes de las queries (`set_config('request.jwt.claims', …, true)`); `auth.user_id()` los lee dentro de las policies.
- **No se usa la Data API de Neon ni el rol `anonymous`/`anon`.** No se le otorga ningún privilegio a `anon`. Sin acceso no-autenticado a la DB → `anon` deja de ser superficie de riesgo. Todo acceso de dominio es autenticado, verificado server-side, bajo el rol custom.

## Alternativas rechazadas

- **Trigger `AFTER INSERT ON neon_auth.user`.** Acopla a una tabla library-owned que Neon Auth puede migrar/alterar; trigger sobre schema de un servicio gestionado = frágil y silenciosamente rompible. Rechazada.
- **Webhook de Neon Auth → endpoint que crea `app_user`.** No existen webhooks en Neon Auth (verificado, 404). Aunque existieran: eventual-consistencia (ventana sin `app_user`), firma/idempotencia/retry extra. Rechazada.
- **Confiar en un "hook" de Better Auth.** Neon Auth es gestionado; no podemos inyectar hooks server-side en su instancia. Rechazada por inviable.
- **Usar el rol `authenticated`/`anonymous` de la Data API.** `anon` es superficie de acceso no-autenticado; exponerlo aunque sea sin grants es riesgo innecesario. Se usa un rol custom sin Data API. Rechazada.
- **RLS completa (miembros incluidos) de una.** El acceso de miembros depende de tier/grupo/config por-feature aún no especificados; forzarlo ahora sería improvisar. Se hace incremental sobre la base owner. Rechazada por alcance.

## Consecuencias

- Docs vivos a actualizar: `architecture.md` (saga: "hook" → Server Action orquestado + guard JIT), `multi-tenancy.md` (sección RLS base + modelo rol/JWT), `data-model.md` (nota de mecanismo `app_user` y RLS base; corregir el wording "hook transaccional"), `stack.md` (rol no-admin, JWKS, sin Data API/`anon`).
- `ensureAppUser` es un primitivo de `shared/lib` (idempotente, dedupeable por request vía `React.cache`), consumido por el flujo de auth y por cada feature en su borde.
- TBD acotado restante (S1 impl, no arquitectura): nombre exacto del rol custom y sus GRANT; método exacto de obtención del token de sesión de Neon Auth para el backend; `neon-http` vs `neon-serverless` (websockets) — la saga necesita transacción interactiva → `neon-serverless`.
- Las policies de acceso de **miembros** son trabajo futuro por-feature; cada feature documenta las suyas. La base de S1 es deliberadamente restrictiva (solo owner).

## Detalle operativo canónico

- Saga de signup y `ensureAppUser`: `docs/architecture.md` § Onboarding.
- RLS base, predicados y modelo rol/JWT: `docs/multi-tenancy.md`.
- Schema y notas de `app_user`/auth: `docs/data-model.md`.
- Capa de datos (Drizzle) y RLS declarativo: ADR-0004.
- Onboarding/saga/billing/LLM: ADR-0005.
- Identidad separada, OIDC, custom domains: ADR-0001.
