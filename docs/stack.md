# Stack técnico

Elecciones tecnológicas de Place y justificación de cada una. Cualquier cambio de stack se registra acá antes de implementarse.

> **Estado:** post reset a scaffold limpio. Datos en **Neon (Postgres)**, auth en **Neon Auth** (Better Auth, ya provisionado). Acceso a datos = **Drizzle** (ADR-0004). i18n = **next-intl** (decidido en la build de la landing). Email transaccional = **Resend**, IA = **Vercel AI Gateway** (ADR-0005). **Storage, Realtime y Pagos** siguen **TBD** — se deciden antes de implementarse.

## Piezas

| Pieza          | Elección                                        | Razón                                                                                              |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 15 con App Router                       | Multi-tenant nativo con middleware, Server Components, Server Actions, integración directa con Vercel |
| Lenguaje       | TypeScript strict mode                          | Seguridad de tipos en modelos de dominio complejos                                                 |
| UI library     | React 19                                        | Estándar                                                                                           |
| Base de datos  | PostgreSQL 17 gestionado por **Neon**           | Postgres serverless con branching; relacional denso; aislamiento de places vía RLS de Postgres     |
| Acceso a datos | **Drizzle ORM** (ADR-0004)                      | Thin query builder sin engine/binario (~7KB, cold start mínimo), conexión propia → RLS por request, schema en TS. Resuelve los 3 dolores que sacaron a Prisma. NO se vuelve a Prisma. |
| Auth           | **Neon Auth** (sobre Better Auth)               | Mismo proveedor que la DB. Place es su propio OIDC IdP (plugin OIDC Provider) → SSO cross-domain para custom domains + inbox (ver `architecture.md` § Sesión y SSO). Migración: neon.com/docs/auth/migrate/from-legacy-auth |
| Storage        | **TBD**                                         | Avatares / assets del place: proveedor pendiente. El uploader de icono del place se difiere a `/settings` post-signup (ADR-0005) para no bloquear el registro. |
| Realtime       | **TBD**                                         | Si se necesita, se decide acotadamente cuando aparezca el caso de uso.                             |
| Pagos          | **TBD**                                         | Mecanismo de cobro pendiente. ADR-0005 fija solo el arranque: trial 30d (`place.trial_ends_at`), `OWNER_PAYS`/`ACTIVE`, y al expirar → paywall `PAYMENT_PENDING` (ADR-0003). |
| Email transac. | **Resend** (ADR-0005)                           | Verificación de email y avisos de lifecycle (ADR-0003). Reemplaza el sender "shared" de Neon Auth. |
| IA             | **Vercel AI Gateway** (ADR-0005)                | Asistencia LLM del onboarding (propone paleta/descr./horario, propose-only). Modelo concreto al implementar. |
| CSS            | Tailwind (solo utilidades core) + CSS variables | Layout rápido + temas configurables por place                                                      |
| Estado cliente | Zustand                                         | Simple, sin boilerplate. Uso mínimo — preferir URL y server state                                  |
| Data fetching  | Server Components (server-first)                | Datos estables vía RSC. Mutations vía Server Actions. Capa de cliente para mutations/realtime: TBD |
| Forms          | React Hook Form + Zod                           | Validación tipada server + client                                                                  |
| i18n           | **next-intl**                                   | Multi-idioma del contenido estático. `app/[locale]`, `localePrefix:'always'`, default `es`, locales `es/en/fr/pt` (solo `es` poblado en v1). Decidido y en uso desde la build de la landing. |
| Testing        | Vitest + Playwright                             | Unit/integration con Vitest (jsdom); E2E con Playwright                                            |
| Hosting        | Vercel                                          | Wildcard subdomains nativos, edge middleware, deploy automático                                    |

## Región e infraestructura

- **Vercel:** proyecto `my-place` (team `maxhost27-6230s-projects`), dominio prod `place.community` (+ `*.place.community`).
- **Neon:** misma nube y región que las Functions de Vercel para minimizar latencia DB↔app. Provider **AWS**. **Región confirmada: AWS `us-east-1` (N. Virginia)** — proyecto `prod-place` (`odd-mountain-73982304`), org "The No-Code Company", branch `production`, Postgres 17 (verificado vía Neon, 2026-05-16). La *Function Region* de Vercel debe quedar en `iad1` para co-locar.
- **Neon Auth:** ya provisionado, `auth_provider: better_auth`, **gestionado** (REST API hosteada por Neon; sin webhooks ni hooks server-side). Tablas auth library-owned en el schema `neon_auth`. El core va en `public`. No hay auth legacy a migrar. `app_user` se provisiona por orquestación app-side + guard JIT (ADR-0006), no por hook.
- **Modelo rol/JWT (ADR-0006, nombres verificados 2026-05-16):** token = `auth.getSession().access_token`; verificación `jose`+JWKS; inyección `set_config('request.jwt.claims',…,true)` en tx; policies leen `auth.user_id()`; rol Postgres custom no-admin (`pgRole().existing()`, NO el `authenticatedRole` de la Data API); driver `neon-serverless` (tx interactiva). `neondb_owner` solo migraciones. **No** Data API ni `anon`. Detalle en `docs/multi-tenancy.md` § RLS.
- **Cookie de sesión cross-subdomain (verificado empíricamente 2026-05-16):** el SDK Next.js de Neon Auth emite cookie first-party vía route handler `app/api/auth/[...path]`; `createNeonAuth({ cookies: { domain: ".place.community", secret } })` da el `Domain` apex (solo en código). Probado: con `domain` → `Set-Cookie … Domain=.<apex>`; sin `domain` → host-only. `trusted_origins` **SÍ acepta wildcard** → `https://*.place.community` es un único origin válido (no hay que enumerar; corrige el reporte previo). **Gotcha:** cookies `__Secure-` → dev local necesita HTTPS (`docs/gotchas/`). Ver `architecture.md` § Sesión y SSO.

## Razones estructurales

**Neon como base de datos.** Postgres gestionado serverless, con branching de DB (útil para entornos efímeros de test/preview) y escalado a cero. Reemplaza al Postgres de Supabase. El aislamiento entre places se sigue modelando con RLS de Postgres (es feature del motor, no de Supabase).

**Stack desacoplado por decidir.** A diferencia del modelo previo de proveedor único, ahora auth/storage/realtime/pagos se eligen pieza por pieza cuando el producto lo requiera. Cada elección se registra en este documento y, si amerita, en `docs/decisions/`.

**Vercel** para hosting. Next.js está hecho por Vercel, la integración con wildcard subdomains es directa, SSL automático para todos los subdomains.

## Variables de entorno

Archivo `.env.local` (gitignored — nunca se commitea):

```env
# Database (Neon, pooled — rol NO-admin para que RLS aplique; el rol admin
# trae BYPASSRLS, ver ADR-0004). El connection string admin, si se usa para
# migraciones, va aparte y nunca en runtime de la app.
DATABASE_URL=
DATABASE_URL_UNPOOLED=          # para migraciones drizzle-kit (opcional)

# Neon Auth (Better Auth) — base/jwks del diagnóstico 2026-05-16
NEON_AUTH_BASE_URL=
NEON_AUTH_JWKS_URL=
NEON_AUTH_COOKIE_SECRET=        # ≥32 chars

# Email transaccional (Resend — verificación de email + avisos lifecycle)
RESEND_API_KEY=

# IA (Vercel AI Gateway — asistencia LLM del onboarding)
AI_GATEWAY_API_KEY=

# App
NEXT_PUBLIC_APP_URL=https://place.community
NEXT_PUBLIC_APP_DOMAIN=place.community

# Custom domains (Vercel Domains API — alta/verificación programática)
VERCEL_API_TOKEN=
VERCEL_PROJECT_ID=
```

Las variables de storage/realtime/pagos se agregan cuando se decida cada pieza. Los nombres exactos de Neon Auth/Resend/AI Gateway se confirman al implementar S1. **Todo lo que sea secret** (`*_SECRET`, `*_API_KEY`, `*_TOKEN`, `DATABASE_URL`) vive solo en `.env.local` / Vercel env, **nunca en git**.

## Package manager

**pnpm** como package manager. Más rápido que npm, mejor manejo de monorepo si llegamos a necesitar workspaces.

## Versión de Node

Node LTS (22.x o superior). Vercel corre el proyecto en Node 24.x. Fijar en `.nvmrc` y en `package.json` via `engines` cuando se reintroduzcan.

## Request-scoped caching (patrón a reimplementar)

Patrón arquitectónico para cuando se reconstruya la capa de datos. Dentro del render de un RSC tree, evitar queries duplicadas a la misma fila mediante primitives cacheados por request:

- **`React.cache`** para primitives con clave única (ej. usuario actual, membership activa, ownership, perfil de usuario). Viven en `src/shared/lib/`.
- **Maps compartidos cross-key** cuando una misma entidad se accede por más de una clave natural (ej. `Place` por slug y por id). `React.cache` no dedupea entre funciones distintas, así que se hace cross-population manual: al resolver por una key, se siembra la otra con el mismo `Promise`.

Cuando se reimplemente, documentar la decisión en `docs/decisions/`.
