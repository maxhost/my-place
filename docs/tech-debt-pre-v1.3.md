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
| **1 — Hardening** | 7 | 7/7 ✅ | `baseline/pre-phase-1-tech-debt` = `f577908` ✅ | `baseline/phase-1-tech-debt-done` = `3fa0cc3` ✅ |
| **2 — Tests + docs** | 9 | 6/9 (2.A, 2.G, 2.E, 2.F, 2.D, 2.B ✅) | `baseline/pre-phase-2-tech-debt` = `3fa0cc3` | _pending_ |
| **3 — Polish** | 6 | 0/6 | _pending_ | _pending_ |
| **4 — Backlog V1.3 mid** | — | — | n/a (no sesiones predefinidas) | n/a |

**Progreso total**: 15/27 sesiones · ~50h dev estimadas si serial · esfuerzo Phase 0+1 (mínimo viable pre-V1.3) = ~3.5 días dev.

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

**Smoke VERIFICADO en prod (2026-05-30)** ✅: `curl -I https://nocodecompany.co` retorna los 5 security headers (HSTS + X-Frame-Options DENY + Referrer-Policy + Permissions-Policy + X-Content-Type-Options). 12 GETs a `/api/auth/sso-init` → requests 1-10 `302`, requests 11-12 `429` con `Retry-After: 2s` → **rate limit Upstash operativo end-to-end + creds presentes en Vercel** (sin creds sería fail-loud 500, no 302). Threshold 10/min/IP exacto. NO testeable en `pnpm dev` sin Upstash creds locales (skip + warn path).

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

**Smoke PARCIALMENTE verificado en prod (2026-05-30)** ✅⚠️: el HTML de `https://nocodecompany.co` inyecta meta tags `sentry-trace` + `sentry-release` + `sentry-org` + `sentry-public` + `sentry-environment` → **SDK server-side inicializado con DSN + build plugin corrió (release inyectado) + integración Vercel×Sentry completada** (las 5 env vars presentes en build). PENDIENTE confirmar el último hop (error real → ingest → issue en dashboard sentry.io): requiere acceso al dashboard del owner. Opción documentada: route temporal `/api/_sentry-smoke` con `throw` → deploy → golpear → verificar issue <30s → remover el throw.

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

### Sesión 1.E — Performance: React.cache wrap [~30min] ✅

- [x] Wrap `src/shared/lib/custom-domain-lookup.ts` `lookupPlaceByDomain` con `cache()` (callsites: proxy middleware + RSC tree `get-place-for-zone` + `db-for-request` + 3 route handlers SSO)
- [x] Wrap `src/shared/lib/place-locale-lookup.ts` `lookupPlaceLocaleBySlug` con `cache()` (callsite RSC: `getPlaceLocaleFallback` desde layout `(app)/place/[placeSlug]/`)
- [x] JSDoc actualizado en ambos archivos con sección "MEMOIZACIÓN PER-REQUEST" explicando: scope del memo (mismo render RSC, mismo arg normalizado), comportamiento pass-through fuera de contexto RSC (middleware/route handlers/Vitest), por qué es safe en cualquier callsite server-only.

**Decisiones**:
- **Convert `export async function` → `export const = cache(async ...)`**: signature pública idéntica para callers; TS infiere el return type sin cambios. Tests vitest (`vi.mock` con `vi.fn()`) siguen interceptando el export por igual — verificado 46/46 tests de consumers verdes.
- **Memoización key = todos los args normalizados ANTES de la query**: las funciones normalizan internamente (`host.split(":")[0].trim().toLowerCase()`, `rawSlug.trim().toLowerCase()`). `cache()` de React usa identidad referencial sobre los args originales — `lookupPlaceByDomain("Foo.COM")` y `lookupPlaceByDomain("foo.com")` son cache miss separados, pero ambos resuelven la misma query DB. Aceptable: el cost dominante es la query (no la normalización TS); en práctica un render usa el mismo host string en todas sus llamadas.
- **No tocar middleware/route handlers**: `cache()` actúa como pass-through fuera de RSC (sin warning, sin crash). Esos callsites NO ganan memo pero ya invocan 1x por request — no es regresión.
- **No agregar tests de memoización per-render**: testear el behavior memo requiere setup RSC complejo (renderToStaticMarkup + cache scope) que excede el ROI de una optimización transparente. Los tests existentes cubren contract de la función (input → output, normalización, fail-safe); el wrap `cache()` no afecta esos contratos.

**Acceptance**: ✅ typecheck verde · ✅ suite verde (1159/1159) · ✅ grep `from "react"` muestra `cache` import en ambos archivos · ✅ tests consumers (proxy + get-place-for-zone + 3 SSO routes) 46/46 sin regresión.

**Commit**: `173f72e perf(lookups): Phase 1.E — React cache() wrap en lookups anonymous (memo per-render RSC)`

---

### Sesión 1.F — Docs cleanup quick [~1.5h] ✅

- [x] 3 gotchas con pointers drift → reemplazar `file:line` por `file:symbol` (robusto al drift):
  - `docs/gotchas/rls-place-domain-owner-only.md` (3 refs: policy SQL + helper Drizzle + tabla placeDomain)
  - `docs/gotchas/accept-invitation-requires-ensure-app-user-tx1.md` (5 refs: signUpAccountAction, sessionIdentity, TX1+TX2 split bloque, JSDoc header, RAISE P0002 en migration 0003)
  - `docs/gotchas/apex-login-returnto-honored.md` (4 refs: redirectToApexLogin, type Props, guard "ya logueado", onSuccess callback) + nota explícita en top "**Fix shippeado** (S11.3, ADR-0033), este gotcha se preserva como referencia diagnóstica"
- [x] **Scope creep necesario**: 2 refs colaterales fuera de los 3 gotchas listados pero adentro del grep acceptance:
  - `docs/gotchas/README.md` línea 17 (índice — entrada de accept-invitation mencionaba `create-place.ts:71-77`)
  - `docs/gotchas/zone-aware-db-cookie-source.md` línea 119 (mencionaba `update-default-locale.ts:13` como canon seam-split)
- [x] **Excepción documentada**: `docs/gotchas/next-intl-icu-template-raw.md` línea 12 mantiene `crear/page.tsx:48:15` por ser **stack trace literal del runtime Next/next-intl** (evidencia reproducible, no pointer drift). Nota agregada in-file para que un PR futuro no lo "limpie" por error.
- [x] `docs/features/README.md`:
  - Línea 59 → i18n marcado `Core` (6 locales operativos: es/en/fr/pt/de/ca; enforced por CHECK constraint + enum Zod; ref ADR-0024)
  - "Acceso a datos" movido de sección Roadmap/parked a Plataforma con `Drizzle ORM + Neon serverless driver; RLS por-operación con rol app_system NO BYPASSRLS` + ref ADR-0004
- [x] `docs/features/onboarding/README.md`:
  - Eliminado bloque ⚠️ "Pendiente de re-sync con ADR-0008+0010" (ya carecía de sentido — el slice nunca se re-syncó porque fue dividido)
  - Agregado bloque DEPRECATED al top: explicita división post-ADR-0014 en 3 slices (`place-wizard/` por ADR-0016 + `place-creation/` + `access/`); aclara que §5 RLS y §6 invitación token-link sí están sincronizados al modelo final pero §2 flujo y §3 saga monolítica NUNCA se implementaron; congelado como referencia histórica del modelo S1 original

**Decisiones**:
- **No renombrar `README.md` → `spec.md`**: elegida opción (b) del tracker (eliminar ⚠️ + deprecation note). Razones: (1) renombrar rompe links externos sin ganancia funcional (la carpeta ya está deprecated); (2) la convención de la carpeta es que el README ES la spec índice — el slice deprecated lo conserva igual; (3) la nota de deprecation al top es self-explanatory y más loud que un nombre de archivo distinto.
- **Reemplazo simbólico estilo `file § symbol/block`**: usado consistentemente. Patrón: `archivo.ts § función X` para functions/types nombrados · `archivo.ts § bloque "TX 1 — ensureAppUser"` para bloques referenciados por comentario · `archivo.ts § JSDoc header "X"` para referencias a prosa del header. Drift-robust: un line shift no rompe la referencia; un rename del símbolo SÍ exige update (pero el grep encuentra al símbolo en lugar del line número).
- **Stack trace literal preservado**: el `:48:15` del next-intl gotcha es runtime evidence, no codebase pointer. Excepción explícita in-file + en este tracker.

**Acceptance**: ✅ `grep -rEn "\.(ts|tsx|sql):[0-9]+(-[0-9]+)?" docs/gotchas/` retorna 1 línea (el stack trace documentado como excepción) · ✅ features/README marca i18n Core + Acceso a datos Plataforma (Drizzle ADR-0004) · ✅ onboarding/README abre con bloque DEPRECATED explícito (3 slices sucesores enumerados).

**Commit**: `8cf9341 docs: Phase 1.F — gotchas refs file:symbol + features/README + onboarding deprecation`

---

### Sesión 1.G — Storage TBD: decisión + provisioning [~2h] ✅

**Decisiones de la sesión (post-análisis user 2026-05-30)**:
- **Provider: Cloudflare R2** (NO Vercel Blob — el tracker original lo recomendaba "por integración nativa"). El re-análisis cost-first con lente unit-economics del owner ("cobro per GB extra a partir de 2GB free per community") confirmó que R2 es decisión estratégica del modelo de negocio, no preferencia operativa. Drivers: egress zero (~$600/mo savings V1.5, ~$7.5K/mo V2), storage 35% menor ($0.015 vs $0.023 GB-month), free tier 10× (10GB vs 1GB), S3-compatible API → lock-in bajo.
- **2 buckets desde día 1** (NO 1 bucket con prefix): `place-media-public` (logos+avatares, CDN cached) + `place-media-private` (library+event photos, presigned URLs). Lifecycle/CORS/audit policies separables sin migración retroactiva. +20 LOC complexity wrapper (discriminated `BlobBucket` type) justificadas.
- **Custom domain `media.place.community`** (NO URL R2 default `pub-{hash}.r2.dev`): URLs limpias + CDN Cloudflare nativo + migrable a otro CDN futuro sin DB migration. Setup ~15min (CNAME + R2 verify).
- **SDK `@aws-sdk/client-s3` v3** (NO `aws4fetch` ~5KB): battle-tested + tree-shake ~30KB server bundle + portable a AWS S3/Backblaze B2/MinIO drop-in. Ahorro 25KB no justifica risk de edge cases en producción.
- **Fail-loud-prod sin creds** (mismo patrón rate-limit Phase 0.D, distinto de Sentry no-op-prod): storage SÍ es operacionalmente crítico — upload silencioso sin éxito = user pierde su contribución.

**Items cerrados**:
- [x] **ADR-0048** (`docs/decisions/0048-storage-cloudflare-r2.md`) — rationale + 9 alternativas rechazadas (α Vercel Blob, β AWS S3, γ Backblaze B2, δ self-hosted MinIO, ε DIY-on-Postgres-bytea, ζ posponer, η 1 bucket único, θ URL R2 default, ι aws4fetch SDK) + consecuencias positivas/negativas/operacionales + implementación V1 + pointers. Indexada en `docs/decisions/README.md` (line nueva post ADR-0047 — orden cronológico-numérico).
- [x] Deps instaladas: `@aws-sdk/client-s3@^3.1057.0` + `@aws-sdk/s3-request-presigner@^3.1057.0` agregadas a `dependencies` en `package.json`. Lockfile regenerado con `pnpm add`.
- [x] **Wrapper** `src/shared/lib/storage/blob.ts` (~165 LOC) + `types.ts` (~50 LOC):
  - API minimal 3 funciones: `uploadBlob({bucket, key, body, contentType})` + `getBlobUrl({bucket, key, ttlSeconds?})` + `deleteBlob({bucket, key})`
  - Singleton lazy `S3Client` con `region:"auto"` + `endpoint: https://{accountId}.r2.cloudflarestorage.com` + `forcePathStyle:true` (compat MinIO/B2)
  - `ensureConfig` lazy con cache + tri-state (`StorageConfig | "skipped" | null`)
  - Fail-loud-prod sin creds (throws con mensaje listando vars missing); dev sin creds = log.warn 1× + throws con mensaje claro al intentar storage op
  - `_resetConfigCacheForTests` exportado (test isolation)
- [x] **15 tests unit** en `src/shared/lib/storage/__tests__/blob.test.ts` con mocks de `@aws-sdk/client-s3` (S3Client + 3 Commands) + `@aws-sdk/s3-request-presigner` (getSignedUrl). Cobertura completa:
  - Skip dev sin creds (warn loggeado, NO S3Client construction)
  - Singleton del warn (1× aunque múltiples calls)
  - 3 funcs throws con su nombre en el msg cuando dev sin creds
  - Fail-loud prod sin creds (lista todas las missing vars + lista UNA cuando solo falta una)
  - uploadBlob public/private con PutObjectCommand correcto + publicUrl solo cuando public
  - Normalización trailing slash en publicBaseUrl
  - S3Client singleton (1 construction across calls + multi-bucket)
  - getBlobUrl public (URL directa SIN presigner) + private (presigned con TTL default 3600s y custom propagado)
  - deleteBlob ambos buckets + bubble error del SDK (no swallow)
- [x] `.env.example` — bloque nuevo "Cloudflare R2 (storage — Phase 1.G, ADR-0048)" con 6 env vars + setup step-by-step de ~30min (CF account + R2 enable + 2 buckets + API token + CNAME + 6 vars Vercel) + behavior por entorno + free tier specs + key naming convention recomendada
- [x] `docs/stack.md`:
  - Header line 5 §Estado: `Storage TBD` → `Storage = Cloudflare R2 (ADR-0048)`
  - Tabla §Piezas: fila Storage de "TBD" a "Cloudflare R2 (S3-compatible, ADR-0048) + 2 buckets + custom domain + wrapper canónico"
  - §Variables de entorno: bloque nuevo "Cloudflare R2 (storage, Phase 1.G, ADR-0048)" con 6 vars + behavior fail-loud-prod + free tier + setup pointer
  - Cierre §Variables actualizado: "Realtime/pagos siguen TBD; Storage RESUELTO Phase 1.G"
- [x] `docs/features/README.md`:
  - Fila "Place branding" (Plataforma): "Plataforma (depende de Storage TBD)" → "Plataforma (logo desbloqueado V1.3 post-ADR-0048; tema ya activo)"
  - Fila nueva en Plataforma: "Storage (blob assets)" — Cloudflare R2 + 2 buckets + wrapper + habilita V1.3+ logos/avatares/library/event photos
  - Fila "Storage" en Roadmap/parked: ELIMINADA (movida a Plataforma)

**Acceptance** (verificado 2026-05-30):
- ✅ `pnpm typecheck` verde
- ✅ `pnpm exec vitest run --project node src/shared/lib/storage/` → 15/15 verde (storage tests)
- ✅ ADR-0048 creada + indexada en `docs/decisions/README.md`
- ✅ env vars declaradas + provisioning step-by-step doc en `.env.example`
- ✅ Wrapper TS minimal con tests unit
- ✅ Sin consumers en código (solo platform-ready; V1.3 §ε logo place + futuras consume on-demand)
- ✅ stack.md + features/README sincronizados (TBD → RESUELTO)

**Notas operativas pendientes para user** (post-merge):
1. Sign up cloudflare.com (~5min, free)
2. Activar R2 en Dashboard CF (requiere payment method on file — NO se cobra en free tier)
3. Crear 2 buckets: `place-media-public` + `place-media-private`
4. Crear API token scope `Object Read & Write` aplicado a esos 2 buckets
5. Configurar custom domain `media.place.community` en R2 → public bucket → Custom Domains (agregar CNAME en DNS provider)
6. Setear 6 env vars en Vercel (Production + Preview scopes): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL`
7. Sin esas vars en prod, primer call de upload/get/delete crashea fail-loud (deploy permite arrancar pero la feature dependiente no opera — distinto patrón que rate-limit que crashea al startup; el storage solo se ejerce cuando un consumer V1.3+ lo invoca)

**Smoke deferido a V1.3** (cuando se monte primer consumer, e.g. logo place): Server Action test que uploadea → genera publicUrl → fetch ese URL desde browser → verificar Content-Type + status 200 + cache headers. Verificable solo post-provisioning.

**Commit**: `9e6f28e feat(storage): Phase 1.G — Cloudflare R2 + wrapper blob.ts + 2 buckets (ADR-0048)` · **Tag**: `baseline/phase-1-G-storage-decided` (load-bearing)

---

### 🏁 Cierre Phase 1

**Tag post-phase**: `baseline/phase-1-tech-debt-done`

**Acceptance phase**: FK indexes activos · auth actions validan input · 1 patrón pre-ADR-0034 eliminado · factories tests proof-of-pattern · pre-commit hooks activos · 2 lookups memoizados · gotchas + features docs limpios · Storage decidido + provisionado.

---

## Phase 2 — Tests + docs completeness (9 sesiones, ~14-16h)

**Save point**: `baseline/pre-phase-2-tech-debt` = `118ab5a` ✅ (pre-2.A)

V1.3 puede arrancar **en paralelo** con esta phase si recursos lo permiten. No bloqueante pero recomendable cerrar antes de scope creep.

### Orden de ejecución acordado (2026-05-31)

Criterio: menos→más esfuerzo + sentido funcional. **2.A cerrada** (`e538543`) · **2.G cerrada** (`aace521`) · **2.E cerrada** (`c5602b2`) · **2.F cerrada** (`4c20adf`) · **2.D cerrada** (`79c96a7` + `77a5b05`, 2 subsesiones) · **2.B cerrada** (`1b9df3f` + `780b9be`, 2 subsesiones). Próxima = **2.C**. Las restantes en este orden:

1. **2.G** — i18n strings → translations (~1h) ✅
2. **2.E** — doc polish + cookie audit (~1.5h) ✅
3. **2.F** — backup/PITR + drifts deps (~1.5h) ✅
4. **2.D** — data-model gaps + stubs ontologías (~2h) ✅
5. **2.B ✅** — 2 E2E críticos · reusa harness E2E de 2.A · dividida en 2 subsesiones: **2.B.1 register custom domain ✅** (`1b9df3f`) · **2.B.2 accept invite cross-domain ✅** (`780b9be`)
6. **2.C** — coverage thresholds + investigar flake `pnpm test` (~3h)
7. **2.H** — Suspense boundaries settings + streaming (~2-3h) · load-bearing
8. **2.I** — Strict CSP nonce-based (~2-4h) · load-bearing · última (más compleja)

**Protocolo por sesión** (canon §"Reglas operativas"): commit dedicado al cierre (stagear por path explícito) + registrar el hash en el item · `/clear` o `/compact` entre sesiones para ventana limpia · al cerrar la phase, tag `baseline/phase-2-tech-debt-done`.

### Sesión 2.A — Playwright setup + 1er E2E [~3h] ✅

**Decisiones de la sesión (2026-05-31)**:
- **App LOCAL contra branch `test`, NO apex prod** (el plan original decía "baseURL apex prod"): correr E2E que hacen signup + create contra prod sembraría data real y dependería del deploy. Se corre `next dev` apuntado al branch `test` de Neon (mismo branch que la suite Vitest), con apex local `lvh.me` (resuelve a 127.0.0.1 incl. subdominios; dotted → pasa el regex `APEX_DOMAIN`). Doc canónico nuevo `docs/testing.md`.
- **`workers: 1` + serial (NO "parallel 4")**: el branch `test` cold-startea varios segundos (WebSocket neon-serverless); paralelo genera contención de pool + flakiness. Serial con timeouts generosos (60s test / 15s expect) + `retries: 2` absorbe el cold-start.
- **HTTPS obligatorio (hallazgo bloqueante)**: el spike fallaba el signup con `403 "Invalid origin"`. Diagnóstico: el SDK Neon Auth reenvía el header `Origin` al backend gestionado, que valida contra `trusted_origins`. Better Auth **rechaza `http://` no-localhost** (sólo `https://` o `http://localhost`). Como el apex es `lvh.me`, el dev server DEBE correr sobre HTTPS. Solución: cert self-signed para `lvh.me` con openssl (sin mkcert/sudo) vía `scripts/ensure-e2e-cert.mjs` (corrido por `pnpm e2e`) + `next dev --experimental-https --…-key/-cert` + `ignoreHTTPSErrors`. Más fiel a prod (que es HTTPS).
- **Cleanup por barrido global (pattern-based), NO fixture per-test**: `globalTeardown` (+ `globalSetup` pre-clean defensivo) borra TODA cuenta `e2e-%@example.com` en orden FK-safe con el rol admin (`neondb_owner`). Robusto a crashes (barre huérfanos de runs previos); más simple que rastrear IDs por test.
- **`e2e.yml` = `workflow_dispatch` (manual)**, no `on: pull_request` (el plan lo marcaba "opcional, no en cada PR"): el E2E levanta la app + cold-startea Neon → caro para cada PR; los gates baratos (typecheck/lint/vitest) ya protegen.

**Items cerrados**:
- [x] `@playwright/test@^1.60.0` en devDeps + scripts `e2e` / `e2e:ui` (corren `ensure-e2e-cert.mjs` antes de `playwright test`)
- [x] `playwright.config.ts`: 2 projects (chromium + webkit), HTTPS sobre `lvh.me`, carga `.env.e2e` con dotenv (runner + `webServer.env`), `globalSetup`/`globalTeardown`, retries 2, workers 1
- [x] `next.config.ts` `allowedDevOrigins: ["lvh.me", "*.lvh.me"]` (HMR/dev assets sobre lvh.me)
- [x] E2E #1 `tests/e2e/signup-happy-path.spec.ts`: place-first `/es/crear` → wizard 3 pasos → signUp + `app.create_place` → success screen "Tu lugar está listo". **2 passed (chromium + webkit)** verificado local contra branch test
- [x] Cleanup: `tests/e2e/_support/db-cleanup.ts` (`cleanupE2EData` + `E2E_EMAIL_PATTERN`) + `global-setup.ts` (pre-clean) + `global-teardown.ts` (barrido post-run). Verificado: teardown borró 2 users + 2 places
- [x] `scripts/ensure-e2e-cert.mjs` (cert self-signed idempotente, openssl) + `certificates/` gitignored
- [x] `.env.e2e.example` (template, HTTPS) + `.github/workflows/e2e.yml` (manual, sube reporte HTML si falla)
- [x] `docs/testing.md` — doc canónico nuevo (capas de testing + rationale E2E completo: lvh.me, HTTPS, cleanup, CI)
- [x] **Config externa aplicada**: `trusted_origins += https://lvh.me:3000` en el Neon Auth del branch `test` (MCP `configure_neon_auth`, sólo branch test)
- [x] Limpieza: revertido el `console.error` DIAG temporal de `auth-actions.ts` (violaba canon Phase 0.E — cero `console.*` en `src/`)

**Acceptance**: ✅ `pnpm e2e` verde local (2 passed) · ✅ cleanup post-run verificado (teardown borró users+places) · ✅ typecheck verde · ✅ `e2e.yml` con upload de reporte HTML on-failure. CI verde queda pendiente de los GitHub Secrets del branch test (nota operativa abajo).

**Notas operativas pendientes para user** (para CI):
1. Agregar GitHub Secrets del branch test: `DATABASE_URL_TEST`, `DATABASE_URL_TEST_MIGRATE` (ya requeridos por `tests.yml`), `E2E_NEON_AUTH_BASE_URL`, `E2E_NEON_AUTH_JWKS_URL`, `NEON_AUTH_COOKIE_SECRET` (instrucciones en header de `e2e.yml`).
2. El `trusted_origins` del branch test ya tiene `https://lvh.me:3000` (aplicado esta sesión). Si se recrea el branch test, re-aplicar.

**Commit**: `e538543 test(e2e): Phase 2.A — Playwright setup + 1er E2E signup happy path (HTTPS lvh.me + cleanup)`

---

### Sesión 2.B — 2 E2E críticos restantes [~3h]

**Dividida en 2 subsesiones (commit dedicado + compact entre ambas, 2026-06-01)**: 2.B.1 = register custom domain (autocontenido en zona `lvh.me`, reusa harness 2.A + stub Vercel) · 2.B.2 = accept invite cross-domain (el más frágil: 2º loopback + cert + TLS + cadena SSO). **Orden reordenado vs el listado original** por criterio Phase 2 (menos→más esfuerzo): register primero. Plan completo en `~/.claude/plans/sprightly-popping-peach.md`.

#### Sesión 2.B.1 — E2E register custom domain [~1.5h] ✅

**Decisiones de la sesión (2026-06-01)**:
- **Mock Vercel = override de base URL por env** (`VERCEL_API_BASE_URL`, default `https://api.vercel.com`): seam DI de 1 línea en `domains-shared.ts`. Los Server Actions llaman a Vercel desde el server Node → Playwright (browser) no puede interceptar; el wrapper apunta a un stub HTTP local. NO es lógica de test en el wrapper — el fetch es idéntico, sólo cambia el host destino. Producción nunca setea la var. Confirmado por user (pre-plan).
- **Stub stateful que modela propagación DNS** (no respuestas estáticas): un dominio arranca sin propagar (V6 `misconfigured:true` + V9 `verified:false` → pending con tabla DNS); el test dispara `POST /__advance` (modela "el owner configuró el DNS") → V6 ok + V9 verified → en el reload el lazy poll (`verified && !misconfigured`, ADR-0029) hace `UPDATE verified_at` → verified. Esto evita depender de cuántos renders server hace Next (el `revalidatePath` del register re-renderiza y corre el lazy poll — con stub estático verificaba al instante, saltando pending).
- **Bootstrap del owner vía wizard de signup** (no seed de usuario): `_support/bootstrap.ts` `signUpOwner` corre el wizard completo → place + usuario Neon Auth + sesión en un flujo. Evita seedear un usuario login-able en el backend gestionado de Neon Auth (las factories deliberadamente no lo crean, decisión 1.C). `signup-happy-path.spec.ts` refactorizado para reusar el helper (DRY).
- **Selector `getByRole("textbox")` no `getByLabel("Dominio")`**: el sidebar tiene un link "Dominio" → un selector por label es ambiguo cuando el form no está montado (matchea el link, no el input). El rol textbox sólo matchea el input + espera a que se monte (clave para esperar el archive → none).

**Items cerrados**:
- [x] Seam env `VERCEL_API_BASE` ← `process.env.VERCEL_API_BASE_URL ?? "https://api.vercel.com"` en `src/shared/lib/vercel/domains-shared.ts` (única línea de producción tocada; doc inline + `.env.example`/`stack.md`/`testing.md`). Wrapper vitest 33/33 verde (el default real se mantiene).
- [x] Stub HTTP `scripts/e2e-vercel-stub.mjs` (node `http`, puerto 3010): responde POST v10 (verified:false + verification[]), GET v6 config (misconfigured = !propagado), GET v9 status (verified = propagado), DELETE v9, `POST /__advance` (control E2E), health.
- [x] `playwright.config.ts`: `webServer` array (stub + dev server); inyecta `VERCEL_API_BASE_URL`/`TOKEN`/`PROJECT_ID` mock al env del dev server (overridables por `.env.e2e`).
- [x] E2E `tests/e2e/register-custom-domain.spec.ts`: none → vincular → pending (tabla DNS) → `/__advance` + reload → verified → remover → none. **chromium + webkit verdes** (estable, sin flaky tras bump del timeout de bootstrap a 45s).
- [x] `_support/bootstrap.ts` `signUpOwner` (helper compartido) + `signup-happy-path.spec.ts` refactorizado para usarlo.
- [x] Docs: `docs/testing.md` (§"Mock de Vercel en E2E" + §"Bootstrap compartido" + estructura de archivos), `docs/stack.md` (env `VERCEL_API_BASE_URL`), `.env.e2e.example` (vars opcionales con default al stub).

**Acceptance** (verificado 2026-06-01): ✅ typecheck verde · ✅ `pnpm e2e register-custom-domain` 2/2 verde (chromium+webkit, 33s) · ✅ suite e2e completa 4/4 verde (signup×2 + register×2) · ✅ cleanup post-run barre place+place_domain · ✅ vitest custom-domain 69/69 + vercel 33/33 (sin regresión por el seam) · ✅ `FORMATTING_ERROR` en logs = warnings pre-existentes de next-intl ({slug}/{domain} resueltos client-side, no regresión).

**Commit**: `1b9df3f test(e2e): Phase 2.B.1 — E2E register custom domain + stub Vercel (seam DI)` · **Tag**: _no aplica (no load-bearing; el tag de phase espera a 2.B.2)_

#### Sesión 2.B.2 — E2E accept invite cross-domain [~2.5h] ✅

**Camino activo (decisión de la sesión, 2026-06-01): FALLBACK documentado del plan, no la cadena live.** Diagnóstico: la cadena SSO live (init→issue→redeem) es **intratable** en el harness local `:3000` — las rutas SSO (`buildSsoInitUrlForInvite`, `sso-issue:buildRedeemUrl`, `sso-redeem:buildLandingUrl`) reconstruyen el host del custom domain **sin puerto** (`https://<host>/...` → `:443`), correcto para prod pero roto en `:3000`. Arreglarlo exigiría tocar código de producción de routing (fuera de scope) o correr en `:443` (privilegiado, inviable en CI), y el flaky-risk del redirect chain violaría el acceptance "0 flaky". Se sustituyen **sólo los 3 hops del redirect** — ya cubiertos por sus `route.test.ts` (sso-init/issue/redeem) — minteando la cookie `__Host-place_sso_session` que el redeem habría emitido (`mintLocalSession`, misma signing key) e inyectándola. Todo lo demás corre REAL. Bonus: el fallback NO ejecuta el self-fetch JWKS → `NODE_TLS_REJECT_UNAUTHORIZED=0` resultó innecesario.

**Items cerrados**:
- [x] Custom domain = `127.0.0.1.nip.io` (NO `localtest.me`: trae AAAA → happy-eyeballs flakea contra `::1`; nip.io es A-record IPv4-only, empareja el stack de `lvh.me`). Cert SAN extendido + regeneración si un cert viejo no lo cubre (`scripts/ensure-e2e-cert.mjs`).
- [x] `_support/db-seed.ts` (admin conn): `place_domain` verified (INSERT idempotente — barre fila activa del dominio constante antes de insertar, índice único es por-dominio global) + invitación vía `app.create_invitation` con claim `request.jwt.claims` spoofeado tx-local al owner (`set_config`). + `lookupAuthUserIdByEmail` + `mintLocalSessionCookie` + `membershipExists`.
- [x] ~~TLS self-fetch JWKS~~ **no aplica** (el fallback no ejecuta el redeem → sin self-fetch).
- [x] `next.config.ts`: `allowedDevOrigins` suma `127.0.0.1.nip.io` (dev-only) — **root cause de la flakiness inicial**: sin él, la hidratación del `InviteAcceptancePanel` no completa sobre ese host → el botón Aceptar nunca se vuelve interactivo (click no-op por race de hidratación).
- [x] E2E `tests/e2e/accept-invite-cross-domain.spec.ts` (chromium+webkit): (1) anon en custom domain → unauth · (2) signup real del invitee en apex · (3) mint+inject sesión local · (4) custom domain con sesión → variante **match** (render autenticado cross-domain) · (5) Aceptar → `membership` creada (verdad en DB) · (6) re-visita → 404 (token consumido). Pasos del custom domain en páginas nuevas (la nav post-success portless cuelga la página). Aserciones por selectores estables (los labels con placeholder rinden la key cruda por FORMATTING_ERROR pre-existente).
- [x] Docs: `docs/testing.md` (§"E2E accept invite cross-domain" + fallback rationale + estructura) · `.env.e2e.example` (PLACE_SSO_SIGNING_KEY throwaway requerida + E2E_CUSTOM_DOMAIN).

**Observación (no bloqueante, candidata a bug separado)**: el invite page rinde la **key i18n cruda** (`placeInvitation.header`, etc.) para labels con placeholder `{placeName}`/`{email}` porque la page los pasa por `t()` (no `t.raw()`) y los interpola client-side → next-intl tira FORMATTING_ERROR y devuelve la key. Pre-existente (notado en 2.B.1). Triage aparte si se decide arreglar (usar `t.raw()` en `invite/[token]/page.tsx`).

**Acceptance** (verificado 2026-06-01): ✅ suite e2e completa **6/6** (signup×2 + register×2 + accept×2, ~1.2min <5min) · ✅ accept spec **3 runs consecutivas verdes** (2 passed c/u, chromium+webkit → 0 flaky) · ✅ `membership` stampeada + token consumido (re-visita 404) · ✅ render autenticado en custom domain (variante match vía sso-local) · ✅ vitest **1177/1177** (sin regresión) · ✅ typecheck.

**Commit**: `780b9be test(e2e): Phase 2.B.2 — E2E accept invite cross-domain (fallback sso-local)` · **Tag**: `baseline/phase-2-B-e2e-done` (creado sobre el tracker commit de cierre).

---

### Sesión 2.C — Coverage + critical paths unit [~3h]

- [ ] Configurar `pnpm test --coverage` (vitest c8/v8) con threshold inicial: 70% global, 85% en `src/features/access` + `src/features/invitations`
- [ ] Comment coverage en PRs (action GitHub o Vercel)
- [ ] Unit tests faltantes (cubrir branches no testeadas):
  - `src/features/nav-hub/actions/logout-action.ts` (signOut OK / throws)
  - `src/features/access/auth-actions.ts` branches: `error → status:'signup_failed'`, `data?.token` falsy
  - Integration `app.invitation_preview` directo (no solo via wrapper)
  - Integration `app.lookup_user_email_by_id` (si decisión 1.A.iii = keep; skip si dropped)
- [x] **Investigar flake `pnpm test` ambos projects en paralelo** (hallazgo Phase 1.B, 2026-05-28) → **INVESTIGADO 2026-06-02, NO REPRODUCIBLE**. Repro empírico con config idéntica a la del hallazgo (`vitest.config.ts` sin cambios desde 2026-05-18, `testTimeout` node 30s ya presente): 6/6 corridas verde (1177/1177), 5 de ellas bajo 8 CPU burners en máquina de 8 cores (load avg 65-76, oversubscripción 8x). **Hipótesis de starvation de CPU REFUTADA** — si fuera contención de CPU sobre el event loop del worker node (→ WS heartbeat tardío → close), load 70+ lo habría disparado; no lo hizo, y cada iter tardó ~8min incluso bajo carga (suite node es I/O-bound, no CPU-bound). Causa probable del flake del 28/05: condición transitoria de Neon (restart compute scale-to-zero / blip de red / límite de conexiones del branch ese momento), ya resuelta. **Decisión: NO tocar pools/concurrency** (sería fixear un fantasma, viola "evidencia reproducible antes del fix"). Mitigación higiénica aplicada:
  - Scripts `test:node` + `test:ui` (`package.json`) — DX + aislamiento por capa.
  - `tests.yml` corre los projects en pasos separados → status check independiente por project + hace verdadera la nota previa "CI separa los projects" (que era **incorrecta**: el workflow corría `pnpm test` = ambos juntos).
  - Gotcha `docs/gotchas/vitest-parallel-projects-flake.md` con el protocolo si reaparece (capturar stack fresco → verificar connection limit del branch Neon → recién ahí limitar `maxForks`).
  - `pnpm test` (ambos en paralelo) queda sin cambios como entrypoint local.

**Acceptance**: coverage report visible en cada PR · threshold no rota tests existentes · 3-4 tests nuevos verdes · `pnpm test` no flakea o split en scripts separados con doc clara.

**Commit**: _pending_

---

### Sesión 2.D — Data-model gaps + ontologías stubs [~2h] ✅

**Dividida en 2 subsesiones (de corrido, commit dedicado + compact entre ambas, 2026-06-01)**: 2.D.1 = gaps de `data-model.md` (1 archivo, capa de seguridad SQL) · 2.D.2 = stubs de ontologías en `features/` (set de archivos separado). Corte limpio: archivos disjuntos, research disjunto.

**Decisiones de la sesión (diagnóstico empírico pre-edición)**:
- **Conteo DEFINER confirmado = 18 activos** (el audit decía "18", verificado con grep preciso de `SECURITY DEFINER` en la línea de definición, no en comentarios). `app.create_place` cuenta como 2 por overload de aridad (5-arg legacy compat + 6-arg actual del wizard, ambos refactoreados en 0013 con cuerpo canónico). 1 dropeada (`lookup_user_email_by_id`, 0023→0026) NO cuenta. **ACL uniforme**: las 18 → `GRANT EXECUTE TO app_system` + `REVOKE FROM PUBLIC`, cero excepciones → columna ACL documentada una vez como canon, no por fila.
- **2 helpers RLS anti-recursión SÍ son DEFINER** (`current_user_owns_place` 0012, `is_peer_member` 0021): incluidos en el catálogo, marcados como helpers. **2 helpers de identidad NO son DEFINER** (`current_user_id` STABLE INVOKER, `get_inbox_payload` STABLE INVOKER): listados aparte para completar el mapa, fuera del catálogo.

**Items cerrados (2.D.1 — `data-model.md`)**:
- [x] §"Catálogo DEFINER" (nueva sección al final, satisface el forward-ref de §Migrations "ver inventario abajo"): tabla de 18 DEFINERs activos · migration canónica · propósito/feature owner + ACL canon uniforme + dropeada + 2 helpers no-DEFINER. Prosa de apertura sobre la única-superficie-de-escritura + `search_path` fijo + integration tests.
- [x] Policy `au_peer_member_read` (migration 0021, ADR-0038) en §"Auth y SSO": bullet nuevo con la regla peer-read (3er sujeto del trio), el helper `is_peer_member` SECURITY DEFINER anti-recursión, y ref a la cobertura por `idx_membership_user_active`.
- [x] Tabla `app.sso_jti_used` (migration 0011, ADR-0032) en nueva §"Tablas anti-replay (schema `app`)": patrón canónico (owned por `neondb_owner`, sin GRANT + RLS sin policies = doble deny) + `consume_sso_jti` VOLATILE + GC oportunista sin cron.
- [x] Forward-ref de §Migrations actualizado (de "pendiente Phase 2.D" a "inventario completo abajo") + fecha header → 2026-06-01.

**Items cerrados (2.D.2 — stubs `features/`)**:
- [x] 3 stubs `docs/features/{conversations,events,library}/spec.md` con shape consistente: banner stub (la ontología es fuente de verdad hasta que se construya) + §Estado="No empezada" + §Contexto (relación con el primitivo Discusión + zona Core vs opcional + activación desde `/settings`) + §Pointers (ontología canónica + objetos hermanos + data-model + activación de zona + gate de horario + storage R2 para library + slice futuro inexistente). Cierra el gap CLAUDE.md "ontología sin entrada features/".
- [x] Links relativos verificados (ontologías, data-model, multi-tenancy, `architecture.md` § "Gate de horario del place" L152, `settings/spec.md`, `features/README.md` — todos resuelven).

**Acceptance** (verificado 2026-06-01): data-model.md cubre 100% de DEFINERs (18) + tabla anti-replay + policy peer-read · 3 features stubs creadas con shape consistente · pre-commit hook (typecheck/lint skip por ser docs-only, secret-scan verde) en ambos commits.

**Commits**: `79c96a7` (2.D.1 — data-model gaps) · `77a5b05` (2.D.2 — stubs features)

---

### Sesión 2.E — Doc polish + cookie audit [~1.5h] ✅

**Decisiones de la sesión (2026-06-01)**:
- **Cookie audit reinterpretado por hallazgo del SDK**: el item original asumía 3 flags seteables (`httpOnly`, `secure`, `sameSite`). El diagnóstico del tipo `SessionCookieConfig` (SDK `@neondatabase/auth@0.4.1-beta`, `dist/next/server/index.d.mts`) reveló que el SDK **solo expone `sameSite`** como flag de cookie configurable (junto a `secret`/`domain`/`sessionDataTtl`). `httpOnly` y `secure` NO son configurables: el SDK los aplica internamente (session cookies de Better Auth son `HttpOnly` por diseño; `Secure` "always applied" per JSDoc del SDK). → el único hardening explícito posible es `sameSite`.
- **`sameSite: "strict"` fijado explícito = sin cambio de comportamiento**: el default actual del SDK ya es `"strict"`, así que pinnearlo es no-op funcional (no toca prod, que ya corre strict y pasó smoke en Phase 0). El valor agregado es **zero-trust sobre defaults**: si una versión futura del SDK cambiara el default, nuestra postura no se altera en silencio. `"strict"` es seguro para la topología: subdominios same-site viajan por `Domain` compartido (no por sameSite); el cruce a custom domains usa el Signed Ticket SSO (ADR-0032), no envío cross-site de la cookie. NO es decisión arquitectónica nueva (pin del status quo), documentado inline + acá per canon §"Decisiones scope durante ejecución".

**Items cerrados**:
- [x] §Pointers agregado a `docs/features/inbox/spec.md` + `docs/features/settings/spec.md` (al final, tras "Decisiones del producto cerradas"). Formato homogéneo con members/invitations: ADRs canónicas consumidas (links relativos verificados) + slices que implementan + schema/ontología/multi-tenancy + plan-sesiones + tests. **9/9 specs ahora tienen §Pointers** (eran 7/9).
- [x] `docs/features/inbox/plan-sesiones.md` — banner de estado al top: "V1 implementada y en producción · S11.3 (ADR-0033) cerró el último gotcha returnTo · referencia histórica · slices vivos `nav-hub` + `inbox`".
- [x] Cookie audit en `src/shared/lib/auth-config.ts`: `cookies.sameSite: "strict"` explícito + bloque de comentario "Cookie hardening" documentando que `httpOnly`/`secure` son SDK-managed (no configurables) + rationale strict-safe vía SSO. TDD: test `auth.test.ts` "zero-trust: cookies.sameSite fijado explícito a strict" (rojo→verde verificado).
- [x] `docs/data-model.md` §Invariantes — invariante nuevo "Todas las FKs son `ON DELETE NO ACTION` (sin CASCADE)": enumera las 6 FKs del core + justifica soft-delete canónico + WORM-via-DEFINER (contenido pertenece al place, sobrevive salida de miembro; tombstone deja `app_user` cáscara para PRESERVAR FKs, no romperlos) + regla heredada por FKs futuras.

**Acceptance** (verificado 2026-06-01):
- ✅ 9/9 features specs tienen `## Pointers` (grep verde)
- ✅ `pnpm typecheck` verde
- ✅ `pnpm lint --max-warnings 0` sobre archivos tocados — clean
- ✅ Node project: **964/964** verde (+1 test nuevo sobre baseline 963 de 2.G)
- ✅ UI project: **213/213** verde (sin regresión)
- ✅ Cookie config explícita (`sameSite: "strict"`) · cascade rules justificadas en data-model.md §Invariantes

**Commit**: `c5602b2 docs+chore(2.E): doc polish (§Pointers 9/9 + plan-sesiones) + cookie audit Neon Auth`

---

### Sesión 2.F — Backup + drifts deps [~1.5h] ✅

**Decisiones de la sesión (2026-06-01)**:
- **Retention window confirmado empíricamente = 6h** (NO asumido): `history_retention_seconds = 21600` en `prod-place` (`odd-mountain-73982304`), leído vía Neon API. El **tier NO lo expone la API/MCP** (es info de billing) → documentado como "confirmar en dashboard"; la API sí da el resto (Postgres 17, AWS us-east-1, autoscaling 0.25–2 CU). ⚠️ **Hallazgo operativo surfaceado: 6h es una ventana de PITR corta para prod** — flaggeado en `stack.md` + reporte al user; NO se cambió (extender retención es decisión de costo/arquitectura, fuera de scope de una sesión de docs per CLAUDE.md §"Ante una desviación").
- **Drizzle: NO se edita el cuerpo de ADR-0004** (inmutable per ADR-0004 §línea 8). Se usó el patrón canónico del repo "**Addendum operacional**" dated (ya presente en ADR-0046 ×6, ADR-0044) — opción (a) del tracker materializada como addendum, no como rewrite. Diagnóstico confirmó el drift: grep retornó **cero** usos de query builder Drizzle (`.select/.insert/...`); solo `pg-core` + tag `sql` en el schema.
- **Env drift: la premisa del tracker era imprecisa para `AI_GATEWAY_API_KEY`**. El item asumía "ambas declaradas sin imports". Diagnóstico: `RESEND_API_KEY` SÍ es fantasma (cero código + sin paquete `resend`), pero `AI_GATEWAY_API_KEY` tiene import real (`generateObject` from `ai` en `suggest-style-action.ts`) — es dep activa con slice dormido (ADR-0020), no planned. Documentadas con status distinto, sin lumping.

**Items cerrados**:
- [x] `docs/stack.md` — sección nueva "## Backup, PITR y recuperación (Neon)" (tras §Región e infraestructura): mecanismo history-retention (no snapshots) + ventana 6h confirmada vía API + tier a confirmar en dashboard + RPO ≈ 0 dentro de ventana / ilimitado fuera + RTO minutos (branch copy-on-write) + nota Neon Auth se restaura junto con `public` + **runbook de restore en 5 pasos** (in-place vs branch nuevo, repoint Vercel, smoke post-restore) + 3 links Neon docs.
- [x] `docs/decisions/0004-acceso-datos-drizzle.md` — "## Addendum operacional — Phase 2.F (2026-06-01)": uso real (schema-as-types + `drizzle-kit` migraciones; queries dominio = SQL raw vía `@neondatabase/serverless` Pool + DEFINERs; `sql` tag solo en schema) + por qué NO es reversión de ADR-0004 + decisión status quo (no migrar a query builder).
- [x] `docs/stack.md` §Piezas "Acceso a datos" — cláusula "Uso real (Phase 2.F)" apuntando al addendum.
- [x] `docs/stack.md` §Variables de entorno — `RESEND_API_KEY` y `AI_GATEWAY_API_KEY` separadas en bullets con status distinto (planned-sin-código vs dep-activa-slice-dormido); eliminado el lumping previo "Planned V1.3+". `.env.example` ya era preciso (Phase 0.B) → no requirió cambios.

**Acceptance** (verificado 2026-06-01): backup strategy clara con runbook ✅ · ADR-0004 con addendum reflejando uso real ✅ · stack.md sin env vars fantasma (RESEND roadmapped, AI_GATEWAY dep activa documentada) ✅ · sesión docs-only, cero `.ts` tocado → typecheck/suite sin cambios (no aplica re-run).

**Commit**: `4c20adf docs(2.F): backup/PITR Neon + drift Drizzle (addendum ADR-0004) + env drift`

---

### Sesión 2.G — i18n strings + date format [~1h] ✅

**Decisiones de la sesión (2026-05-31)**:
- **`inbox/[locale]/not-found.tsx` resuelve contra `routing.defaultLocale`, NO el segmento `[locale]`** (mismo patrón que el sibling `(marketing)/[locale]/not-found.tsx`). Razón empírica del diagnóstico: el archivo tenía un comentario deliberado "sin i18n runtime (locale podría ser inválido)" — `not-found.tsx` no recibe `params` (contract App Router) y el trigger DOMINANTE de este 404 es justamente un `[locale]` inválido (`hasLocale` falla en el layout → `notFound()`). Confiar en el segmento rebotaría a una key cruda. La conversión a `getTranslations({locale: defaultLocale, namespace: "inbox.notFound"})` hace las 3 strings traducibles satisfaciendo el item SIN romper el rationale original. Trade-off conocido y aceptado (idéntico al sibling marketing): un 404 con locale válido (sub-vista inexistente futura) igual renderea en `es` — aceptable para pantalla de error de borde.
- **6 catálogos están traducidos in-place** (no copias de `es.json` como en S1.a/b): en/fr/pt/de/ca tienen traducciones reales. Por eso cada key nueva se agregó con traducción real por locale, no copia ES (sino habría ES leaking en EN/FR — lo que el acceptance prohíbe).
- **Edición de catálogos programática + verificada byte-idéntica**: round-trip `JSON.parse→stringify(_,null,2)+"\n"` confirmado byte-idéntico sobre `es.json` ANTES de mutar → la inserción de keys produce CERO ruido de reformateo (git diff = solo las adiciones). Las keys nuevas se appendean al final de su objeto padre (orden intra-namespace es irrelevante; `check-translations` compara sets de paths).
- **Date format usa el `locale` del place (bare locale), no `es-AR`**: `place.default_locale` es uno de los 6 operativos. `toLocaleDateString(locale, ...)` → un place `en` muestra "Jun 1, 2026"; `es`, "1 jun 2026". Determinístico server/client (el locale es un string fijo del render, no del browser). Se dropeó el `-AR` regional — el place define su locale, no se asume Argentina.

**Items cerrados**:
- [x] `inbox/[locale]/not-found.tsx` → `async` + `getTranslations({locale: routing.defaultLocale, namespace: "inbox.notFound"})`; las 3 strings (`title`/`body`/`cta`) desde catálogo. Comentario header reescrito documentando el rationale defaultLocale + el trade-off.
- [x] `sso-fallback-panel.tsx` `<summary>` "Detalles técnicos" → `{labels.technicalDetails}`. Campo nuevo `technicalDetails: string` agregado a `SsoFallbackLabels` (+ JSDoc: el `errorCode` en sí NO se traduce, es identificador estable del protocolo SSO). Wireado en los **3 pages** que construyen `ssoLabels`: `settings/page.tsx`, `settings/members/page.tsx`, `settings/domain/page.tsx` (`technicalDetails: tSso("technicalDetails")`).
- [x] `pending-invitations-tab.tsx`: `formatExpiresAt(d, locale)` + prop nueva `locale: string`. Threadeado por `MembersPageShell` (prop `locale`) ← `members/page.tsx` (`locale={place.defaultLocale}`). Comentario "ES-AR" del header actualizado.
- [x] Keys nuevas en `messages/{es,en,fr,pt,de,ca}.json` (6 locales, traducidas):
  - `inbox.notFound.{title,body,cta}`
  - `customDomainRouting.sso.technicalDetails`
- [x] Tests actualizados (TDD — contrato nuevo encodeado antes de impl):
  - `sso-fallback-panel.test.tsx`: `technicalDetails` en fixture `LABELS` (campo requerido) + test nuevo asserta que `<summary>` usa el label (no hardcoded).
  - `pending-invitations-tab.test.tsx`: `setup` pasa `locale` (default `es`) + test nuevo "en ≠ es" (computa expected vía `Intl` para ser TZ-robusto; asserta forma EN presente + forma ES ausente).
  - `members-page-shell.test.tsx`: render con `locale="es"`.
  - `sso-trigger.test.ts`: cast type extendido con `technicalDetails` + assertion del label wireado por el settings page.

**Acceptance** (verificado 2026-05-31):
- ✅ `node scripts/check-translations.mjs` → es.json reference (364 keys) · en/fr/pt/de/ca **0 missing, 0 extras** (parity total) [no hay package script `check-translations`; se corre directo]
- ✅ `pnpm typecheck` verde
- ✅ `pnpm lint --max-warnings 0` sobre los 7 archivos tocados — clean
- ✅ UI project: **213/213** verde (+2 tests nuevos sobre baseline 211)
- ✅ Node project: **963/963** verde (sin regresión)
- ✅ 0 strings ES hardcoded en los 3 callsites del item (grep limpio); pages en EN/FR/etc no leakean ES (catálogos traducidos in-place)

**Commit**: `aace521 i18n(2.G): strings hardcoded → catálogo + fecha con locale del place`

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
| `baseline/phase-0-E-observability-done` | `204a124` | Observability load-bearing (Phase 0.E) |
| `baseline/phase-0-tech-debt-done` | `204a124` | Cierre Phase 0 |
| `baseline/pre-phase-1-tech-debt` | `f577908` | Save point pre-Phase 1 |
| `baseline/phase-1-G-storage-decided` | `9e6f28e` | Storage decision load-bearing |
| `baseline/phase-1-tech-debt-done` | `3fa0cc3` | Cierre Phase 1 |
| `baseline/pre-phase-2-tech-debt` | _= phase-1-done (`3fa0cc3`)_ | Save point pre-Phase 2 |
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
