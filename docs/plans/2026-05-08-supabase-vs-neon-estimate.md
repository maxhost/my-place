# Estimación: Supabase vs Neon para Place

**Fecha:** 2026-05-08
**Estado:** Análisis preliminar — NO ejecutar sin decisión explícita
**Autor:** sesión de análisis técnico (no implementación)
**Audiencia:** maxi (founder/único dev) en estado de decisión sobre stack DB.

> **Disclaimer**: este documento es una estimación. Cada bloque marca su confidence
> level. Donde un número es teórico (basado en docs públicas, benchmarks de
> terceros, o asunciones razonables) está marcado como **speculative**. Donde
> tenemos medición real del repo, está marcado como **measured**.

---

## TL;DR

- **Hoy:** TTFB 87-92ms, FCP 696-772ms desde Supabase Postgres `us-east-2` (Ohio)
  vía Supavisor + `@prisma/adapter-pg` (TCP pool warm) hacia Vercel `iad1`. Las
  mediciones actuales **ya están en el rango de "bueno"** para la audiencia
  esperada (mayoritariamente US East/LATAM con buen routing). Migrar todo el stack
  por Edge runtime es alto-riesgo + bajo-ROI en este momento.
- **Recomendación primaria: Escenario A — no migrar ahora.** Place está pre-MVP,
  los números actuales no son el cuello de botella, y desarmar 4 servicios
  (Postgres + Auth + Realtime + Storage) introduce ~10-18 sesiones de trabajo +
  riesgo de regresión en RLS + ruptura del flujo CI con Supabase Branches.
- **Recomendación secundaria (si la métrica empeora a futuro): Escenario B —
  migrar sólo Postgres a Neon, mantener Supabase Auth + Realtime + Storage.**
  Reduce un servicio (Postgres) sin desarmar Auth/Realtime/Storage. Costo
  ~3-5 sesiones, ROI marginal en TTFB warm pero potencial mejora en cold start
  - branching más cheap. **Ojo:** mantener 2 cuentas multiplica overhead operacional.
- **Escenario C (migración total a Neon + Auth alt + Pusher/Ably + Vercel Blob):
  no recomendado pre-MVP.** ~10-18 sesiones, fragmentación de vendors, lock-in se
  desplaza pero no desaparece, y Auth + Realtime son piezas con superficie de
  bug alta (sessions, presence policies, RLS para canales privados).

Ver §5 y §6 para criterios objetivos de cuándo cambiar de escenario.

---

## 1. Comparación arquitectónica por subsistema

| Subsistema       | Supabase actual                                                                                                                                                                                        | Neon (postgres-only)                                                                                                                        | Implicancia de migrar                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Postgres**     | Postgres 15+ gestionado en `us-east-2`. Pooler Supavisor (transaction mode `:6543` + session mode `:5432`). RLS habilitada en 12 tablas (`docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md`). | Postgres 15/16/17, branching zero-copy ~1s, scale-to-zero, HTTP driver opcional.                                                            | Schema portable. Pero RLS de Supabase usa `auth.uid()` + claim JWT inyectado por GoTrue; Neon NO tiene `auth.uid()` — hay que reescribirlo o reproducirlo a mano (ver §3).         |
| **Auth**         | Supabase Auth (GoTrue). Magic link via `signInWithOtp`. Cookies SSR via `@supabase/ssr`. Sin password. Cross-subdomain configurado (`cookieDomain`).                                                   | **No existe.** Neon es DB pura.                                                                                                             | Reemplazo obligatorio. Opciones realistas en §3 (Auth.js v5, Better Auth, Clerk, custom). Cada opción es 2-5 sesiones + tests + migración de la `User` table.                      |
| **Realtime**     | Supabase Realtime. Canales privados con RLS. Usado en thread (presence + new comments via broadcast). `src/shared/lib/realtime/` ya abstrae transport (`SupabaseBroadcastSender/Subscriber`).          | **No existe.** Neon es DB pura.                                                                                                             | Reemplazo obligatorio o drop. Opciones: Pusher ($49/mo Startup), Ably, drop-realtime + polling. La abstracción `BroadcastSender` del shared module ayuda — sólo cambia el adapter. |
| **Storage**      | Supabase Storage (buckets, S3-compatible). Plan actual: avatares públicos.                                                                                                                             | **No existe.** Neon es DB pura.                                                                                                             | Reemplazo obligatorio. Vercel Blob ($0.023/GB-month, idéntico a S3) es trivial integración (1 sesión). Migración de assets existentes: simple `download → re-upload` script.       |
| **Branching CI** | Branches efímeras vía Supabase Management API (`scripts/ci/branch-helpers.sh`). Crea + migra + seed + tests + delete por run.                                                                          | Neon Branches: zero-copy, ~1-2s creación, scale-to-zero gratis para inactivas. GitHub Action oficial (`neondatabase/create-branch-action`). | Mejora marginal: ambos servicios soportan el patrón. Neon tiene mejor UX de branching y scale-to-zero, pero requiere reescribir el bash actual.                                    |

**Punto clave**: Supabase es una **plataforma integrada** (DB + Auth + Realtime +
Storage + Edge Functions). Neon es **sólo Postgres**. Comparar Supabase vs Neon
es comparar peras con manzanas — sólo tiene sentido si decidís reemplazar también
Auth, Realtime y Storage. Si querés "migrar a Neon", en realidad estás decidiendo
"desarmar la stack integrada y armar una multi-vendor".

---

## 2. Estimación de mejoras de performance

### Baseline medido (commit `e69ef18`, post-migración a Ohio)

| Métrica              | Valor actual         | Confidence   |
| -------------------- | -------------------- | ------------ |
| TTFB                 | 87-92 ms             | **measured** |
| FCP                  | 696-772 ms           | **measured** |
| Bundle transfer real | 290-295 kB           | **measured** |
| First Load JS        | 233-238 kB (lectura) | **measured** |

### Estimaciones post-Neon

#### TTFB (warm lambda)

- **Hoy (Supabase TCP pool warm)**: 87-92 ms (medido).
- **Neon HTTP driver (`@neondatabase/serverless`) warm**: estimado **80-110 ms**
  (speculative). El HTTP driver agrega 5-15 ms por query vs TCP pool warm
  ([pkgpulse benchmarks 2026](https://www.pkgpulse.com/blog/pg-vs-postgres-js-vs-neon-serverless-postgresql-drivers-2026)).
  La mejora teórica del marketing de Neon ("40% reducción de latencia",
  [Neon blog](https://neon.com/blog/sub-10ms-postgres-queries-for-vercel-edge-functions))
  aplica vs **TCP cold con setup de 8 round-trips**, no vs **TCP warm**. En el
  caso warm, el HTTP de Neon es **igual o ligeramente peor** que el TCP pool
  actual.
- **Neon WebSocket driver warm (Edge runtime)**: similar al HTTP, ~5-10 ms
  overhead vs TCP warm. Mejora real: TTFB no baja por el driver, baja por la
  ubicación geográfica del Edge POP vs lambda en `iad1`.
- **Edge runtime + Neon HTTP, usuario en US East (cerca de `iad1`)**: estimado
  90-110 ms. Sin mejora notable. Speculative.
- **Edge runtime + Neon HTTP, usuario en LATAM (Argentina)**: estimado **TTFB
  -30 a -80 ms** vs lambda `iad1`, porque el Edge POP está en São Paulo / Buenos
  Aires y elimina ~150ms de RTT TCP-handshake. Pero la query a la DB sigue
  yendo a US East (Neon `us-east-2`), agregando ~80-120 ms de RTT app→DB.
  **Net**: TTFB más bajo, pero el "interactive paint" puede ser parecido por
  la query latency. Speculative — depende de cuántas queries serie por request.

**Veredicto TTFB**: la migración no mejora el caso warm para usuarios US East.
Mejora marginal para LATAM/EU si + se hace + Edge runtime. La palanca real es
**la región del POP**, no el driver.

#### FCP

- **Hoy**: 696-772 ms (medido).
- **Post-Neon + Edge runtime**: FCP cae proporcional a TTFB. Si TTFB baja 30 ms
  para LATAM, FCP cae 30 ms aprox. Para US East: sin cambio significativo.
- **Caveat**: FCP tiene más palancas que la DB (bundle JS de 290 kB, fonts,
  CSS critical). Una migración de DB no toca esas palancas.

#### Cold-start

- **Lambda Node hoy**: 200-400 ms cold ([Vercel KB](https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel)).
- **Edge runtime cold**: 50-1500 ms según frequency ([Vercel docs](https://vercel.com/docs/functions/runtimes/edge/edge-functions.rsc)).
  Marketing dice "9x más rápido global" pero el rango bajo (~50ms) es para
  edge functions warm o infrequent-but-recently-invoked.
- **Para Place (≤150 miembros por place)**: el thread caliente mantiene la
  lambda warm. Cold-starts son pocos (entradas iniciales del día, primer
  request tras inactividad de >15 min). **No es el bottleneck** para una
  app cozytech con tráfico bajo y previsible.

**Veredicto cold-start**: no justifica migración por sí solo.

#### Throughput de queries concurrentes

- **Hoy**: `PG_POOL_MAX=1` por lambda en prod (config explícito en
  `src/db/client.ts:48`). Multiplexing real lo hace Supavisor. En dev se sube
  a 10+ para paralelismo (gotcha documentado en `CLAUDE.md`).
- **Post-Neon HTTP**: cada query es un HTTP request independiente, sin pool.
  Throughput escala lineal con el budget de connections configurado en Neon.
  **Mejora marginal** para Place (queries Promise.all de 4-8 queries por page,
  no estamos haciendo 100s).

**Veredicto throughput**: irrelevante a esta escala.

#### Branching CI

- **Hoy (Supabase Branches)**: ~30-60s para crear branch + run migrations +
  seed. ~$0.01-0.03 por branch invocation (uso real bajo, free tier cubre).
- **Neon Branches**: ~1-3s creación zero-copy + run migrations + seed. Scale-to-zero
  gratis. Estimación: total CI run baja 20-40s.

**Veredicto branching**: ligera mejora de CI time. No es el bottleneck del
desarrollo.

---

## 3. Costo de migración (estimación realista)

### 3.1 Postgres: Supabase → Neon

**Trabajo**:

- `pg_dump` del Supabase actual + restore en Neon proyecto nuevo. **Ojo
  importante**: las RLS policies de Supabase referencian `auth.uid()` (función
  custom inyectada por GoTrue que lee el JWT claim). Neon no tiene `auth.uid()`.
  Hay que:
  - **Opción 1**: si reemplazás Auth, reescribir las 12+ policies para que lean
    de un esquema custom (ej: `app.current_user_id()` que lea de un GUC seteado
    por el adapter).
  - **Opción 2**: si mantenés Supabase Auth + Neon Postgres (Escenario B),
    perdés la capacidad de RLS porque el JWT de Supabase Auth no se propaga a
    Neon. Habría que usar `service_role` siempre y depender 100% de filtros
    explícitos (lo que el repo ya hace, pero pierde el cinturón de seguridad).
- Cambios en `src/db/client.ts`: reemplazar `Pool` de `pg` por `neon()` o `Pool`
  de `@neondatabase/serverless`. Reemplazar `PrismaPg` por `PrismaNeon` (de
  `@prisma/adapter-neon`).
- **Estado de `@prisma/adapter-neon` (verificado 2026-05)**: disponible y en uso
  productivo, pero con limitations conocidas:
  - No implementa `connectToShadowDb` para Prisma Studio (issue Prisma #27938,
    aug 2025).
  - Casos reportados de type errors `PrismaNeon` no asignable a `DriverAdapter`
    (issue #26638). Workaroundeable.
  - Los preview branches funcionan pero `prisma migrate dev` requiere
    `directUrl` separado para shadow DB.
- **Tests RLS rotos**: el harness `tests/rls/harness.ts` usa `DIRECT_URL` session
  mode (`:5432` Supavisor) + `SET LOCAL request.jwt.claims`. Neon no tiene
  pooler equivalente con session mode, pero soporta conexión directa TCP. Hay
  que reescribir el harness para usar la URL directa de Neon + reescribir el
  setup de claims si reemplazás `auth.uid()`.
- **CI branching**: reescribir `scripts/ci/branch-helpers.sh` usando la API
  Neon (más simple que Supabase, soporte oficial vía
  [neondatabase/create-branch-action](https://github.com/neondatabase/preview-branches-with-vercel)).

**Estimación**: 3-6 sesiones (depende del nivel de RLS reescritura).

### 3.2 Auth: Supabase Auth → reemplazo

Opciones evaluadas:

| Opción                         | Setup   | Costo $                       | DX           | Risk                                                                                                                                                                   |
| ------------------------------ | ------- | ----------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth.js v5**                 | 2-3 ses | Gratis                        | Bueno        | Magic link funciona pero requiere persistir sessions en DB. Adapter Prisma maduro.                                                                                     |
| **Better Auth**                | 2-3 ses | Gratis                        | Excelente    | TypeScript-first, plugin ecosystem creciente. Más nuevo (menos battle-tested). [Better Auth docs](https://www.honogear.com/en/blog/engineering/best-auth-option-2026). |
| **Clerk**                      | 1 ses   | $25/mo mínimo + $0.02 per MAU | Trivial      | Lock-in vendor. Para 150 miembros × 10 places = 1500 MAU = $30+/mo. UX consistente.                                                                                    |
| **Custom (Resend magic link)** | 3-5 ses | Gratis                        | Alto control | Reinventás auth. Tokens, rate limiting, sessions. Ya tenemos Resend integrado.                                                                                         |
| **Lucia**                      | —       | —                             | —            | **Descartado**: deprecated en Q1 2025 ([Wisp blog](https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth)). Migrar a Better Auth.                          |

**Lo que perdés concretamente**:

- `signInWithOtp` ya configurado con cross-subdomain cookies (`cookieDomain` en
  `src/shared/lib/supabase/cookie-domain.ts`).
- Refresh token rotation automática (manejada por `@supabase/ssr` middleware).
- Account linking si en el futuro sumás Google/Apple OAuth.
- El JWT con `aud: authenticated` y `sub: user.id` que las RLS policies usan.

**Estimación**: 2-5 sesiones según opción. Migración de la `User` table es
trivial (la `id` es CUID nuestro, no `auth.users.id` de Supabase — ya lo
desacoplamos). La `email` queda como FK lookup.

### 3.3 Realtime: Supabase Realtime → reemplazo

Opciones:

| Opción              | Setup   | Costo $                                     | UX impact | Risk                                                                                             |
| ------------------- | ------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| **Pusher Channels** | 1-2 ses | Free 100 conns / $49/mo Startup (500 conns) | Igual     | Vendor adicional. Latencia comparable. ([Pusher pricing](https://pusher.com/channels/pricing/)). |
| **Ably**            | 1-2 ses | Free 200 conns / $29/mo Pro                 | Igual     | Más feature-rich (presence + history). Costo similar.                                            |
| **Drop realtime**   | 1 ses   | Gratis                                      | Degradado | Thread sin presence + new comments require manual refresh / polling. UX peor pero funcional.     |
| **Self-hosted ws**  | —       | —                                           | —         | **Descartado**: no funciona en Vercel serverless. Requeriría servidor dedicado.                  |

**Lo que perdés concretamente**:

- Presence en thread (burbujas verde) — feature `discussions/presence/`,
  ~123 líneas (`thread-presence.tsx`).
- New comments en vivo — feature `discussions/comments/use-comment-realtime.tsx`.
- La abstracción `src/shared/lib/realtime/` (899 líneas, 14 archivos) ya está
  diseñada transport-agnostic (`BroadcastSender/Subscriber` interfaces).
  **Sólo cambia el adapter** (`SupabaseBroadcastSender` → `PusherSender`).
- RLS-protected channels (canales privados con verificación de membership por
  policies SQL). Pusher/Ably tienen auth via webhook signing — diferente patrón.

**Estimación**: 1-2 sesiones para swap del adapter. 0 sesiones si decidís
"drop realtime" (sólo eliminar imports y mostrar mensaje "refrescá para ver
mensajes nuevos" — viola levemente el principio de "presencia silenciosa" pero
el producto sigue siendo usable, ver `docs/realtime.md` § Fallback sin realtime).

### 3.4 Storage: Supabase Storage → reemplazo

| Opción            | Setup   | Costo $                                  | Notas                                                     |
| ----------------- | ------- | ---------------------------------------- | --------------------------------------------------------- |
| **Vercel Blob**   | 1 ses   | $0.023/GB-mo storage + $0.05/GB transfer | API simple, bien integrado con Vercel. Mismo costo S3.    |
| **Cloudflare R2** | 1-2 ses | $0.015/GB-mo storage + $0 egress         | 50-80% más barato si hay mucho download. Setup S3-compat. |
| **AWS S3**        | 2 ses   | $0.023/GB-mo storage + $0.09/GB egress   | Más complejo IAM. No worth vs Vercel Blob.                |

**Estimación**: 1 sesión Vercel Blob (la opción default). Migración de assets:
script `download from Supabase → upload to Blob → update URLs en DB`. Trivial.

### 3.5 Migrations CI

- Reescribir `scripts/ci/branch-helpers.sh` para Neon (1-2h, no full sesión).
- Reescribir el harness RLS si decidís reemplazar `auth.uid()` (incluido en
  3.1).

### Total trabajo migración

| Escenario                                                        | Sesiones estimadas                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **A — No migrar**                                                | 0                                                                                                     |
| **B — Sólo Postgres (mantener Supabase Auth/Realtime/Storage)**  | 3-5 (Postgres + RLS rewrite + tests)                                                                  |
| **C — Migración total (Neon + Auth alt + Pusher + Vercel Blob)** | 10-18 (3-6 Postgres + 2-5 Auth + 1-2 Realtime + 1 Storage + 2-3 testing/integración + 1-2 CI rewrite) |

---

## 4. Riesgos y trade-offs honestos

### Riesgos del Escenario C (migración total)

1. **Place está pre-MVP**. Cambiar 4 servicios al mismo tiempo durante pre-MVP
   es alto riesgo. Cada servicio tiene su propia superficie de bugs (Auth =
   sessions/tokens; Realtime = canal auth + reconnect; Storage = signed URLs;
   Postgres = pooling/RLS).
2. **Pérdida de RLS comprehensive en flight**. El plan
   `docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md` tiene `auth.uid()`
   como pieza central. Migrar antes de ejecutarlo deja la app sin defense-in-depth
   en producción inicial.
3. **Pérdida de magic link cross-subdomain configurado**. El stack actual
   tiene cookies cross-subdomain probadas (E2E + unit tests + browser
   compatibility con Mobile Safari, ver
   `docs/decisions/2026-04-22-mobile-safari-webkit-flows.md`). Reimplementar con
   Auth.js o Better Auth requiere re-validar todo el flow.
4. **Lock-in se desplaza, no desaparece**. Hoy: lock-in a Supabase + Vercel.
   Después: lock-in a Neon + Vercel + Pusher + Vercel Blob + (Clerk|Auth.js+adapter).
   **Más vendors = más superficie de cambio en breaking changes**, no menos.
5. **Multi-vendor outage matrix más compleja**. Hoy: si Supabase cae, todo cae
   (un solo vendor). Después: outage de Pusher = sin realtime; outage de Neon =
   DB caída; outage de Auth provider = no logins; outage de Vercel Blob = sin
   avatares. **No reduce blast radius, lo desacopla**, lo cual es una propiedad
   distinta (recovery por servicio vs full down).
6. **Sin Supabase Realtime, perdemos thread presence + live comments**.
   `docs/realtime.md` define qué SÍ usamos: presence + new comments en thread.
   Sin esto, la UX core de discusiones se degrada — viola "presencia silenciosa"
   y "los lectores son parte de la conversación" del DNA del producto.

### Riesgos del Escenario A (no migrar)

1. **Te quedás con un proveedor único**. Si Supabase quiebra/sube de precio
   abruptamente/decide deprecar features, cambiar es caro.
2. **Sin Edge runtime, no podés llegar a TTFB <50ms para usuarios LATAM/EU
   sin más palancas** (CDN cache, ISR, edge middleware tiene sus límites).
3. **El plan B de migración futura escala con el tamaño del repo**. Hoy
   migrar son 10-18 sesiones. En 6 meses con +40 features cobrando, son 30+.

### Riesgos del Escenario B (sólo Postgres)

1. **Mantener 2 cuentas (Supabase + Neon)** dobla el overhead operacional:
   2 dashboards, 2 sets de credentials, 2 monitoring dashboards, 2 incidents
   pages.
2. **RLS rota o desactivada**. Si Supabase Auth emite el JWT pero Neon hostea
   la DB, las RLS policies con `auth.uid()` no funcionan porque Neon no tiene
   esa función. Tendrías que:
   - Desactivar RLS y depender 100% de filtros app-side (regresión vs el plan
     `2026-05-01-rls-comprehensive-pre-launch.md`), o
   - Reimplementar `auth.uid()` en Neon con un schema custom + GUC seteado por
     el adapter — overhead alto + bug-prone.
3. **Realtime de Supabase necesita acceso a la DB para sus policies** (los
   canales privados verifican membership via SQL en `realtime.messages` con
   policies que joinean a tablas de la app). Si la DB se va a Neon, las
   policies de Supabase Realtime quedan rotas. **Esto rompe el modelo de
   canales privados con auth.** Sería necesario o desactivar canales privados
   (riesgo de seguridad) o migrar también Realtime.

**Conclusión Escenario B**: técnicamente posible para "Postgres-only" puro,
pero **incompatible con mantener Supabase Realtime con canales privados +
membership-aware policies**. En la práctica, el Escenario B se reduce a
"Postgres-only sin RLS y sin Realtime con auth", lo que es un downgrade real
del modelo actual.

---

## 5. Recomendación final por escenario

### Escenario A — No migrar a Neon ahora **(RECOMENDADO)**

**Cuándo elegirlo**:

- TTFB warm está en rango aceptable (≤150 ms p95). **HOY: 87-92 ms ✅**.
- FCP no es bloqueador conversion (≤1s). **HOY: 696-772 ms ✅**.
- Pre-MVP o early-MVP — estabilidad > velocidad de migración.
- El producto se sirve mayoritariamente desde US East (cerca de `iad1`) o desde
  LATAM con tolerancia a RTT moderada.
- Se planea ejecutar el RLS comprehensive (`docs/decisions/2026-05-01-...md`)
  antes del launch — Neon rompe ese plan.

**Acciones inmediatas**:

- Ejecutar RLS comprehensive como planeado.
- Continuar optimizando palancas no-DB para FCP (bundle splitting, ver
  `docs/plans/2026-05-08-bundle-splitting-fase-2.md`).
- **Re-evaluar este doc en 3-6 meses** o cuando los criterios de §6 cambien.

### Escenario B — Migrar sólo Postgres a Neon

**Cuándo elegirlo**:

- Te interesa Edge runtime para llegar a usuarios fuera de US East con TTFB
  <100 ms.
- Estás OK con desactivar RLS y volar 100% con filtros app-side (regresión
  documentada).
- Estás OK con reemplazar también Supabase Realtime (porque los canales
  privados se rompen sin la DB en Supabase) → en realidad esto ya es **Escenario
  C parcial**.
- **NO recomendado pre-MVP**.

### Escenario C — Migración completa

**Cuándo elegirlo**:

- Place crece a 10k+ usuarios o 1k+ places y la latencia es bottleneck medido.
- Hay equipo ≥2 devs para absorber el churn de aprender 4 vendors nuevos.
- Hay presupuesto para Pusher ($49/mo+) o Ably + auth provider pago si se elige.
- Hay tolerancia a 2-3 semanas de slowdown del producto durante la migración +
  estabilización.

**No recomendado pre-MVP**.

---

## 6. Criterios objetivos de decisión

Checklist condicional. Re-evaluar cada 3 meses.

| Criterio                                                             | Acción                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| TTFB p95 ≤150 ms sostenido                                           | **Quedarse en A**                                                                                                  |
| TTFB p95 >200 ms sostenido por 1 semana                              | Considerar B o C, pero primero auditar palancas no-DB (bundle, queries, cache)                                     |
| FCP p95 ≤1s sostenido                                                | **Quedarse en A**                                                                                                  |
| Necesidad de servir LATAM/EU con FCP <600 ms p95                     | Considerar **C parcial** (Edge runtime + Neon HTTP) — pero validar con experimento real, no asumir mejora          |
| Equipo crece a ≥2 devs                                               | El overhead multi-vendor de C deja de doler tanto. **C se vuelve viable**                                          |
| Supabase sube precio >2x o tiene 2+ outages >1h en un trimestre      | Acelerar migración a B+ o C según criticidad                                                                       |
| Place llega a 10k+ usuarios activos                                  | Re-medir todo. A esta escala las suposiciones cambian (cold start frequency, throughput, costos)                   |
| Llegamos al RLS comprehensive launch sin migrar                      | **Quedarse en A indefinido** — migrar después rompe el modelo RLS recién instalado. Cambio sólo si forced (vendor) |
| Necesitamos `auth.users` con OAuth complejo (Google + Apple + SSO)   | Re-evaluar — Supabase Auth ya cubre, pero Clerk lo hace mejor. **C parcial: sólo Auth → Clerk**                    |
| Branches de CI son bottleneck del developer flow (>5 min por run)    | Migrar branching → Neon Branches (mejora marginal). No requiere migrar el resto                                    |
| Quiero Postgres con scale-to-zero para ahorro en proyectos paralelos | Neon es estrictamente mejor. Pero esto no es Place — es otro proyecto                                              |

---

## Apéndice — Sources

Benchmarks y docs consultadas:

- [Neon Latency Benchmarks (live)](https://neon-latency-benchmarks.vercel.app/)
- [Neon serverless driver docs](https://neon.com/docs/serverless/serverless-driver)
- [Neon: choosing your connection method](https://neon.com/docs/connect/choose-connection)
- [Neon: sub-10ms Postgres queries for Vercel Edge Functions](https://neon.com/blog/sub-10ms-postgres-queries-for-vercel-edge-functions)
- [pkgpulse: pg vs postgres.js vs @neondatabase/serverless 2026](https://www.pkgpulse.com/blog/pg-vs-postgres-js-vs-neon-serverless-postgresql-drivers-2026)
- [Prisma docs: Neon adapter](https://www.prisma.io/docs/orm/overview/databases/neon)
- [@prisma/adapter-neon npm](https://www.npmjs.com/package/@prisma/adapter-neon)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [Vercel KB: cold start performance](https://vercel.com/kb/guide/how-can-i-improve-serverless-function-lambda-cold-start-performance-on-vercel)
- [Wisp blog: Lucia Auth is Dead](https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth)
- [Better Auth (HonoGear 2026)](https://www.honogear.com/en/blog/engineering/best-auth-option-2026)
- [Pusher Channels pricing](https://pusher.com/channels/pricing/)
- [Vercel Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Cloud storage pricing comparison (R2 vs S3 vs Supabase, 2026)](https://www.buildmvpfast.com/api-costs/cloud-storage)

ADRs internos referenciados:

- `docs/decisions/2026-05-01-rls-comprehensive-pre-launch.md`
- `docs/decisions/2026-04-22-e2e-rls-testing-cloud-branches.md`
- `docs/decisions/2026-04-21-shared-realtime-module.md`
- `docs/decisions/2026-04-22-mobile-safari-webkit-flows.md`
- `docs/realtime.md`
- `docs/stack.md`
- `CLAUDE.md` § Gotchas (PrismaClient cache, pgbouncer connection limits, RLS harness, Supabase Realtime auth)

Mediciones internas:

- `src/db/client.ts` — config actual de pool TCP + adapter Prisma.
- Mediciones citadas en el brief del usuario (commit `e69ef18`, post-Ohio).
