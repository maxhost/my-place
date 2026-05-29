# Tech debt closure pre-V1.3 — tracker

**Origen**: audit de 2 rondas (10 agents read-only) post-V1.2 cierre (commit `3be5eec`, tag `baseline/feature-e-invite-v1.2-done`, 2026-05-28). Identificó **~60 items** de deuda técnica + gaps de docs + ausencia de hardening production-grade.

**Objetivo**: cerrar TODA la deuda técnica antes de iniciar V1.3 para tener codebase **estable, documentado y listo para construir arriba sin volver a fixes retroactivos**.

**Save point inicial**: `baseline/pre-phase-0-tech-debt` = `3be5eec` (= `baseline/feature-e-invite-v1.2-done`).

---

## Reglas operativas (canon)

1. **Save point pre-phase**: antes de iniciar una phase, crear tag `baseline/pre-phase-<N>-tech-debt` apuntando al commit corriente. Es el rollback target si la phase se descarta a mitad.
2. **Commit entre sesiones**: cada sesión cierra con commit dedicado + push (cuando corresponda). NO se acumulan cambios cross-sesión sin commit.
3. **Compact/clear ~40% contexto**: más conservador que CLAUDE.md §60%. Al abrir una sesión, si el contexto venía cargado, `/compact` ANTES de arrancar.
4. **Sesiones cabe en una ventana**: cada sesión scopeada a 30min-3h dev, ejecutable íntegra en una sola ventana de contexto sin spillover. Si una sesión se infla mid-ejecución, pausar + subdividir.
5. **Tag post-sesión opcional intra-phase**: si la sesión es load-bearing (e.g. observability), tag `baseline/phase-<N>-<letra>-<slug>-done`.
6. **Tag post-phase**: al cerrar phase N, tag `baseline/phase-<N>-tech-debt-done`. Save point pre-phase (N+1) = mismo commit.

---

## Status global

| Phase | Sesiones | Completadas | Tag pre-phase | Tag post-phase |
|-------|----------|-------------|---------------|----------------|
| **0 — Bloqueantes** | 5 | 5/5 | `baseline/pre-phase-0-tech-debt` ✅ | `baseline/phase-0-tech-debt-done` = `204a124` ✅ (pushed) |
| **1 — Hardening** | 7 | 4/7 | `baseline/pre-phase-1-tech-debt` = `f577908` ✅ | _pending_ |
| **2 — Tests + docs** | 9 | 0/9 | _pending_ | _pending_ |
| **3 — Polish** | 6 | 0/6 | _pending_ | _pending_ |
| **4 — Backlog V1.3 mid** | — | — | n/a (no sesiones predefinidas) | n/a |

**Progreso total**: 9/27 sesiones · ~50h dev estimadas si serial · esfuerzo Phase 0+1 (mínimo viable pre-V1.3) = ~3.5 días dev.

---

## Phase 0 — Bloqueantes absolutos (5 sesiones, ~10-12h)

**Save point**: `baseline/pre-phase-0-tech-debt` = `3be5eec`

Sin estos items V1.3 introduce regresiones invisibles o bloquea onboarding.

### Sesión 0.A — Quick wins UI + dep fix [~45min] ✅

- [x] Fix `bg-primary`/`text-primary-foreground` muertos en `src/features/custom-domain-routing/ui/sso-fallback-panel.tsx:131` + `auth-gate.tsx:122` → reemplazados por `cta inline-flex w-fit items-center justify-center rounded-md px-5 py-2.5 text-sm font-medium`. La clase `.cta` (globals.css:67-75) cubre background+color+hover; `:focus-visible` global cubre outline. Removidos: `bg-primary`, `text-primary-foreground`, `transition-colors`, `hover:bg-primary/90`, 3× `focus-visible:outline-*`
- [x] Gate auth en `src/features/style-assist/suggest-style-action.ts:48` → agregado import `getCurrentUserIdentityForRequest` + early return `{status: "unavailable"}` si `identity === null`. Degrada al mismo branch que falla LLM (consistente con contrato del slice ADR-0005 §5: "asistencia opcional, su caída jamás rompe el wizard"). JSDoc actualizado con sección "Auth gate (Phase 0.A)" explicando rationale anti-cost-amplification
- [x] Reclasificar `ws` (`^8.20.1`) de `devDependencies` → `dependencies` en `package.json`. Lockfile regenerado con `pnpm install` (sin cambios estructurales, solo reclassification)

**Acceptance**: typecheck ✅ · lint ✅ · `ws` ahora en deps → `pnpm install --prod` lo incluirá (verificado con grep en package.json post-edit)

**Commit**: _ver siguiente commit_ · **Tag**: _no aplica (no load-bearing)_

---

### Sesión 0.B — DX docs foundation [~1.5h] ✅

- [x] Rewrite `README.md` root: ~150 LOC con Quick start (5 comandos) + Prerequisites + Setup local detallado (5 pasos numerados) + Scripts table + Testing section + Deploy + Mapa de docs (12 entries) + Arquitectura en 30 segundos + Contribuir. Reemplaza boilerplate `create-next-app` (37 LOC). Apunta a `CLAUDE.md` como reglas operativas + `docs/` por dominio
- [x] `.env.example` checked-in (gitignore excepción `!.env.example` agregada): 14 env vars usadas en código + 2 planned V1.3+ (`RESEND_API_KEY`, `AI_GATEWAY_API_KEY`). Organizado por bloque (Database / Neon Auth / App / Vercel Domains / SSO / Planned) con comentario inline + scope hint + dónde sacar cada secret. Cross-checked vs `grep process.env.*` exhaustivo
- [x] `docs/stack.md` §"Variables de entorno" rewriteada para resolver drift:
  - `DATABASE_URL_UNPOOLED` (no usada) → renombrada a `DATABASE_URL_MIGRATE` (nombre real del código)
  - Agregadas `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (requeridas por workflow tests.yml + harness db-test-pool.ts)
  - Agregada `VERCEL_ENV` (mention only, Vercel auto-inject)
  - `RESEND_API_KEY` marcada **Planned for V1.3** (lifecycle email ADR-0003, hoy NO consumida)
  - `AI_GATEWAY_API_KEY` marcada como consumida internamente por SDK `ai` (slice `style-assist` dormido por ADR-0020)
  - Bloque rewriteado como prosa estructurada (bloques operativos) en lugar de duplicar el `.env.example`. El `.env.example` es ahora el canon de referencia operativo

**Acceptance**: nuevo dev levanta entorno local con solo README + .env.example ✅ · stack.md no tiene env drift ✅ · .env.example versionado (gitignore exception) ✅

**Commit**: _ver siguiente commit_ · **Tag**: _no aplica (no load-bearing)_

---

### Sesión 0.C — CI gates [~1h] ✅

- [x] Workflow nuevo `.github/workflows/tests.yml` creado (decisión: separado, no extender lighthouse.yml). Corre `pnpm test` (vitest full: node + ui projects) en `pull_request: branches:[main]`. Header documenta setup canon de GitHub secrets `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (rol `app_system` + `neondb_owner` del branch `test` de Neon). Timeout 15min con margen para cold-start Neon
- [x] Trigger `pull_request` (no solo push). Igual que `lighthouse.yml`
- [x] **Snapshots Drizzle: hallazgo del audit reinterpretado**. La ausencia de 0009-0024 NO es bug — es **convención del proyecto**: Drizzle genera snapshots solo para schema-only migrations (CREATE TABLE, ALTER COLUMN); las 0009-0024 son custom SQL (RLS policies, DEFINERs, GRANTs, partial indexes) que Drizzle NO modela en su schema TS. Documentado en `docs/data-model.md` §"Migrations & snapshots" con: (a) los 2 tipos de migrations que conviven, (b) protocolo para futuras (cuándo `pnpm db:generate` vs hand-written), (c) rollback strategy + reverse SQL canon en comentario al inicio del `.sql`

**Acceptance**: workflow file válido (yaml lint OK por estructura) · doc §"Migrations & snapshots" explica protocolo · Agent 5 finding reinterpretado correctamente como convention, no como gap a cerrar

**Notas operativas pendientes para user**: agregar GH secrets `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (instrucciones step-by-step en header del workflow). Sin esos secrets, los tests `node` fallarán con connection refused — flag explícito de "setup pendiente", no regresión.

**Commit**: _ver siguiente commit_ · **Tag**: _no aplica (no load-bearing)_

---

### Sesión 0.D — Edge config: security headers + rate limit (Upstash) [~3-4h] ✅

**Decisiones de la sesión (post-revisión con user)**:
- **NO `vercel.json` ahora** — Opción B. `preferredRegion` ya canónico per-page (ADR-0006), framework + build auto-detect Vercel + package.json. `vercel.json` se crea el día del primer cron concreto (registro intermedio si emerge).
- **NO CSP en esta sesión** — Permissive sería throwaway (Phase 2.I lo va a rehacer strict con nonces). Skipear evita 15min de work descartable + ahorra "¿bug en CSP o en código?" durante el resto de Phase 0.

**Items cerrados**:
- [x] Security headers en `next.config.ts` `headers()` (constante `SECURITY_HEADERS` + `source: "/(.*)"`):
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2 años, preload-ready)
  - `X-Frame-Options: DENY` (anti-clickjacking, no embedding V1)
  - `Referrer-Policy: strict-origin-when-cross-origin` (privacy + analytics balance)
  - `Permissions-Policy: geolocation=(), camera=(), microphone=()` (todo bloqueado V1)
  - `X-Content-Type-Options: nosniff` (anti-MIME-sniffing)
- [x] Wrapper rate-limit en `src/shared/lib/rate-limit/`:
  - `types.ts` — `RateLimitKind` + discriminated `RateLimitResult`
  - `config.ts` — `RATE_LIMITS: Record<Kind, {tokens, window}>` (canon de thresholds)
  - `get-request-ip.ts` — `getRequestIp()` async + `parseForwardedIp()` sync (route handlers)
  - `index.ts` — `enforceRateLimit(kind, identifier)` con singleton lazy + fail-loud-prod / skip-dev
  - `__tests__/` — 18 unit tests (mocks `@upstash/ratelimit` + `@upstash/redis`), 100% paths cubiertos
- [x] Wire 6 endpoints:
  - `loginAction` (5/min/IP — anti-brute-force) → `{status: "rate_limited", retryAfterSeconds}`
  - `signUpAccountAction` (3/h/IP — anti-spam signup) → idem
  - `acceptInvitationAction` (5/min/IP) → `{kind: "rate_limited", retryAfterSeconds}` en error union
  - `createInvitationAction` (30/h/IP+placeId — owner batches OK) → `error: "rate_limited"`
  - `sso-init` route (10/min/IP) → `429` con `Retry-After` header (RFC 9110)
  - `sso-issue` route (10/min/IP) → idem
- [x] UI consumers + i18n strings en 6 locales (es/en/fr/pt/de/ca):
  - `AccessLabels.rateLimitedNotice` (con `{seconds}` interpolado client-side)
  - `InviteMemberModalLabels.errorRateLimited` (sin interpolación — 30/h alcanza)
  - `InviteAcceptancePanelLabels.errorRateLimited` (con `{seconds}`)
  - Wiring en `login/page.tsx`, `build-shell-labels.ts`, `invite/[token]/page.tsx` (`t.raw` donde hay placeholders)
- [x] `.env.example` agregadas `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` con setup instructions (~3min upstash.com free tier)
- [x] `docs/stack.md` — fila "Rate limiting" en tabla + entrada §Variables de entorno con behavior por entorno

**Acceptance**: typecheck ✅ · lint ✅ · 211 UI tests + 125 node tests (pure) verdes · 18 tests nuevos del wrapper verdes · headers definidos en `next.config.ts` (apply en build) · setup `.env.example` documenta provisioning user-side.

**Notas operativas pendientes para user** (post-merge):
1. Sign up upstash.com + create Redis DB free tier (~3min)
2. Setear `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` en Vercel env vars (Production + Preview scopes)
3. Sin esos vars en prod, app crashea al primer rate-limit check (fail-loud, deploy bloqueado) — DELIBERADO, evita deploy silencioso sin protección

**Smoke deferido a deploy**: curl `-I` apex valida headers; 11vo request en endpoint protegido valida 429. NO testeable en `pnpm dev` sin Upstash creds locales (skip + warn path).

**Commit**: _pending_ · **Tag**: `baseline/phase-0-D-edge-config-done` (load-bearing)

---

### Sesión 0.E — Observability stack [~2.5h efectivo · estimado original 4-6h] ✅

**Decisiones de la sesión (post-revisión con user)**:
- **Stack elegido**: Sentry (Vercel-native integration). Análisis prosa de 4 opciones (Sentry, BetterStack, Axiom, híbrido) en ADR-0047 §"Alternativas rechazadas". User confirmó "A" sin override.
- **NO fail-loud-prod sin SENTRY_DSN** — Sentry NO es control de seguridad (a diferencia de rate-limit Phase 0.D). Si la integración Vercel × Sentry no se completó pre-deploy, SDK init es no-op silencioso. Trade-off explícito en ADR-0047 §"Alternativas rechazadas" — δ.
- **Diagnóstico actualiza estimado del original**: la estimación de "wire 90 console.*" en el plan resultó conservadora — realidad fue **26 callsites en 12 archivos** (todo `console.error` excepto 1 warn de rate-limit; cero `console.log` debug spam — hygiene ya estaba limpia). E2 ejecutó en ~1h vs ~2-4h estimado.

**Items cerrados**:
- [x] ADR-0047 (`docs/decisions/0047-observability-sentry.md`) — rationale Sentry + 6 alternativas rechazadas (BetterStack, Axiom, híbrido, fail-loud-prod, DIY logger, DataDog APM) + future-eject path low-cost vía wrapper. Indexada en `docs/decisions/README.md` (insertada antes de 0044 — orden numérico, no histórico-secuencial)
- [x] Dependency `@sentry/nextjs@^10.55.0` instalada + approve-builds setup `@sentry/cli` (postinstall via `pnpm.onlyBuiltDependencies` field para source maps CI)
- [x] Wrapper `src/shared/lib/observability/log.ts` + 7 unit tests (`__tests__/log.test.ts` con mock de `@sentry/nextjs`):
  - API: `log.info(meta, msg)`, `log.warn(meta, msg)`, `log.error(err, meta, msg)`
  - Mapping: info→solo console.info structured JSON (NO Sentry — quota burn); warn→console.warn + captureMessage(warning); error→console.error + captureException
  - Defense-in-depth: SDK Sentry calls envueltos en try/catch (el caller path NUNCA rompe por blip de la lib)
  - TDD: red phase verificado primero, luego green
- [x] Archivos init Sentry (4 ubicaciones, convención Next 16):
  - `src/instrumentation.ts` — `register()` dispatch por runtime + `onRequestError` exportado del SDK
  - `src/instrumentation-client.ts` — Sentry init browser + `onRouterTransitionStart` hook
  - `sentry.server.config.ts` (raíz) — runtime Node.js, tracing disabled, debug=false
  - `sentry.edge.config.ts` (raíz) — runtime Edge (proxy.ts), mismo shape que server
- [x] `next.config.ts` wrap con `withSentryConfig`:
  - Composición externa al `withAnalyzer(withNextIntl(nextConfig))` chain
  - `silent: !CI` — quieto en local, verbose en Vercel build
  - `widenClientFileUpload: true` — más source maps client uploaded
  - `disableLogger: true` — bota Sentry logger del bundle client (~5KB savings)
  - `sourcemaps.deleteSourcemapsAfterUpload: true` — privacy + security (source maps NO referenciados desde bundle)
- [x] `src/app/global-error.tsx` — root error boundary (`"use client"`) con `useEffect → captureException(error)` + UI minimal Spanish con tokens "Papel cálido" inline-styled (preserva legibilidad si CSS providers rompieron)
- [x] `.env.example` — bloque Sentry con 5 vars (`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) + setup instructions step-by-step Vercel Marketplace × Sentry integration (~5min, auto-sync env vars)
- [x] `docs/stack.md` — fila "Observability" en tabla stack + entrada §Variables de entorno con behavior por entorno (prod sin DSN → no-op silent; dev → console.* fallback)
- [x] **E2 — Migración 26 callsites** (12 archivos): reemplazo `console.error(...)` → `log.error(err, {scope, ...meta}, msg)`. JSDoc references `console.error` actualizados a `log.error` con cita ADR-0047. Único `console.warn` (rate-limit startup) → `log.warn`. Único `console.error` ad-hoc de domains-shared.ts (no-DB warn) reclasificado a `log.warn` por semántica correcta. Archivos: place-locale-lookup, custom-domain-by-slug-lookup, custom-domain-lookup, invitation-preview-lookup, user-identity-by-id-lookup, sso-jti-consume, rate-limit/index (warn), vercel/domains-shared (warn), 2× custom-domain-verification/actions/get-custom-domain-status, archive-custom-domain, 2× register-custom-domain, get-place-for-zone (solo JSDoc ref).

**Acceptance**: typecheck ✅ · lint ✅ · 211 UI tests verdes · 7 tests nuevos wrapper verdes · 0 `console.*` en src/ no-test (sólo 6 references en el wrapper mismo, esperado) · ADR-0047 + README index sincronizados.

**Notas operativas pendientes para user** (post-merge):
1. Sign up en sentry.io (free tier 5k errors/mes)
2. Create Project → Next.js → name "place-prod"
3. Vercel Dashboard → tu proyecto → Integrations → Sentry → Install (~5min). Sincroniza AUTO las 5 env vars a Production + Preview scopes
4. Verificar en Vercel Settings → Environment Variables que aparecen
5. Sin esa integración, prod deployea pero SDK Sentry es no-op silencioso (perdés visibilidad de errors hasta que se complete). Distinto patrón vs Upstash Phase 0.D que sí fail-loud.

**Smoke deferido a deploy**: `throw new Error("sentry smoke test")` en una page protegida; verificar issue aparece en dashboard <30s; remover el throw.

**Commit**: _pending_ · **Tag**: `baseline/phase-0-E-observability-done` (load-bearing)

---

### 🏁 Cierre Phase 0

**Tag post-phase**: `baseline/phase-0-tech-debt-done` (apuntará al commit de 0.E2 o el último de la phase)

**Acceptance phase**: CI corre tests · README explica todo · .env.example completo · headers + rate limit configurados · observability operativa · zero CTAs muertos · suite vitest sigue 1135/113 verde · typecheck + lint verdes

---

## Phase 1 — Hardening pre-V1.3 (7 sesiones, ~12-14h)

**Save point**: `baseline/pre-phase-1-tech-debt` (= tag post-phase-0, crear al cerrar Phase 0)

Cleanup directo del cluster auth + DB + invite. Evita acumulación durante V1.3.

### Sesión 1.A — DB hardening [~2h efectivo] ✅

**Decisiones de la sesión (gap-scan 2026-05-28 + diagnostic empírico pre-apply)**:
- **Scope ampliado a 4 índices** (vs 3 listados originalmente): incluido `idx_membership_place_id` porque `membership(place_id)` también carecía de índice y 12+ usos en RLS policies + DEFINERs lo filtran. Cost marginal mínimo, mismo lock_timeout window.
- **Scope NO ampliado a `idx_membership_user_id`**: diagnóstico empírico pre-apply detectó `idx_membership_user_active(user_id, left_at, place_id)` ya existente desde migration 0004. Postgres leftmost-prefix rule garantiza cobertura del filtro `WHERE user_id = X` sin necesidad de single-column duplicado (sería write amplification gratis sin beneficio query). Audit original había listado el gap, verificación empírica lo corrigió.
- **Migration 0023 zombie → Opción A (DROP)**: zero callers TS verificado por grep exhaustivo + ADR-0046 §D.fix.3 addendum anticipaba "considerar drop en V2 cleanup window" — Phase 1.A ES ese cleanup window anticipado. Append-only forward history respetado (0023 SQL file intacto + journal entry intacto; DROP vive en 0026).

**Items cerrados**:
- [x] Migration 0025 (`0025_fk_indexes_lock_timeout_canon.sql`) — 4 índices FK + canon `SET lock_timeout = '5s'`:
  - `idx_invitation_place_id ON invitation(place_id)`
  - `idx_place_domain_place_id ON place_domain(place_id)`
  - `idx_place_ownership_place_id ON place_ownership(place_id)` (crítico: cada policy/DEFINER lo filtra)
  - `idx_membership_place_id ON membership(place_id)` (RLS membership_sel/upd/del + 12+ DEFINERs)
- [x] Canon `SET lock_timeout = '5s'` documentado en `data-model.md` §"Protocolo para futuras migrations" (promovido de "Phase 3.7 pendiente" a canon transversal activo)
- [x] Migration 0026 (`0026_drop_zombie_lookup_user_email_by_id.sql`) — `DROP FUNCTION app.lookup_user_email_by_id(uuid)` con reverse SQL completo en header
- [x] ADR-0046 §"Addendum operacional — Phase 1.A tech-debt closure (2026-05-28)" — write-back de la decisión drop + rationale "cleanup window anticipado" + verificación empírica
- [x] `_journal.json` entries 25 + 26 agregadas
- [x] `data-model.md` header "Última actualización" + §"Migrations & snapshots" rango actualizado a `0000_*.sql … 0026_*.sql`
- [x] Apply via Neon MCP en test branch (`br-withered-darkness-apz87zyz`): 4 indexes verified via `pg_indexes` + `indisvalid=true` + EXPLAIN forzado (seqscan off) muestra Index Scan correcto en los 4 paths. Zombie DEFINER confirmed dropped via `pg_proc`. Production apply deferido al próximo deploy Vercel (canon ADR-0017 maybe-migrate.mjs auto-runs).

**Acceptance**: query planner usa index nuevo en EXPLAIN (verde, 4/4 índices) · DEFINER 0023 droppeada (verde) · ADR-0046 actualizada con decisión (verde) · typecheck verde · suite full verde (sin regresión esperada — wrapper TS ya borrado en D.fix.3.b).

**Commit**: _pending_

---

### Sesión 1.B — Auth hardening [~1h efectivo] ✅

**Decisiones de la sesión (gap-scan 2026-05-28)**:
- **Scope ampliado a `ports.ts` + `create-place.ts` + test** (vs sólo `actions.ts` listado originalmente): migrar el action al coordinator zone-aware obliga a dropear el campo `accessToken` del port `AcquiredIdentity` (el coordinator lee el token internamente — pasarlo desde afuera sería dead field). CLAUDE.md §"Avoid backwards-compatibility hacks like renaming unused _vars" prohíbe dejar el field muerto. Total 5 files (sobre el límite blando de 5 de CLAUDE.md, justificado como una migración coherente irreductible).
- **Dropeado `requireSessionJwt` de `shared/lib/session.ts`** (limpieza obligada por gap closure): post-migración el grep confirmó zero callers TS. Mantener una función exportada sin callers viola production-grade. `getSessionJwt` (Promise<string | null>) se mantiene — único consumer vivo: `db-for-request.ts` rama `neon-auth-needed` del coordinator.
- **Zod cozytech, no doxxer**: payload inválido → mismo status del fail-mode existente (`login_failed`/`signup_failed`/`error`), NO un nuevo tipo "validation_error". UX-equivalente a credenciales rotas; el detalle del schema no se expone al caller.
- **Open-redirect fallback explícito**: locale inválido en `logoutAction` → fallback al primer locale (`routing.locales[0]` = `es`) en vez de fallar/throw. Mantiene la garantía "logout siempre redirige al apex" y previene el ataque de inyección de segmento sin doxxear el rechazo.

**Items cerrados**:
- [x] Zod schemas en `src/features/access/auth-actions.ts`:
  - `loginInputSchema`: `email` regex `[^\s@]+@[^\s@]+\.[^\s@]+` + `password` min 8 chars
  - `signupInputSchema`: idem + `displayName` transform-trim + min 1 + max 80
  - Payload inválido → `login_failed`/`signup_failed` (cozytech)
- [x] Zod schema en `src/features/nav-hub/actions/logout-action.ts`:
  - `localeInputSchema = z.enum(routing.locales)` (SoT i18n ADR-0024)
  - Inválido → fallback `routing.locales[0]` (open-redirect protection)
- [x] Migrado `src/features/place-creation/actions.ts` (`createPlaceAction`):
  - Dropeados imports `getAuth` + `requireSessionJwt` + `getAuthenticatedDb`
  - Adapter `sessionIdentity` ahora usa `getCurrentUserIdentityForRequest()` (zone-aware, DEFINER `app.lookup_user_identity_by_id`)
  - `runAuthedTx: getAuthenticatedDbForRequest` (direct pass-through al coordinator)
- [x] Reshape `src/features/place-creation/ports.ts`:
  - `AcquiredIdentity` drop `accessToken` (queda `{email, displayName}`)
  - `AuthedTxRunner` drop param `accessToken`; claims tipo `{sub: string}` (superset de `VerifiedClaims` Neon Auth + `LocalSessionClaims` SSO local)
  - Dropeado import `VerifiedClaims` (no usado post-reshape)
- [x] Saga `src/features/place-creation/create-place.ts`:
  - Las 2 invocaciones `ports.runAuthedTx(ident.accessToken, ...)` → `ports.runAuthedTx(...)` (1 arg)
- [x] Test `src/features/place-creation/__tests__/create-place.test.ts`:
  - FakeDb expone `currentSub` (setter por test), reemplaza el bridge `JSON.parse(accessToken)`
  - 8 tests adaptados: `acquireIdentity` retorna `{email, displayName}` (sin `accessToken`); `db.currentSub` se configura pre-llamada
- [x] Dropeado `requireSessionJwt` de `src/shared/lib/session.ts` (zero callers post-migration); header reescrito documentando que `getSessionJwt` es el único helper y que el patrón canon ahora es coordinator zone-aware

**Acceptance**: typecheck verde ✅ · lint verde ✅ · 59 tests focales verdes (place-creation + access + nav-hub) ✅ · **node project aislado: 949/949 verde** (baseline idéntico a Phase 1.A — cero regresión) ✅ · **UI project aislado: 211/211 verde** ✅ · grep `requireSessionJwt` retorna SOLO la definición histórica en `session.ts` (cero callsites) + menciones en comentarios históricos ✅

**Nota infra (no bloqueante 1.B)**: `pnpm test` (= `vitest run` sin filtro de project, ambos en paralelo) reportó 7 files/26 tests failed con stack trace WebSocket close en `lookup-place-by-domain.test.ts` (node DB test). Aislados los 2 projects se obtiene verde total → interferencia concurrente al correr ambos en paralelo (connection pool Neon / WS disconnect), NO regresión. Pre-existente al cambio de 1.B; pendiente para Phase 2 / 3 investigar config `vitest.config.ts` (e.g. `pool.threads`, `maxConcurrency` por project). Workflow CI separa los projects (no concurrencia) → no afecta gates.

**Commit**: _pending_

---

### Sesión 1.C — Tests infra + cleanup schema [~2.5h] ✅

- [x] Crear `src/db/__tests__/_factories/index.ts` (single file, ~180 LOC) con helpers reutilizables:
  - `makeUser(tx, overrides?)` → seed `app_user` (counter monotónico para defaults únicos)
  - `makePlace(tx, {founderUserId, slug?, ...})` → place + `place_ownership` del founder (opt-out con `ownerSeed: false`)
  - `makeOwnership(tx, {userId, placeId})` → row extra de `place_ownership` (co-owners)
  - `makeMembership(tx, {userId, placeId, leftAt?})` → membership active (NULL) o ex-miembro (leftAt date)
  - `makeInvitation(tx, {placeId, email, invitedByUserId, expiresInDays?, acceptedAt?})` → invitation row + token único 64-char
  - `captureError(tx, sql, params?)` → SAVEPOINT-based error capture {code, message} (extraído de 7 tests duplicados)
  - **Decisión 1.C**: `makeUser` siembra SÓLO `app_user` (NO `neon_auth.user`) — el harness inyecta claim `sub` por `set_config`, no por JWKS round-trip. Matched a la realidad actual de los tests; factory de `neon_auth.user` se agrega cuando V1.1+ un test la necesite (anti-premature-abstraction)
- [x] Refactor 3 tests integration proof-of-pattern: `create-invitation.test.ts`, `revoke-invitation.test.ts`, `remove-member.test.ts` (todos comparten `seedScenario` casi idéntico con 4-5 users + 2 places + memberships variadas). Cada uno -30 a -45 LOC del setup. NO migrados los otros 4 con `captureError` (proof suficiente; el resto se migra a demanda)
- [x] Drop campo `placeSlug` del `acceptInvitationSchema`:
  - Schema: removido `placeSlug: z.string().min(1).optional()` (con nota explicativa: el campo era para `revalidatePath` ya dropeado en V1.2 D.fix.4)
  - Tipo `AcceptInvitationInput`: heredado del schema (`z.infer`), automáticamente sin field
  - Action `accept-invitation.ts`: removido comment huérfano que decía "placeSlug ignorado post-D.fix.4"
  - Panel `invite-acceptance-panel.tsx`: removido prop + campo del POST (`acceptInvitationAction({ token })`)
  - Page `[token]/page.tsx`: removido `placeSlug={placeSlug}` del render del panel
  - Tests: `schemas.test.ts` (fusionado los 2 happy paths a uno solo, -1 test del count) + `invite-acceptance-panel.test.tsx` (removido `placeSlug` del `baseProps` + del `expect(action).toHaveBeenCalledWith`)

**Acceptance** (verificado 2026-05-28): typecheck ✅ · vitest node 948/948 ✅ (baseline 949, -1 esperado por test merge en schemas) · vitest ui 211/211 ✅. Tests refactoreados pasan con factories. Action recibe payload sin `placeSlug`.

**Decisión**: factories como `_factories/index.ts` single-file (vs un archivo por factory) — ~180 LOC totales, manejable; split a 1-archivo-por-factory cuando crezca a >300 LOC. Counter monotónico shared entre factories para evitar colisiones cross-factory en UNIQUE constraints.

**Commit**: _pending_

---

### Sesión 1.D — Pre-commit hook [~30min] ✅

- [x] Instalado lefthook 2.1.8 como devDep (preferido sobre husky por simplicidad + perf): `pnpm add -D lefthook`
- [x] `lefthook.yml` creado en root con pre-commit hook (3 commands en paralelo):
  - `typecheck` — `pnpm typecheck` full project (gated por `glob: "*.{ts,tsx}"` → solo corre si hay TS staged)
  - `lint` — `pnpm lint --max-warnings 0 {staged_files}` (glob: ts/tsx/js/jsx/mjs/cjs)
  - `secret-scan` — inline shell con 2 layers: (a) **filename guard** sobre `.env*` / `*backup*` / `credentials` / `secret` / `.pem` / `.key` / `*_token` / `id_rsa` / `id_ed25519` (whitelist `.env.example`) · (b) **content guard** sobre prefijos canónicos de tokens (`ghp_` / `gho_` / `ghs_` / `github_pat_` / `sk-` / `sk-ant-` / `AKIA` / `xox[baprs]-`) escaneando `git diff --cached -U0`
- [x] Script `prepare: "lefthook install || true"` agregado a `package.json` — `pnpm install` activa hooks automáticamente en clonado fresco (`|| true` para que no falle en envs sin git como Docker/Vercel)
- [x] README actualizado: §Setup paso 1 anota que `pnpm install` activa lefthook · §Contribuir reemplaza el "pendiente Phase 1.D" por la descripción de los 3 guards activos + bypass `--no-verify`

**Acceptance verificada** (vía `lefthook run pre-commit --file <X> --command <Y> --force`):
- ✅ `.env.production` staged → secret-scan exit 1 con mensaje `Archivos con nombre sospechoso de credencial en staging:`
- ✅ archivo `.ts` con type error → typecheck exit 2 con `TS2322: Type 'string' is not assignable to type 'number'`
- ✅ clean run sobre lefthook.yml → todos los commands exit 0 en ~5.3s (`typecheck 2.4s`, `lint 5.3s`, `secret-scan 0.02s`)
- ✅ `rm .git/hooks/pre-commit && pnpm install` → hook re-creado automáticamente (prepare script funcional)
- ✅ **multi-file clean (regresión)** — N=5 files staged → secret-scan exit 0 (caught + fixed bug: ver Bug capturado abajo)

**Bug capturado mid-sesión** (`set -- {staged_files}` fix):
- **Síntoma**: primer commit real (5 files staged) → `sh: line 1: docs/tech-debt-pre-v1.3.md: Permission denied · exit status 1`.
- **Causa**: `{staged_files}` de lefthook expande como tokens quoted (`"f1" "f2" "f3"`), diseñado para inyectarse como args a un comando externo (`eslint {staged_files}` ✓). Mi script lo asignaba con `files="{staged_files}"` → expansión literal `files="f1" "f2" "f3"` → shell interpreta `"f2"` como comando a ejecutar.
- **Por qué no lo capturó el acceptance original**: los tests usaban `--file <único>`, N=1 staged. Con un solo file `files="f1"` es válido y no se rompe. El bug solo aparece con N≥2.
- **Fix**: reemplazar `files="{staged_files}"` por `set -- {staged_files}` — los positional args `"$@"` manejan N≥0 con quoting correcto (soporta paths con espacios).
- **Gap method**: agregado **TEST 4 multi-file clean** al set de acceptance + commit real del cierre de 1.D pasa por su propio hook end-to-end (5 files, 0 problemas).

**Decisiones 1.D**:
- **lefthook over husky**: lefthook es Go binary self-contained, sin runtime Node overhead pre-commit; husky requiere `.husky/` directory + shell wrappers más verbose. lefthook también soporta `parallel: true` nativo.
- **`|| true` en prepare**: lefthook detecta ausencia de `.git/` y exit 0, PERO defensive — en Docker/Vercel builds sin git, el `|| true` evita que `pnpm install` rompa.
- **Filename guard antes que content**: bloquea ANTES del scan más caro (regex sobre diff). Filename matches son O(1) sobre lista de paths.
- **Content scan sólo prefijos canónicos**: false positives muy bajos (`ghp_`/`sk-`/`AKIA`/`xox*` son extremadamente específicos). No incluí entropy-based detection — overkill para una primera iteración + alto riesgo de FPs.
- **Bypass documentado**: `--no-verify` está expuesto en README como escape hatch. CI corre lo mismo (typecheck + lint via `.github/workflows/tests.yml`), entonces bypass local no esquiva la red de seguridad full.

**Commit**: _pending_

---

### Sesión 1.E — Performance: React.cache wrap [~30min]

- [ ] Wrap `src/shared/lib/custom-domain-lookup.ts` `lookupPlaceByDomain` con `cache()` (23 callsites potenciales por render: proxy + page tree + SSO routes)
- [ ] Wrap `src/shared/lib/place-locale-lookup.ts` `lookupPlaceLocaleBySlug` con `cache()` (callsites en `getPlaceLocaleFallback` indirecto)
- [ ] Verificar JSDoc indica memoización per-request

**Acceptance**: typecheck verde · suite verde · grep `from "react"` muestra `cache` import en ambos archivos.

**Commit**: _pending_

---

### Sesión 1.F — Docs cleanup quick [~1.5h]

- [ ] 3 gotchas con pointers drift → reemplazar `file:line` por `file:symbol` (robusto al drift):
  - `docs/gotchas/rls-place-domain-owner-only.md`
  - `docs/gotchas/accept-invitation-requires-ensure-app-user-tx1.md`
  - `docs/gotchas/apex-login-returnto-honored.md` (+ nota explícita "Fix shippeado, este gotcha existe como referencia diagnóstica" porque describe estado pre-S11.3)
- [ ] `docs/features/README.md` líneas 58 + 82: marcar i18n como Core (6 locales op), mover "Acceso a datos" de TBD a Plataforma (Drizzle resuelto ADR-0004)
- [ ] `docs/features/onboarding/`: renombrar `README.md` → `spec.md` cerrando, O eliminar bloque ⚠️ "Pendiente de re-sync" + agregar nota deprecation explícita (slice deprecado post-ADR-0014, split en `place-wizard`/`place-creation`/`access`)

**Acceptance**: grep `line \d+` en `docs/gotchas/` retorna 0 (sin pointers numéricos frágiles) · features/README correcto · onboarding deprecation clara.

**Commit**: _pending_

---

### Sesión 1.G — Storage TBD: decisión + provisioning [~2h]

- [ ] Decisión Storage stack: Vercel Blob (recomendado por integración nativa) vs S3 (R2/AWS). Considerar: cost, lock-in, file types necesitados (logos place, avatares, library docs futuro), API ergonomics
- [ ] ADR nueva `docs/decisions/0048-storage-vercel-blob.md` (o nombre similar) con rationale + alternativas
- [ ] Provisioning Vercel Blob (o equivalente) + env var en Vercel (prod + preview)
- [ ] Wrapper `src/shared/lib/storage/blob.ts` mínimo: `uploadBlob(key, file, opts)` + `getBlobUrl(key)` + `deleteBlob(key)`. NO consume en código aún (solo provisioning para desbloquear V1.3 §ε logo_url + library/)
- [ ] Update `docs/stack.md` §Variables de entorno + §Storage marcando como RESUELTO

**Acceptance**: ADR creada + indexada · env var declarada · wrapper TS minimal con tests unit · sin consumers en código (solo platform ready).

**Commit**: _pending_ · **Tag**: `baseline/phase-1-G-storage-decided` (load-bearing)

---

### 🏁 Cierre Phase 1

**Tag post-phase**: `baseline/phase-1-tech-debt-done`

**Acceptance phase**: FK indexes activos · auth actions validan input · 1 patrón pre-ADR-0034 eliminado · factories tests proof-of-pattern · pre-commit hooks activos · 2 lookups memoizados · gotchas + features docs limpios · Storage decidido + provisionado.

---

## Phase 2 — Tests + docs completeness (9 sesiones, ~14-16h)

**Save point**: `baseline/pre-phase-2-tech-debt` (= tag post-phase-1)

V1.3 puede arrancar **en paralelo** con esta phase si recursos lo permiten. No bloqueante pero recomendable cerrar antes de scope creep.

### Sesión 2.A — Playwright setup + 1er E2E [~3h]

- [ ] Install Playwright: `pnpm add -D @playwright/test playwright`
- [ ] Config `playwright.config.ts`: 2 projects (chromium + webkit), baseURL apex prod, retries 2, parallel 4
- [ ] Script `pnpm e2e` en `package.json`
- [ ] 1er E2E crítico: **signup happy path** apex login → place creation wizard 3-step → land Hub. Asegurar fixtures de cleanup post-test (delete user creado)
- [ ] CI workflow `e2e.yml` opcional (correr en preview deploys, no en cada PR — costoso)

**Acceptance**: `pnpm e2e` corre verde local + en CI · cleanup test post-run · screenshot artifact en CI si falla.

**Commit**: _pending_

---

### Sesión 2.B — 2 E2E críticos restantes [~3h]

- [ ] E2E: **accept invite cross-domain** (escenario 4 V1.2: signup → SSO chain → accept en custom domain → Hub CD)
- [ ] E2E: **register custom domain** (owner → /settings/domain → add domain → wait DNS verify mock → activate)
- [ ] Refactor común a helpers si emerge pattern (`tests/e2e/_fixtures/`)

**Acceptance**: 3 E2E verdes en CI · runtime <5min total · 0 flaky en 3 runs consecutivas.

**Commit**: _pending_ · **Tag**: `baseline/phase-2-B-e2e-done`

---

### Sesión 2.C — Coverage + critical paths unit [~3h]

- [ ] Configurar `pnpm test --coverage` (vitest c8/v8) con threshold inicial: 70% global, 85% en `src/features/access` + `src/features/invitations`
- [ ] Comment coverage en PRs (action GitHub o Vercel)
- [ ] Unit tests faltantes (cubrir branches no testeadas):
  - `src/features/nav-hub/actions/logout-action.ts` (signOut OK / throws)
  - `src/features/access/auth-actions.ts` branches: `error → status:'signup_failed'`, `data?.token` falsy
  - Integration `app.invitation_preview` directo (no solo via wrapper)
  - Integration `app.lookup_user_email_by_id` (si decisión 1.A.iii = keep; skip si dropped)
- [ ] **Investigar flake `pnpm test` ambos projects en paralelo** (hallazgo Phase 1.B, 2026-05-28): `vitest run` sin filtro corre node + ui projects concurrentemente y reporta 26 fails (WebSocket close en `src/db/__tests__/lookup-place-by-domain.test.ts` y otros DB tests Neon). Aislados (`--project node` y `--project ui`) ambos verde total (949/949 + 211/211). Síntoma: contención de connection pool Neon + WS disconnect cuando jsdom workers de UI corren en paralelo con node DB workers. Pre-existente al cambio de 1.B (no regresión). Pendiente investigar config `vitest.config.ts`:
  - Probar `poolMatchGlobs` o `pool: "forks"` para isolation por project
  - Limitar `maxConcurrency` del project node (DB-bound, sequential-friendly)
  - O documentar como gotcha + ajustar workflow CI / `package.json` script local (separar `test:node` + `test:ui` en lugar de `test` único)
  - Workflow CI actual no afectado (corre los projects por separado)

**Acceptance**: coverage report visible en cada PR · threshold no rota tests existentes · 3-4 tests nuevos verdes · `pnpm test` no flakea o split en scripts separados con doc clara.

**Commit**: _pending_

---

### Sesión 2.D — Data-model gaps + ontologías stubs [~2h]

- [ ] `docs/data-model.md` agregar §"Catálogo DEFINER": tabla con 18 DEFINERs · migration · feature owner · ACLs canon
- [ ] Documentar policy `au_peer_member_read` (migration 0021, ADR-0038) en `data-model.md` §Auth
- [ ] Documentar tabla `app.sso_jti_used` (migration 0011) en `data-model.md` §"Anti-replay tables"
- [ ] Crear stubs `docs/features/{conversations,events,library}/spec.md` con §Estado="No empezada" + link a ontología canónica + §Pointers. Rompe convención CLAUDE.md hoy (ontología sin entrada features/)

**Acceptance**: data-model.md cubre 100% de DEFINERs + tablas + policies actuales · 3 features stubs creadas con shape consistente con specs existentes.

**Commit**: _pending_

---

### Sesión 2.E — Doc polish + cookie audit [~1.5h]

- [ ] Agregar §Pointers a `docs/features/inbox/spec.md` + `docs/features/settings/spec.md` (otros 7 tienen — homogeneizar)
- [ ] Update `docs/features/inbox/plan-sesiones.md` con timestamp final + nota "V1 implementada, S11.3 cerrada"
- [ ] Cookie Neon Auth SDK audit: verificar/setear explícito en `src/shared/lib/auth-config.ts` los flags `httpOnly`, `secure`, `sameSite` (zero-trust en SDK defaults)
- [ ] Documentar decisión `ON DELETE NO ACTION` en todas las FKs en `data-model.md` §Invariantes: justificar soft-delete + WORM-via-DEFINER

**Acceptance**: 9/9 features specs tienen §Pointers · cookie config explícita · cascade rules justificadas en doc.

**Commit**: _pending_

---

### Sesión 2.F — Backup + drifts deps [~1.5h]

- [ ] Documentar backup/PITR strategy en `docs/stack.md` §Datos: confirmar tier Neon, retention window, RPO/RTO, runbook de restore (link a Neon docs)
- [ ] Reclasificar dep `drizzle-orm`: schema-only no query builder (drift ADR-0004). Decisión: (a) update ADR-0004 reflejando uso real (schema-as-types + SQL raw via @neondatabase/serverless) o (b) migrar queries a Drizzle. **Recomendación a** (status quo funciona, ADR debería reflejar realidad)
- [ ] `docs/stack.md` env drift: `RESEND_API_KEY` + `AI_GATEWAY_API_KEY` declarados sin imports. Decisión drop o mark planned con timeframe

**Acceptance**: backup strategy clara · ADR-0004 actualizado O migration plan registrado · stack.md sin env vars fantasma.

**Commit**: _pending_

---

### Sesión 2.G — i18n strings + date format [~1h]

- [ ] Reemplazar strings hardcoded ES por translations:
  - `src/app/(app)/inbox/[locale]/not-found.tsx:13,15,21` (3 strings)
  - `src/features/custom-domain-routing/ui/sso-fallback-panel.tsx:137` ("Detalles técnicos")
- [ ] Agregar keys correspondientes a `messages/{es,en,fr,pt,de,ca}.json` (6 locales, verificar parity post-cambio)
- [ ] Date format en `src/features/invitations/ui/pending-invitations-tab.tsx:71`: cambiar `toLocaleDateString("es-AR", ...)` a usar `locale` prop del place

**Acceptance**: `pnpm check-translations` verde (0 missing) · pages cargan en EN/FR/etc sin string ES leaking.

**Commit**: _pending_

---

### Sesión 2.H — Suspense boundaries [~2-3h]

- [ ] Agregar Suspense boundaries en pages largas bajo `src/app/(app)/place/[placeSlug]/settings/*`:
  - `settings/members/page.tsx` (lista miembros + invitations pending)
  - `settings/page.tsx` (load place data)
  - `settings/domain/page.tsx` (load custom domain status)
- [ ] Crear `loading.tsx` por segment con skeleton consistente con DS
- [ ] Crear `error.tsx` por segment con error boundary + retry CTA
- [ ] Verificar que la shell streamea (RSC starts rendering antes de DB resolves), per ADR-0023

**Acceptance**: HAR de page muestra TTFB <300ms (vs antes 800ms+ con DB hold) · skeleton visible mientras DB resuelve · error tracker captura errors en boundary.

**Commit**: _pending_ · **Tag**: `baseline/phase-2-H-suspense-done` (UX-visible)

---

### Sesión 2.I — Strict CSP (nonce-based) + audit headers [~2-4h]

**Origen**: deferred desde Sesión 0.D (2026-05-28). Phase 0.D agregó 5 security headers en `next.config.ts headers()` pero NO incluyó Content-Security-Policy porque permissive CSP (con `'unsafe-inline'`) tiene valor marginal vs el costo de re-implementación cuando se vaya a strict.

**Por qué strict CSP**:
- Defense-in-depth principal contra XSS (vector más común en apps con user-generated content: nombre place, email invitee, displayName).
- Permissive (`'unsafe-inline'`) NO protege contra `<script>alert(1)</script>` inyectado en un sink.
- Strict con nonce per request bloquea TODOS los scripts no-firmados → atacante con XSS sink stuck.

**Items**:
- [ ] Generar nonce per request en `src/proxy.ts` (`crypto.randomUUID()` base64url) + setear header `Content-Security-Policy` con `'nonce-<nonce>'` + `'strict-dynamic'`.
- [ ] Propagar nonce a Next.js scripts via `next/headers` (`headers().get('x-nonce')`) en root layout(s); cada `<Script>` component lee el nonce de context.
- [ ] CSP directives finales:
  - `default-src 'self'`
  - `script-src 'self' 'nonce-<>' 'strict-dynamic'`
  - `style-src 'self' 'unsafe-inline'` (Tailwind v4 injecta inline; styled-jsx similar)
  - `img-src 'self' data: blob: https:` (avatares + logos place + Storage Phase 1.G)
  - `font-src 'self' data:`
  - `connect-src 'self' https://*.neon.tech wss://*.neon.tech https://*.upstash.io`
  - `frame-ancestors 'none'` (redundante con X-Frame-Options DENY pero CSP es authoritative)
  - `form-action 'self'`
  - `base-uri 'self'`
  - `upgrade-insecure-requests` (browser auto-upgradea http→https)
- [ ] Smoke verify: custom domain (`nocodecompany.co`), Hub, place page, login form, invite acceptance — confirmar 0 console errors CSP.
- [ ] Audit headers existentes Phase 0.D — ¿se puede tightener `Permissions-Policy` con más features (clipboard-write, etc.)?

**Acceptance**: page-load en prod retorna CSP con nonce dinámico · DevTools console muestra 0 errores CSP en flujos críticos · CSP report-uri opcional (Sentry Phase 0.E si vivo) loggea violaciones · permissive CSP eliminada de tracker.

**Commit**: _pending_ · **Tag**: `baseline/phase-2-I-csp-strict-done` (load-bearing)

---

### 🏁 Cierre Phase 2

**Tag post-phase**: `baseline/phase-2-tech-debt-done`

**Acceptance phase**: 3 E2E verdes en CI · coverage threshold enforced · data-model.md 100% coverage · 3 ontologías con stubs · backup strategy doc · zero i18n strings hardcoded · Suspense streaming en pages settings · strict CSP shippeado.

---

## Phase 3 — Polish + decisiones scope (6 sesiones, ~10-12h)

**Save point**: `baseline/pre-phase-3-tech-debt` (= tag post-phase-2)

Polish + decisiones scope que pueden hacerse durante V1.3 development sin bloquear.

### Sesión 3.A — Scope decisions [~1h]

- [ ] Decisión slice `src/features/member-profile/` (589 LOC órfano, `<HeadlineEditor />` NO montado en producción):
  - Opción A: V1.3 lo monta (definir cuándo + en qué page)
  - Opción B: parking-lot explícito con ADR `docs/decisions/0049-member-profile-parking-lot.md` + remover slice o marcar `@deprecated`
- [ ] Decisión slice `src/features/style-assist/` + dep `ai` (330 LOC dormido por ADR-0020):
  - Opción A: V1.3 reactiva (registrar timeline)
  - Opción B: drop slice + dep `ai` del package.json
- [ ] Update docs según decisión

**Acceptance**: 2 ADRs nuevas (parking-lot o reactivate) · package.json refleja decisión.

**Commit**: _pending_

---

### Sesión 3.B — DB polish [~1h]

- [ ] Migration 0027: `FORCE ROW LEVEL SECURITY` en core tables (`app_user`, `place`, `place_domain`, `membership`, `place_ownership`, `invitation`) — defense-in-depth contra futuras migrations corriendo como table owner
- [ ] `SET search_path` explícito en `app.current_user_id()` (migration 0000) — canonicidad anti-hijack
- [ ] `VOLATILE` explícito en DEFINERs viejos (migrations 0002, 0003, 0007, 0013) — consistencia con 0014+ que sí lo declaran

**Acceptance**: tests RLS pasan post-FORCE · `\df+` Postgres muestra search_path + volatility correctos.

**Commit**: _pending_

---

### Sesión 3.C — UI polish [~30min]

- [ ] ESC handler en `src/features/invitations/ui/invite-member-modal.tsx` copiando patrón de `src/shared/ui/confirm-dialog.tsx:44-51` (useEffect + keydown listener)
- [ ] Tokenizar `bg-black/40` como `--scrim` en `src/app/globals.css` + reemplazar 3 usos (`confirm-dialog.tsx:70`, `invite-member-modal.tsx:175`, `domain-section-archive.tsx:137`)

**Acceptance**: ESC cierra invite-member-modal · grep `bg-black/40` en src retorna 0.

**Commit**: _pending_

---

### Sesión 3.D — Seed script [~2h]

- [ ] Crear `scripts/db-seed.mjs` (o similar): 1 owner user (Neon Auth + app_user) + 1 place + 3 miembros + 2 invitations pending
- [ ] Script `pnpm db:seed` en package.json (NO en build, solo on-demand local)
- [ ] Documentar uso en `README.md` §Setup + warning "solo dev branch, NUNCA prod"

**Acceptance**: `pnpm db:seed` en branch dev Neon produce data observable en `/settings/members` + invite URLs accionables.

**Commit**: _pending_

---

### Sesión 3.E — CI extras + index polish [~1h]

- [ ] Agregar `check-translations.mjs` a CI (warning visible, no fail-fast por canon ADR-0024)
- [ ] Normalizar JSDoc seam-split en `src/features/custom-domain-verification/actions/get-custom-domain-status.ts` (frase canónica para consistencia)
- [ ] Migration 0028: `CREATE INDEX idx_place_founder_user_id ON place(founder_user_id)` — lookups en `revoke_ownership` + `transfer_founder_ownership` + queries futuras "qué places fundó X"

**Acceptance**: CI muestra check-translations result · JSDoc consistente · query planner usa index nuevo.

**Commit**: _pending_

---

### Sesión 3.F — LOC cap splits (lazy, cuando se toquen) [~ad-hoc]

NO ejecutar como batch. Cuando se toquen estos archivos para alguna razón, hacer el split como parte del cambio:

- [ ] `src/app/(app)/place/[placeSlug]/settings/members/_components/member-row-actions-menu.tsx` (309 LOC, +3% sobre cap)
- [ ] `src/db/schema/index.ts` (302 LOC, split por dominio: place/invitation/membership)
- [ ] `src/app/api/auth/sso-redeem/route.ts` (301 LOC, +0.3% — extraer 1-2 helpers a `shared/lib/sso/`)

**Acceptance**: cuando se cierre cada uno, archivo queda ≤300 LOC.

**Commit**: _per-touch_, NO sesión dedicada

---

### 🏁 Cierre Phase 3

**Tag post-phase**: `baseline/phase-3-tech-debt-done`

**Acceptance phase**: 2 scope decisions cerradas (member-profile + style-assist) · DB hardened (FORCE RLS + search_path) · ESC handler + scrim tokenizado · seed script funcional · CI con check-translations · founder index.

---

## Phase 4 — Backlog V1.3 mid o V1.4 (no sesiones predefinidas)

Items que NO son cleanup tech debt sino features/optimizaciones para más adelante. Registrados acá para visibilidad pero NO bloquean cierre tech debt.

| Item | Origen | Cuándo |
|------|--------|--------|
| **Bug D — SSO chain warm-up** (cold ~2.7s vs warm ~830ms): warm-up cron / edge runtime `sso-init` / batching hops | ADR-0046 §D.fix.4 | V1.3 si crítico, V1.4 si UX tolerable |
| **ε — logo del place en branding apex** (necesita Storage resuelto Phase 1.G) | ADR-0046 §"Alternativas rechazadas" | V1.3 |
| **θ — theme color en branding apex** (necesita `theme_config` shape canonizado) | ADR-0046 | V1.3 |
| **Auditoría DEFINERs post-signup**: futuras Server Actions sin PlaceWizard | spec.md invitations §Followups V1.2 bullet 3 | V1.3 mid |
| **Conversaciones / Eventos / Library**: implementación de las 3 ontologías canónicas | docs/ontologia/* + Phase 2.D stubs | V1.3+ |
| **Storybook/Ladle** para componentes `shared/ui/` | DX nice-to-have | V1.4+ |

---

## Save points + tags reference

| Tag | Commit | Descripción |
|-----|--------|-------------|
| `baseline/feature-e-invite-v1.2-done` | `3be5eec` | V1.2 invite flow cerrado |
| `baseline/pre-phase-0-tech-debt` | `3be5eec` | Save point pre-Phase 0 (= V1.2 done) |
| `baseline/phase-0-D-edge-config-done` | _commit `414d53a`_ | Edge config load-bearing (Phase 0.D) |
| `baseline/phase-0-E-observability-done` | _pending commit_ | Observability load-bearing (Phase 0.E) |
| `baseline/phase-0-tech-debt-done` | _= phase-0-E-done_ | Cierre Phase 0 |
| `baseline/pre-phase-1-tech-debt` | _= phase-0-done_ | Save point pre-Phase 1 |
| `baseline/phase-1-G-storage-decided` | _pending_ | Storage decision load-bearing |
| `baseline/phase-1-tech-debt-done` | _pending_ | Cierre Phase 1 |
| `baseline/pre-phase-2-tech-debt` | _= phase-1-done_ | Save point pre-Phase 2 |
| `baseline/phase-0-D-edge-config-done` | _pending_ | Headers + rate limit (Upstash) load-bearing |
| `baseline/phase-2-B-e2e-done` | _pending_ | E2E suite load-bearing |
| `baseline/phase-2-H-suspense-done` | _pending_ | Suspense streaming load-bearing |
| `baseline/phase-2-I-csp-strict-done` | _pending_ | CSP strict (nonce-based) load-bearing |
| `baseline/phase-2-tech-debt-done` | _pending_ | Cierre Phase 2 |
| `baseline/pre-phase-3-tech-debt` | _= phase-2-done_ | Save point pre-Phase 3 |
| `baseline/phase-3-tech-debt-done` | _pending_ | Cierre Phase 3 + tech debt closure |

---

## Pointers

- **Audit origin**: 2 rondas de agents read-only (5+5) post-V1.2 cierre 2026-05-28. Resumen en conversación de origen.
- **Reglas canónicas**: ver §"Reglas operativas" arriba.
- **Decisiones scope durante ejecución**: documentar inline en el item correspondiente + crear ADR si load-bearing.
- **Save point rollback protocolo**: si una phase se descarta a mitad, `git reset --hard baseline/pre-phase-<N>-tech-debt` + remove de tags intra-phase + restart phase.
