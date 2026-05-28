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
| **0 — Bloqueantes** | 5 | 2/5 | `baseline/pre-phase-0-tech-debt` ✅ | _pending_ |
| **1 — Hardening** | 7 | 0/7 | _pending_ | _pending_ |
| **2 — Tests + docs** | 8 | 0/8 | _pending_ | _pending_ |
| **3 — Polish** | 6 | 0/6 | _pending_ | _pending_ |
| **4 — Backlog V1.3 mid** | — | — | n/a (no sesiones predefinidas) | n/a |

**Progreso total**: 2/26 sesiones · ~50h dev estimadas si serial · esfuerzo Phase 0+1 (mínimo viable pre-V1.3) = ~3.5 días dev.

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

### Sesión 0.B — DX docs foundation [~1.5h]

- [ ] Rewrite `README.md` root: setup local (pnpm, Node ≥22, .nvmrc), env vars donde sacar c/secret (Neon dashboard, Vercel), pnpm scripts (`db:migrate`, `test`, `typecheck`, `lint`, `build`), deploy notes, mapa `docs/` + `CLAUDE.md`
- [ ] Crear `.env.example` checked-in: 12-15 env vars con placeholders + scope hint (`prod-only`, `all-envs`) + dónde obtener c/secret. Cross-check vs `process.env.*` usados en `src/`
- [ ] Verificar `docs/stack.md` env drift: `RESEND_API_KEY` + `AI_GATEWAY_API_KEY` declarados sin imports → decisión drop o mark planned (anotado para Phase 2.F si requiere lookup)

**Acceptance**: nuevo dev puede levantar entorno local solo leyendo `README.md` + `.env.example` · sin enviar secrets reales al repo.

**Commit**: _pending_

---

### Sesión 0.C — CI gates [~1h] ✅

- [x] Workflow nuevo `.github/workflows/tests.yml` creado (decisión: separado, no extender lighthouse.yml). Corre `pnpm test` (vitest full: node + ui projects) en `pull_request: branches:[main]`. Header documenta setup canon de GitHub secrets `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (rol `app_system` + `neondb_owner` del branch `test` de Neon). Timeout 15min con margen para cold-start Neon
- [x] Trigger `pull_request` (no solo push). Igual que `lighthouse.yml`
- [x] **Snapshots Drizzle: hallazgo del audit reinterpretado**. La ausencia de 0009-0024 NO es bug — es **convención del proyecto**: Drizzle genera snapshots solo para schema-only migrations (CREATE TABLE, ALTER COLUMN); las 0009-0024 son custom SQL (RLS policies, DEFINERs, GRANTs, partial indexes) que Drizzle NO modela en su schema TS. Documentado en `docs/data-model.md` §"Migrations & snapshots" con: (a) los 2 tipos de migrations que conviven, (b) protocolo para futuras (cuándo `pnpm db:generate` vs hand-written), (c) rollback strategy + reverse SQL canon en comentario al inicio del `.sql`

**Acceptance**: workflow file válido (yaml lint OK por estructura) · doc §"Migrations & snapshots" explica protocolo · Agent 5 finding reinterpretado correctamente como convention, no como gap a cerrar

**Notas operativas pendientes para user**: agregar GH secrets `DATABASE_URL_TEST` + `DATABASE_URL_TEST_MIGRATE` (instrucciones step-by-step en header del workflow). Sin esos secrets, los tests `node` fallarán con connection refused — flag explícito de "setup pendiente", no regresión.

**Commit**: _ver siguiente commit_ · **Tag**: _no aplica (no load-bearing)_

---

### Sesión 0.D — Edge config: security headers + rate limit + vercel.json [~3-4h]

- [ ] Crear `vercel.json` (o `vercel.ts`) mínimo: `regions: ["iad1"]`, framework, build command explícito, headers globales
- [ ] Security headers en `next.config.ts` `headers()` O `vercel.json`:
  - HSTS app-level (además del edge Vercel automático): `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - CSP base (start permissive, lock down luego): `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; ...`
  - X-Frame-Options: `DENY` (excepto si custom domains necesitan embed — verificar)
  - Referrer-Policy: `strict-origin-when-cross-origin`
  - Permissions-Policy: mínima (sin geolocation/camera/microphone)
  - X-Content-Type-Options: `nosniff`
- [ ] Rate limiting en endpoints críticos: investigar stack (Upstash Ratelimit recomendado), threshold conservador (e.g. 10 req/min por IP). Aplicar a:
  - `src/app/api/auth/sso-issue/route.ts`
  - `src/app/api/auth/sso-init/route.ts`
  - `src/features/access/auth-actions.ts` (`loginAction`, `signUpAccountAction`)
  - `src/features/invitations/actions/accept-invitation.ts` (`acceptInvitationAction`)
  - `src/features/invitations/actions/create-invitation.ts` (`createInvitationAction`)
- [ ] Verificar custom domains no rompen con CSP nuevo (test smoke en `nocodecompany.co`)

**Acceptance**: curl + HARs muestran headers correctos · 11vo request en 1min en endpoint protegido retorna 429 · custom domain sigue funcionando con CSP.

**Commit**: _pending_ · **Tag**: `baseline/phase-0-D-edge-config-done` (load-bearing)

---

### Sesión 0.E — Observability stack [~4-6h, posible split E1/E2]

**Sub-sesión 0.E1 — Decisión + provisioning + wrapper [~2h]**

- [ ] Decisión stack: Sentry (recomendado por integración Vercel) vs BetterStack vs Axiom. ADR nueva `docs/decisions/0047-observability-stack.md` con rationale + alternativas rechazadas
- [ ] Provisioning: crear proyecto en provider elegido + obtener DSN/token + agregar env var en Vercel (prod + preview scoped)
- [ ] Wrapper `src/shared/lib/observability/log.ts` (pino structured + provider sink):
  - `log.info({...meta}, msg)`, `log.warn`, `log.error(err, {...meta}, msg)`
  - Auto-enrichment: requestId, userId (si available), zone (apex/sub/custom)
- [ ] Sentry/error tracking SDK init en `src/instrumentation.ts` (Next.js 16 instrumentation hook)

**Acceptance E1**: log.info de prueba aparece en dashboard del provider en <30s · errors uncaught se reportan automáticamente.

**Commit E1**: _pending_

**Sub-sesión 0.E2 — Wire 90 console.* → logger [~2-4h]**

- [ ] Grep `console.(log|warn|error|info|debug)` en `src/**` (excluir tests)
- [ ] Reemplazar c/u por `log.*` equivalente con metadata estructurada
- [ ] Priorizar error paths críticos (Server Actions catch blocks, route handler errors, SSO chain)
- [ ] Para `console.log` debug obvios sin valor en prod: deletear (no migrar)

**Acceptance E2**: zero `console.*` en código no-test · errores de invite/SSO/place-creation aparecen en error tracker con stack trace + metadata.

**Commit E2**: _pending_ · **Tag**: `baseline/phase-0-E-observability-done` (load-bearing)

---

### 🏁 Cierre Phase 0

**Tag post-phase**: `baseline/phase-0-tech-debt-done` (apuntará al commit de 0.E2 o el último de la phase)

**Acceptance phase**: CI corre tests · README explica todo · .env.example completo · headers + rate limit configurados · observability operativa · zero CTAs muertos · suite vitest sigue 1135/113 verde · typecheck + lint verdes

---

## Phase 1 — Hardening pre-V1.3 (7 sesiones, ~12-14h)

**Save point**: `baseline/pre-phase-1-tech-debt` (= tag post-phase-0, crear al cerrar Phase 0)

Cleanup directo del cluster auth + DB + invite. Evita acumulación durante V1.3.

### Sesión 1.A — DB hardening [~2h]

- [ ] Migration 0025: `CREATE INDEX` para FKs sin índice
  - `idx_invitation_place_id ON invitation(place_id)`
  - `idx_place_domain_place_id ON place_domain(place_id)`
  - `idx_place_ownership_place_id ON place_ownership(place_id)` (crítico: cada policy/DEFINER lo filtra)
- [ ] Pattern `SET lock_timeout = '5s'` al inicio de migration 0025 + documentar como canon en `data-model.md`
- [ ] Migration 0023 zombie decisión binaria:
  - Opción A: migration 0026 con `DROP FUNCTION app.lookup_user_email_by_id` + write-back ADR-0046 §"Sesión D.fix.3" addendum
  - Opción B: agregar integration test `src/db/__tests__/lookup-user-email-by-id.test.ts` (espejo de identity test) + documentar caller futuro
  - **Recomendación**: A (zombie real, supersedido por 0024). Apply migration 0025 + 0026 vía Neon MCP

**Acceptance**: query planner usa index nuevo en EXPLAIN sobre JOIN typical (`SELECT * FROM invitation WHERE place_id = X`) · DEFINER 0023 droppeada o testeada · ADR-0046 actualizada con decisión.

**Commit**: _pending_

---

### Sesión 1.B — Auth hardening [~1.5h]

- [ ] Zod schema en `src/features/access/auth-actions.ts`:
  - `loginAction`: email format + password min length
  - `signUpAccountAction`: idem + displayName trim non-empty
- [ ] Zod schema en `src/features/nav-hub/actions/logout-action.ts`:
  - `locale: z.enum(routing.locales)` (open-redirect protection)
- [ ] Migrar `src/features/place-creation/actions.ts` (`createPlaceAction`) de patrón pre-ADR-0034 (`getAuth().getSession()` + `requireSessionJwt()`) a `getAuthenticatedDbForRequest()` zone-aware. Es el último survivor del patrón viejo
- [ ] Verificar tests no regresionan (`pnpm test src/features/place-creation src/features/access src/features/nav-hub`)

**Acceptance**: typecheck verde · suite verde · grep `getAuth().getSession()` en código retorna SOLO callsites apex-only justificados (login/signup/logout pueden quedar si son apex-confined).

**Commit**: _pending_

---

### Sesión 1.C — Tests infra + cleanup schema [~2.5h]

- [ ] Crear `src/db/__tests__/_factories/` con helpers reutilizables:
  - `makeUser(overrides?)` → seed en `neon_auth.user` + `app_user`
  - `makePlace(opts: {ownerUserId, slug?, ...})` → place + ownership
  - `makeInvitation(opts: {placeId, email, ...})` → invitation row + token
  - `makeMembership(opts: {userId, placeId, headline?})` → membership
- [ ] Refactor 3-4 tests integration que duplican setup más obvio para usar factories (no migrar todos en una sesión, solo proof-of-pattern)
- [ ] Drop campo `placeSlug` del Zod schema en `src/features/invitations/actions/_lib/schemas.ts`:
  - Schema: remove field
  - Tipo `AcceptInvitationInput`: remove field
  - Caller `invite-acceptance-panel.tsx`: stop sending `placeSlug` en payload del POST

**Acceptance**: factories tests pasan · tests refactoreados se ven más limpios (~30 LOC menos cada uno) · accept-invitation action recibe payload sin `placeSlug` · tests del action siguen verdes.

**Commit**: _pending_

---

### Sesión 1.D — Pre-commit hook [~30min]

- [ ] Instalar lefthook (preferido sobre husky por simplicidad + perf): `pnpm add -D lefthook`
- [ ] Config `lefthook.yml` con pre-commit hook:
  - `pnpm typecheck --noEmit` (fast)
  - `pnpm lint --max-warnings 0` sobre staged files
  - Secret scan básico (grep custom de patterns `.env`, tokens, etc.)
- [ ] Documentar en `README.md` §Setup que `pnpm install` activa los hooks automáticamente

**Acceptance**: commit con error de typescript falla pre-commit · commit con archivo `.env*` en staging falla · commit clean pasa instantáneamente.

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

## Phase 2 — Tests + docs completeness (8 sesiones, ~12-14h)

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

**Acceptance**: coverage report visible en cada PR · threshold no rota tests existentes · 3-4 tests nuevos verdes.

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

### 🏁 Cierre Phase 2

**Tag post-phase**: `baseline/phase-2-tech-debt-done`

**Acceptance phase**: 3 E2E verdes en CI · coverage threshold enforced · data-model.md 100% coverage · 3 ontologías con stubs · backup strategy doc · zero i18n strings hardcoded · Suspense streaming en pages settings.

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
| `baseline/phase-0-D-edge-config-done` | _pending_ | Edge config load-bearing |
| `baseline/phase-0-E-observability-done` | _pending_ | Observability load-bearing |
| `baseline/phase-0-tech-debt-done` | _pending_ | Cierre Phase 0 |
| `baseline/pre-phase-1-tech-debt` | _= phase-0-done_ | Save point pre-Phase 1 |
| `baseline/phase-1-G-storage-decided` | _pending_ | Storage decision load-bearing |
| `baseline/phase-1-tech-debt-done` | _pending_ | Cierre Phase 1 |
| `baseline/pre-phase-2-tech-debt` | _= phase-1-done_ | Save point pre-Phase 2 |
| `baseline/phase-2-B-e2e-done` | _pending_ | E2E suite load-bearing |
| `baseline/phase-2-H-suspense-done` | _pending_ | Suspense streaming load-bearing |
| `baseline/phase-2-tech-debt-done` | _pending_ | Cierre Phase 2 |
| `baseline/pre-phase-3-tech-debt` | _= phase-2-done_ | Save point pre-Phase 3 |
| `baseline/phase-3-tech-debt-done` | _pending_ | Cierre Phase 3 + tech debt closure |

---

## Pointers

- **Audit origin**: 2 rondas de agents read-only (5+5) post-V1.2 cierre 2026-05-28. Resumen en conversación de origen.
- **Reglas canónicas**: ver §"Reglas operativas" arriba.
- **Decisiones scope durante ejecución**: documentar inline en el item correspondiente + crear ADR si load-bearing.
- **Save point rollback protocolo**: si una phase se descarta a mitad, `git reset --hard baseline/pre-phase-<N>-tech-debt` + remove de tags intra-phase + restart phase.
