# Stack técnico

Elecciones tecnológicas de Place y justificación de cada una. Cualquier cambio de stack se registra acá antes de implementarse.

> **Estado:** post reset a scaffold limpio. Datos en **Neon (Postgres)**, auth en **Neon Auth** (Better Auth, ya provisionado). Acceso a datos = **Drizzle** (ADR-0004). i18n = **next-intl** (decidido en la build de la landing). Email transaccional = **Resend**, IA = **Vercel AI Gateway** (ADR-0005). **Storage** = **Cloudflare R2** (ADR-0048). **Realtime y Pagos** siguen **TBD** — se deciden antes de implementarse.

## Piezas

| Pieza          | Elección                                        | Razón                                                                                              |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Framework      | Next.js 16 con App Router                       | Multi-tenant nativo con middleware (`proxy.ts`), Server Components, Server Actions, integración directa con Vercel. Subido de 15→16 en ADR-0013 (el SDK `@neondatabase/auth` exige Next ≥16). |
| Lenguaje       | TypeScript strict mode                          | Seguridad de tipos en modelos de dominio complejos                                                 |
| UI library     | React 19                                        | Estándar                                                                                           |
| Base de datos  | PostgreSQL 17 gestionado por **Neon**           | Postgres serverless con branching; relacional denso; aislamiento de places vía RLS de Postgres     |
| Acceso a datos | **Drizzle ORM** (ADR-0004)                      | Thin query builder sin engine/binario (~7KB, cold start mínimo), conexión propia → RLS por request, schema en TS. Resuelve los 3 dolores que sacaron a Prisma. NO se vuelve a Prisma. **Uso real (Phase 2.F):** schema-as-types + migraciones (`drizzle-kit`); las queries de dominio van en SQL raw parametrizado vía driver Neon + DEFINERs — el query builder de Drizzle aún no se adoptó. Detalle en ADR-0004 §Addendum 2.F. |
| Auth           | **Neon Auth** (sobre Better Auth) + **Signed Ticket SSO** (ADR-0032) | Mismo proveedor que la DB para apex `*.place.community`. **NO** somos OIDC IdP canónico — el plugin OIDC Provider de Better Auth no está accesible desde Neon Auth managed (validado 2026-05-22). SSO cross-domain a custom domains via Signed Ticket pattern (JWT ES256 short-lived, jose lib): el apex mintea tickets que el custom domain redeems por sesión local host-only. Refina ADR-0001 §1, supersede §3. Detalle en `architecture.md` § "Sesión y SSO" + ADR-0032. Migración Neon Auth: neon.com/docs/auth/migrate/from-legacy-auth |
| Storage        | **Cloudflare R2** (S3-compatible, ADR-0048)     | Blob storage para assets V1.3+ (logo place, avatares, library docs, event photos). 2 buckets: `place-media-public` (CDN cached via custom domain `media.place.community`) + `place-media-private` (presigned URLs). Wrapper `src/shared/lib/storage/blob.ts` (`uploadBlob` + `getBlobUrl` + `deleteBlob`) aísla los consumers del SDK AWS S3 v3. Egress zero + storage $0.015/GB-month. **El uploader de icono del place se difiere a `/settings` post-signup (ADR-0005) para no bloquear el registro**. |
| Realtime       | **TBD**                                         | Si se necesita, se decide acotadamente cuando aparezca el caso de uso.                             |
| Pagos          | **TBD**                                         | Mecanismo de cobro pendiente. ADR-0005 fija solo el arranque: trial 30d (`place.trial_ends_at`), `OWNER_PAYS`/`ACTIVE`, y al expirar → paywall `PAYMENT_PENDING` (ADR-0003). |
| Email transac. | **Resend** (ADR-0005)                           | Verificación de email y avisos de lifecycle (ADR-0003). Reemplaza el sender "shared" de Neon Auth. |
| IA             | **Vercel AI Gateway** vía SDK `ai@6` (ADR-0005/0007) | Asistencia LLM del onboarding: propone paleta + borrador de descripción (**no** horario — ADR-0007), propose-only. Modelo: `anthropic/claude-haiku-4-5` (Haiku 4.5; cambiado desde `openai/gpt-4o-mini` el 2026-05-18 — constante única swappable en `suggest-style-action.ts`, `"provider/model"` plano por el Gateway; mismo `AI_GATEWAY_API_KEY`, sin key nueva). |
| CSS            | Tailwind (solo utilidades core) + CSS variables | Layout rápido + temas configurables por place                                                      |
| Estado cliente | Zustand                                         | Simple, sin boilerplate. Uso mínimo — preferir URL y server state                                  |
| Data fetching  | Server Components (server-first)                | Datos estables vía RSC. Mutations vía Server Actions. Capa de cliente para mutations/realtime: TBD |
| Forms          | React Hook Form + Zod                           | Validación tipada server + client                                                                  |
| i18n           | **next-intl**                                   | Multi-idioma del producto. `localePrefix:'always'` en marketing y Hub (modo path-based); zona place usa **modo DB-based** (`place.default_locale`, ADR-0022). Default `es`, **6 locales operativos**: `es/en/fr/pt/de/ca` (post-ADR-0022, 2026-05-20 — añadidos `de/ca`). Fallback runtime deep-merge `defaultLocale` ← `{locale}` (ADR-0024) — UX nunca rendea key cruda. Script `scripts/check-translations.mjs` reporta drift, **informativo no fail-closed**. Detalle de los dos modos: `docs/architecture.md` § "i18n: dos modos de resolución de locale". |
| Testing        | Vitest + Playwright                             | Unit/integration con Vitest (jsdom); E2E con Playwright                                            |
| Hosting        | Vercel                                          | Wildcard subdomains nativos, edge middleware, deploy automático                                    |
| Rate limiting  | **Upstash Redis** + `@upstash/ratelimit` (Phase 0.D) | Serverless Redis para enforcement por IP en 6 endpoints (login/signup/invite accept+create/SSO init+issue). Free tier 10k commands/día cubre V1-V2. Behavior: prod sin creds → fail-loud (deploy bloqueado), dev sin creds → skip + warn (dev ergonomics). |
| Observability  | **Sentry** + `@sentry/nextjs` (Phase 0.E, ADR-0047) | Error tracking con stack traces source-mapped, dedupe por fingerprint, breadcrumbs. Wrapper canónico `src/shared/lib/observability/log.ts` (`log.info`/`log.warn`/`log.error`) aísla los 26 callsites del SDK. Init en 4 archivos (`src/instrumentation.ts` + `instrumentation-client.ts` + `sentry.{server,edge}.config.ts`). Free tier 5k errors/mes cubre V1-V2. Behavior: prod sin DSN → SDK no-op silencioso (NO fail-loud — Sentry no es control de seguridad). Setup vía Vercel Marketplace auto-sincroniza 5 env vars. |

## Región e infraestructura

- **Vercel:** proyecto `my-place` (team `maxhost27-6230s-projects`), dominio prod `place.community` (+ `*.place.community`).
- **Neon:** misma nube y región que las Functions de Vercel para minimizar latencia DB↔app. Provider **AWS**. **Región confirmada: AWS `us-east-1` (N. Virginia)** — proyecto `prod-place` (`odd-mountain-73982304`), org "The No-Code Company", branch `production`, Postgres 17 (verificado vía Neon, 2026-05-16). La *Function Region* de Vercel debe quedar en `iad1` para co-locar.
- **Neon Auth:** ya provisionado, `auth_provider: better_auth`, **gestionado** (REST API hosteada por Neon; sin webhooks ni hooks server-side). Tablas auth library-owned en el schema `neon_auth`. El core va en `public`. No hay auth legacy a migrar. `app_user` se provisiona por orquestación app-side + guard JIT (ADR-0006), no por hook.
- **Modelo rol/JWT (ADR-0006; método de token cerrado por ADR-0018, verificado en prod 2026-05-19):** JWT = `auth.token()` (endpoint `/token` del plugin JWT de Neon Auth). **NO** `auth.getAccessToken()` (token OAuth de proveedor) **NI** el token de `signUp`/`getSession` (sesión OPACA, no JWT). _La afirmación previa "`getAccessToken()` verificado 2026-05-18" era incorrecta — superada por ADR-0018._ Verificación `jose`+JWKS; inyección `set_config('request.jwt.claims',…,true)` en tx; policies leen `app.current_user_id()` (función propia, ADR-0011 — Neon RLS no provisionado); rol Postgres custom no-admin `app_system` (`pgRole().existing()`, NO el `authenticatedRole` de la Data API); driver `neon-serverless` (tx interactiva). `neondb_owner` solo migraciones. **No** Data API ni `anon`. Detalle en `docs/multi-tenancy.md` § RLS.
- **Cookie de sesión cross-subdomain (verificado empíricamente 2026-05-16):** el SDK Next.js de Neon Auth emite cookie first-party vía route handler `app/api/auth/[...path]`; `createNeonAuth({ cookies: { domain: ".place.community", secret } })` da el `Domain` apex (solo en código). Probado: con `domain` → `Set-Cookie … Domain=.<apex>`; sin `domain` → host-only. `trusted_origins` **SÍ acepta wildcard** → `https://*.place.community` es un único origin válido (no hay que enumerar; corrige el reporte previo). **Gotcha:** cookies `__Secure-` → dev local necesita HTTPS (`docs/gotchas/`). Ver `architecture.md` § Sesión y SSO.

## Backup, PITR y recuperación (Neon)

Neon no usa backups snapshot tradicionales: la durabilidad y la recuperación se apoyan en **history retention** (almacenamiento WAL + branching copy-on-write). Cualquier punto dentro de la ventana de retención es restaurable a granularidad LSN/segundo; no hay un job de dump que pueda quedar desactualizado o fallar en silencio.

- **Ventana de retención (PITR): 6 horas.** Confirmado empíricamente vía Neon API: `history_retention_seconds = 21600` en el proyecto `prod-place` (`odd-mountain-73982304`), 2026-06-01. Es la ventana dentro de la cual se puede hacer point-in-time restore a cualquier LSN/segundo.
- **Tier**: confirmar en el billing dashboard de Neon (la API/MCP no expone el plan). La retención es configurable por plan; 6h es un valor seteado, no el default de Free (24h). ⚠️ **6h es una ventana corta para producción**: una corrupción de datos no detectada dentro de 6h deja de ser recuperable vía PITR. Extender la retención (más retención = más storage facturado) o sumar dumps lógicos periódicos (`pg_dump` por cron) queda como **follow-up fuera del scope de 2.F** — cambiar la ventana es decisión de costo/arquitectura (CLAUDE.md §"Ante una desviación"), no se toca en una sesión de docs.
- **RPO** (recovery point objective): ≈ 0 para incidentes detectados dentro de la ventana — el restore va a cualquier punto del rango. Fuera de las 6h no hay PITR → el rango anterior no es recuperable (RPO efectivo ilimitado para datos más viejos que la ventana).
- **RTO** (recovery time objective): minutos. Crear un branch desde un timestamp es near-instant (copy-on-write, sin copia física); el único costo real es el cold-start del compute (segundos).
- **Neon Auth se restaura junto con el core**: las tablas `neon_auth.*` (Better Auth, library-owned) viven en el mismo branch Postgres que `public` → un PITR las rollbackea de forma consistente con el dominio. Implicación: restaurar a un punto pasado revierte también altas de usuarios y sesiones creadas en el rango descartado.

### Runbook de restore

1. **Identificar el target**: timestamp (o LSN) inmediatamente anterior al incidente, dentro de las últimas 6h.
2. **Restaurar** (Neon Console → proyecto `prod-place` → branch `production` → *Restore* / Time Travel). Dos modos:
   - **In-place** sobre `production`: resetea el branch al punto elegido; Neon crea automáticamente un branch de backup con el estado previo (red de seguridad si el punto fue equivocado). Mantiene el connection string → **no hay que repointar Vercel**.
   - **Branch nuevo** desde el timestamp: crea un branch lateral para inspeccionar/validar la data antes de repointar. Útil cuando no estás seguro del punto exacto.
3. **Verificar** la data restaurada (queries de sanidad sobre las tablas afectadas) ANTES de dirigir tráfico.
4. **Repointar** (solo si usaste branch nuevo): actualizar `DATABASE_URL` + `DATABASE_URL_MIGRATE` en Vercel (scope Prod) al endpoint del branch restaurado + redeploy. El modo in-place evita este paso.
5. **Post-restore**: smoke de flujos críticos (login, create place, accept invite) — recordar que `neon_auth` se revirtió junto con `public`.

Docs Neon: point-in-time restore (`neon.com/docs/introduction/point-in-time-restore`), branch restore / Time Travel (`neon.com/docs/guides/branch-restore`), configurar retención (`neon.com/docs/manage/projects`).

## Razones estructurales

**Neon como base de datos.** Postgres gestionado serverless, con branching de DB (útil para entornos efímeros de test/preview) y escalado a cero. Reemplaza al Postgres de Supabase. El aislamiento entre places se sigue modelando con RLS de Postgres (es feature del motor, no de Supabase).

**Stack desacoplado por decidir.** A diferencia del modelo previo de proveedor único, ahora auth/storage/realtime/pagos se eligen pieza por pieza cuando el producto lo requiera. Cada elección se registra en este documento y, si amerita, en `docs/decisions/`.

**Vercel** para hosting. Next.js está hecho por Vercel, la integración con wildcard subdomains es directa, SSL automático para todos los subdomains.

## Variables de entorno

**Canon de referencia operativo**: `.env.example` checked-in en el repo root. Contiene la lista completa de env vars con placeholder + comentario + scope hint per variable. Esta sección documenta el RATIONALE de cada bloque.

Archivo `.env.local` (gitignored — nunca se commitea) lo copiás desde `.env.example` y completás. La excepción `!.env.example` en `.gitignore` hace que el example sí se versione.

**Cambios respecto a iteraciones anteriores del doc (Phase 0.B closure, 2026-05-28)**:
- `DATABASE_URL_UNPOOLED` renombrada a `DATABASE_URL_MIGRATE` (nombre que el código realmente lee).
- Agregadas `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (requeridas por workflow `.github/workflows/tests.yml` + harness `src/db/__tests__/db-test-pool.ts`).
- Agregada `VERCEL_ENV` (mention only — Vercel la inyecta automáticamente; usada por `scripts/maybe-migrate.mjs` para gate prod-only migrations).
- `RESEND_API_KEY` marcada **Planned for V1.3** (lifecycle email ADR-0003, HOY no consumida por código).
- `AI_GATEWAY_API_KEY` marcada como consumida internamente por el SDK `ai` (Vercel AI Gateway, no via `process.env` explícito), gateada por slice `style-assist/` que actualmente está dormido (ADR-0020).

### Bloques operativos

- **Database (Neon)**: 4 connection strings — runtime (`DATABASE_URL`, rol `app_system` NO-admin), migrations prod (`DATABASE_URL_MIGRATE`, rol `neondb_owner` admin, PROD-only), test branch x2 (`DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` para CI integration tests). El rol admin trae BYPASSRLS — NUNCA en runtime (ADR-0004).
- **Neon Auth (Better Auth)**: 3 vars (`NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_COOKIE_SECRET`). El cookie secret se genera con `openssl rand -base64 48`, mín 32 chars.
- **App públicas**: `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_APP_DOMAIN`. Las que empiezan con `NEXT_PUBLIC_` se bundlean al client — exposure intencional, NO secret.
- **Custom domains (Vercel API)**: `VERCEL_API_TOKEN` (scope `domains:write`) + `VERCEL_PROJECT_ID`. Sin estas el slice `/settings/domain` degrada (defensivo, no crash). Consumidas por `src/shared/lib/vercel/domains.ts` (ADR-0026).
- **Custom Domain SSO (Feature C, ADR-0032)**: `PLACE_SSO_SIGNING_KEY` (ES256 PKCS8 PEM multiline) + `PLACE_SSO_SIGNING_KEY_KID` (short id). **Vercel-only**, NUNCA en `.env.local` committed. Generación de key con `openssl ecparam` + `openssl pkcs8` (ver `.env.example` comentarios).
- **Vercel inyectados** (no setear manualmente): `VERCEL_ENV` (production / preview / development).
- **Upstash Redis (rate limiting, Phase 0.D)**: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Setear en Vercel (Prod + Preview). **Prod sin estas vars → app crashea al primer rate-limit check** (fail-loud, deploy bloqueado hasta setear). Dev local sin las vars → skip + warn (no rompe local). Setup: ~3min en upstash.com (free tier).
- **Sentry (observability, Phase 0.E, ADR-0047)**: `NEXT_PUBLIC_SENTRY_DSN` (canónica — leen client y server vía fallback chain `SENTRY_DSN ?? NEXT_PUBLIC_SENTRY_DSN`) + `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT`. Setup vía Vercel Marketplace × Sentry integration (~5min): sincroniza AUTO a Prod + Preview scopes (más extras `SENTRY_PUBLIC_KEY`/`SENTRY_OTLP_TRACES_URL`/`SENTRY_VERCEL_LOG_DRAIN_URL`/`VERCEL_GIT_COMMIT_SHA` no usadas V1 pero gating tracing/log-drain futuro); este repo no commitea nada. `SENTRY_DSN` (sin prefix) está soportado como override opcional pero la integración NO lo sincroniza — usar sólo si DSN distinto por runtime. **Prod sin DSN → SDK init no-op silencioso** (degrada observability, NO crashea — Sentry NO es control de seguridad, distinto patrón que Upstash Phase 0.D). Mitigación: completar integración Vercel Marketplace ANTES del primer deploy. Dev local sin DSN → `log.*` siguen funcionando vía `console.*` (no rompe local). Free tier: 5k errors/mes (cubre V1-V2 con margen 1.6×).
- **Cloudflare R2 (storage, Phase 1.G, ADR-0048)**: 6 vars — `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_PUBLIC_BUCKET` (`place-media-public`) + `R2_PRIVATE_BUCKET` (`place-media-private`) + `R2_PUBLIC_BASE_URL` (`https://media.place.community`). Provisioning manual ~30min one-time (sin Vercel Marketplace integration — vendor separado): sign up CF + activar R2 + crear 2 buckets + API token scoped Object Read & Write + custom domain CNAME para bucket público + setear 6 vars en Vercel (Prod + Preview). **Prod sin estas vars → app throws al primer call de uploadBlob/getBlobUrl/deleteBlob** (fail-loud-prod, mismo patrón que Upstash Phase 0.D — storage es operacionalmente crítico distinto de Sentry). Dev local sin vars → `console.warn` 1× + throw con mensaje claro al intentar storage op (no mockea silent). Free tier: 10GB storage + egress ZERO + 1M Class A / 10M Class B ops/mes (cubre V1 entero con margen 300×). Pay-as-you-go beyond: $0.015/GB-month. Setup completo step-by-step en `.env.example` §Cloudflare R2.
- **`RESEND_API_KEY` (planned V1.3)**: email transaccional lifecycle (ADR-0003: verificación de email + avisos d0/+2/+7). HOY **sin consumer en código y sin paquete `resend` instalado** — es roadmap, no fantasma. Se setea (e instala la dep) al activar el slice de email en V1.3.
- **`AI_GATEWAY_API_KEY` (dependencia activa, slice dormido — NO planned)**: el SDK `ai@6` está instalado e importado (`generateObject` en `src/features/style-assist/suggest-style-action.ts`); el SDK lee esta var internamente (no vía `process.env` explícito). El slice `style-assist/` está pausado por ADR-0020, así que la var no se ejerce hoy, pero el código y la dep ya existen en el repo. Se setea al reactivar el slice (no requiere instalar nada nuevo).

**Realtime/pagos** siguen TBD — se agregan cuando se decida cada pieza. **Storage** RESUELTO en Phase 1.G (ADR-0048, Cloudflare R2). **Todo lo que sea secret** (`*_SECRET`, `*_API_KEY`, `*_TOKEN`, `DATABASE_URL*`, `R2_SECRET_ACCESS_KEY`) vive solo en `.env.local` / Vercel env, **nunca en git**.

## Package manager

**pnpm** como package manager. Más rápido que npm, mejor manejo de monorepo si llegamos a necesitar workspaces.

## Versión de Node

Node LTS (22.x o superior; Next 16 exige ≥20.9). Vercel corre el proyecto en Node 24.x. **Fijado** en `.nvmrc` (`22`) y en `package.json` via `engines` (`>=22.0.0`) — ADR-0013 (cierra el TBD de versión de Node).

## Request-scoped caching (patrón a reimplementar)

Patrón arquitectónico para cuando se reconstruya la capa de datos. Dentro del render de un RSC tree, evitar queries duplicadas a la misma fila mediante primitives cacheados por request:

- **`React.cache`** para primitives con clave única (ej. usuario actual, membership activa, ownership, perfil de usuario). Viven en `src/shared/lib/`.
- **Maps compartidos cross-key** cuando una misma entidad se accede por más de una clave natural (ej. `Place` por slug y por id). `React.cache` no dedupea entre funciones distintas, así que se hace cross-population manual: al resolver por una key, se siembra la otra con el mismo `Promise`.

Cuando se reimplemente, documentar la decisión en `docs/decisions/`.
