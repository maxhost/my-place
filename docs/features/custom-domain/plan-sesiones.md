# Plan de implementación — Feature Custom Domain V1 (sección "Dominio" en `/settings`)

> **DS S2 update (2026-05-23)**: Este plan de sesiones es histórico (Feature A V1 cerrada). Las menciones forward-looking a "Feature C OIDC SSO" / "ADR-0027" reflejaban el plan original (ADR-0001), pero **Feature C V1 se entregó con Signed Ticket pattern (ADR-0032)**, no con OIDC canonical. La columna `oauth_client_id` queda NULL indefinidamente (forward-compat). ADR-0027 nunca se escribirá. Spec canónico de Feature C: [`docs/features/custom-domain-sso/`](../custom-domain-sso/spec.md).

> _Creado 2026-05-21_. Referencia abreviada del plan canónico vivo en `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md`. Las sesiones de implementación se documentan acá de forma resumida; el plan vivo, detallado, con pseudocódigo, riesgos y matriz de archivos, vive en el plan file referenciado. Si hay desacuerdo entre este doc y el plan, gana el plan.
>
> **Nota retroactiva (2026-05-21, S4 close)**: este plan describe los paths bajo `src/features/place-settings/{ui,actions,types}/...domain*` que fueron la asunción de S0. **En S4 se promovió** el sub-feature Dominio a slice propio `src/features/custom-domain/` (ADR-0028: cap LOC ≤1500 del slice anfitrión + ADR/spec/migration propias). Los archivos viven actualmente en `src/features/custom-domain/{ui,actions,types,__tests__}/`. El comportamiento, la spec, las migrations y los tests son idénticos — sólo cambió el namespace físico. Las referencias debajo a `place-settings/{ui,actions,types}/...domain*` se mantienen como histórico del plan original.

## Resumen

7 sesiones (S0–S6). S0 es docs only. S6 es opcional (V1.1 — cron safety net). Cada sesión cumple `≤5–10 archivos` y green-close completo antes de commit. Compact recomendado entre sesiones para mantener la ventana de contexto limpia.

| Sesión | Objetivo | Files | Status |
|---|---|---|---|
| **S0** | Docs + ADR-0026 + tag baseline | 8 docs | **closed** (2026-05-21) |
| **S1** | Schema delta: partial unique index `(domain) WHERE archived_at IS NULL` | 4 (schema + migration + 2 tests) | **closed** (2026-05-21) |
| **S2** | Foundations `shared/lib/` — validate + reserved + Vercel wrapper | 8 (3 src + 3 tests + 1 barrel + 1 doc) | **closed** (2026-05-21) |
| **S3** | Server Actions del slice `custom-domain` (originalmente plan: `place-settings/domain`) | 7 (5 src + 2 tests del pure helper) | **closed** (2026-05-21) |
| **S4** | UI `<DomainSection>` + page sub-ruta + activación sidebar + **promoción a slice propio** (ADR-0028) | 14 (4 código + 6 i18n + 1 page + 2 ADR/docs + slice refactor) | **closed** (2026-05-21) |
| **S5** | Docs final close + manual smoke + push autorizado | 4 docs + push | pending |
| **S6** | Cron safety net (opcional V1.1) | 3-4 (route + test + vercel.json + env) | pending |

---

## Sesión S0 — Docs + ADR-0026 + tag baseline

### Objetivo

Establecer el contrato escrito que las sesiones siguientes respetan. Ningún archivo de código.

### Files

- **Crear**: `docs/decisions/0026-custom-domain-v1-lazy-verification.md` (ADR completa).
- **Crear**: `docs/features/custom-domain/spec.md` (UX states + flows + state-machine diagram).
- **Crear**: `docs/features/custom-domain/plan-sesiones.md` (este archivo).
- **Crear**: `docs/features/custom-domain/tests.md` (TDD checklist).
- **Modificar**: `docs/multi-tenancy.md` §"Dominios propios" — pointer a ADR-0026.
- **Modificar**: `docs/data-model.md` — anotar partial unique + invariante "archived libera dominio".
- **Modificar**: `docs/features/settings/spec.md` — quitar "Sección Dominio" de "Fuera de V1".
- **Modificar**: `docs/decisions/README.md` — entry ADR-0026.

### Estrategia parallel agents

- Yo creo **ADR-0026** primero (single source of truth).
- 3 agents paralelos: A crea `spec.md`, B crea `plan-sesiones.md` + `tests.md`, C actualiza los 3 docs existentes (archivos disjuntos).
- Cierre: yo actualizo `decisions/README.md` (1 línea) + `git tag baseline/pre-custom-domain-feature 3dea847` LOCAL (no push) + commit.

### Commit

`docs(custom-domain): plan completo S0 + ADR-0026 + tag baseline (Feature A)`

### Compact al cierre

Sí.

---

## Sesión S1 — Schema delta: partial unique index

### Objetivo

Habilitar que un dominio archivado pueda ser re-registrado (mismo o distinto place). Schema delta mínimo — sin columnas de back-off.

### Files

- **M** `src/db/schema/index.ts` — reemplazar `text("domain").notNull().unique()` por partial `uniqueIndex("place_domain_domain_active_unq").on(t.domain).where(sql\`archived_at IS NULL\`)`.
- **+** `src/db/migrations/0008_place_domain_partial_unique.sql` — `DROP CONSTRAINT` + `CREATE UNIQUE INDEX ... WHERE archived_at IS NULL` + header con Reverse SQL.
- **M** `src/db/__tests__/schema.test.ts` — test "place_domain_domain_active_unq existe + permite reuso post-archive".
- **M** `src/db/__tests__/rls.test.ts` — test "INSERT post-archive del mismo dominio con 2 owners distintos no falla con UNIQUE".

### Pre-flight check

`SELECT COUNT(*) FROM place_domain;` antes de migrar. Si > 0, pausar y consultar.

### Estrategia parallel agents

1 task focalizada (los 4 archivos son una unidad atómica de schema). No paraleliza bien.

### Commit

`feat(schema): partial unique index en place_domain (libera dominios archivados, ADR-0026)`

### Compact al cierre

Sí.

---

## Sesión S2 — Foundations `shared/lib/`

### Objetivo

Crear todos los building blocks compartidos antes de tocar el slice. Función pura `validateCustomDomain` (SoT client+server), lista de reservados, wrapper de Vercel Domains API.

### Files

- **+** `src/shared/lib/custom-domain.ts` — `validateCustomDomain(input)` (RFC 1123, no IDN, no wildcards, blocklist).
- **+** `src/shared/lib/__tests__/custom-domain.test.ts` — ≥15 casos.
- **+** `src/shared/lib/reserved-domains.ts` — `RESERVED_DOMAINS` + `RESERVED_DOMAIN_SUFFIXES` + `isReservedDomain(d)`.
- **+** `src/shared/lib/__tests__/reserved-domains.test.ts` — ≥6 casos.
- **+** `src/shared/lib/vercel/domains.ts` — `addDomain` + `getDomainStatus` + `removeDomain` (fetch directo + Zod parse).
- **+** `src/shared/lib/vercel/__tests__/domains.test.ts` — ≥7 response shapes con mock `fetch` + `vi.stubEnv`.
- **+** `src/shared/lib/vercel/index.ts` — barrel.
- **M** `docs/stack.md` — `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` pasan de TBD a vigentes.

### Estrategia parallel agents

- Yo creo **barrel vacío** primero.
- 3 agents paralelos (archivos disjuntos): A → `custom-domain.ts` + test; B → `reserved-domains.ts` + test; C → `vercel/domains.ts` + test.
- Cierre: populo barrel + verifico acíclico + commit.

### Commit

`feat(shared): foundations custom-domain (validate + reserved + Vercel wrapper, ADR-0026)`

### Compact al cierre

Sí.

---

## Sesión S3 — Server Actions del slice `place-settings/domain`

### Objetivo

Crear las 3 Server Actions del slice + types compartidos + helper puro testeable. Patrón seam-split estricto, defense-in-depth (Zod + `requireSessionJwt` + `getAuthenticatedDb` con RLS + `revalidatePath`).

**Canon (`update-default-locale.ts:13`):** las Server Actions NO se testean directo con vitest (arrastra `next/headers` + Neon Auth + DB real). Su correctitud es typecheck + build + smoke vivo. Tests viven en piezas puras compuestas.

### Files

- **+** `src/features/place-settings/types/custom-domain.ts` — types + `mapPgErrorToActionError` (pure function testeable).
- **+** `src/features/place-settings/types/__tests__/custom-domain.test.ts` — tests del helper (≥4 casos).
- **+** `src/features/place-settings/actions/register-custom-domain.ts` (sin test directo — canon).
- **+** `src/features/place-settings/actions/archive-custom-domain.ts` (sin test directo — canon).
- **+** `src/features/place-settings/actions/get-custom-domain-status.ts` (sin test directo — canon; lazy poll).
- **M** `src/features/place-settings/public.ts` — exports + nota canon "Server Actions sin vitest".

### Estrategia parallel agents

- Yo creo **`types/custom-domain.ts` + su test** primero (read-only para los 3 agents).
- 3 agents paralelos: A → `register`; B → `archive`; C → `get-status`.
- Cierre: yo actualizo `public.ts` con los exports + verifico acíclico + commit.

### Commit

`feat(place-settings): Server Actions custom-domain (register/archive/lazy-verify, ADR-0026)`

### Compact al cierre

Sí.

---

## Sesión S4 — UI `<DomainSection>` + page sub-ruta + activación sidebar

### Objetivo

UI Client Component con todos los estados + page `/settings/domain` que cableea Server Actions + i18n labels × 6 locales + activación del item del sidebar.

### Files

- **+** `src/features/place-settings/ui/domain-section.tsx` — Client Component (4 estados: none · pending · verified · error; form + DNS table copy-to-clipboard + auto-refresh `router.refresh()` cada 30s + confirm dialog).
- **+** `src/features/place-settings/__tests__/domain-section.test.tsx` — ≥11 tests RTL.
- **+** `src/app/(app)/place/[placeSlug]/settings/domain/page.tsx` — Server Component (guard + `getCustomDomainStatus` + inject actions; `dynamic = "force-dynamic"`).
- **M** `src/features/nav-place/ui/nav-place-items.tsx` — item `domain` pasa de `disabled: true` a `href: "/settings/domain"`.
- **M** `src/features/place-settings/public.ts` — exporta `DomainSection` + `DomainSectionLabels`.
- **M** `src/i18n/messages/{es,en,fr,pt,de,ca}.json` — namespace `placeSettings.domain.*` (~25 keys × 6 locales).
- **M** `docs/features/custom-domain/spec.md` — anotar cableado del page + sidebar activado.

### Estrategia parallel agents

- Yo creo **page Server Component** primero (depende de `public.ts` post-S3).
- 4 agents paralelos: A → `domain-section.tsx` + test; B → edit `nav-place-items.tsx` + JSDoc; C → 6 JSONs i18n; D → update `spec.md`.
- Cierre: yo update `public.ts` + verifico `check-translations` 0/0 + green-close.

### Commit

`feat(place-settings): UI DomainSection + page sub-ruta + activación sidebar V1.1 (ADR-0026)`

### Compact al cierre

Sí.

---

## Sesión S5 — Docs final close + manual smoke + push autorizado

### Objetivo

Cierre documental + smoke checklist + push autorizado por el user.

### Files

- **M** `docs/multi-tenancy.md` §"Dominios propios" — reescribir al estado V1 actual (lazy verification + partial unique + archived libera + `oauth_client_id` NULL indefinidamente (ADR-0032 deprecó la ruta OIDC canónica; forward-compat)).
- **M** `docs/features/settings/spec.md` línea 50 — quitar "Sección Dominio" de "Fuera de V1"; entry en §"Sección Dominio (V1.1)" con pointer.
- **M** `docs/features/settings/plan-sesiones.md` — entry "Custom Domain V1" como histórico cerrado.
- **M** `docs/decisions/0001-auth-oidc-custom-domains.md` — banner top "Refinada por ADR-0026".

### Manual smoke

10 puntos (ver `tests.md` §"Manual smoke checklist").

### Push final

- `git status --short` review (sin `.env`, sin `*backup*`, sin `*secret*`).
- `git push maxhost main` (fork) + `git push origin main` (original).
- Push del tag baseline: `git push maxhost baseline/pre-custom-domain-feature` + `git push origin baseline/pre-custom-domain-feature`.
- Tag de feature (opcional): `git tag v1.1.0-custom-domain HEAD` + push.

### Estrategia parallel agents

4 agents paralelos para las 4 docs editions (archivos disjuntos). Yo corro manual smoke + cierre + commit + (con autorización) push.

### Commit

`docs(custom-domain): cierre Feature A + smoke verificado + ADR-0001 refinada por ADR-0026`

### Compact al cierre

No (es la última sesión).

---

## Sesión S6 (opcional, V1.1) — Cron safety net

### Diferible

Si en S5 manual smoke se observa que el lazy poll cubre el 99% de los casos, S6 se difiere a V1.1. Si en producción se detecta "owners cierran tab y nunca vuelven", se activa.

### Files

- **+** `src/app/api/cron/verify-domains/route.ts` — GET handler con `Authorization: Bearer ${CRON_SECRET}`; lookup `verified_at IS NULL AND archived_at IS NULL LIMIT 100` → poll cada uno → UPDATE si verified.
- **+** `src/app/api/cron/verify-domains/__tests__/route.test.ts` — handler con mock auth + mock vercel + mock DB.
- **+** o **M** `vercel.json` — entry `crons: [{path: "/api/cron/verify-domains", schedule: "*/15 * * * *"}]`.
- **M** `.env.local.example` — `CRON_SECRET`.

### Commit

`feat(cron): safety-net verification de custom domains cada 15min (V1.1)`

---

## Standards transversales (aplican a TODAS las sesiones)

- **TDD obligatorio** (CLAUDE.md §"Durante la implementación"): tests primero → verificar rojo → implementar → verde. Sin excepciones en core (slice + actions + validators).
- **Compact antes de cada sesión** — `/compact` invocado por user. Recordatorio al cierre de cada sesión.
- **Commit al inicio (si hay WIP previo) + commit al cierre** — cada sesión termina con un commit production-grade.
- **Stage por path explícito** — NUNCA `git add -A` ni `git add .`. Antes de commit: `git status --short` + revisar lista.
- **Push deferido** — NO push hasta autorización explícita en su turno (default: no push entre sesiones; push final al cierre).
- **Triple review pre-acción** contra CLAUDE.md + architecture.md.
- **Parallel agents intra-sesión** cuando NO se pisan archivos. Files read-only compartidos: el orquestador los crea primero, luego despacha.
- **Green-close por sesión** — `pnpm typecheck` clean · `pnpm lint` 0 problemas · `pnpm test` ≥ baseline · `pnpm build` verde · LOC checks (≤300/archivo, ≤1500/slice, ≤800/shared module).
- **Acíclico shared←features verificado** post-sesión cuando aplique: `grep -rn 'from "@/features/' src/shared/` → vacío.

---

## Forward-compat con Features B y C

- **Feature B — Custom Domain Host Routing**: plan posterior. Toca `src/shared/lib/host-routing.ts`. Necesitará función Postgres `app.lookup_place_by_domain(host)` `SECURITY DEFINER` (RLS owner-only no aplica al edge proxy sin claim). Documentado en ADR-0026 §"Consecuencias futuras"; cero hooks en este slice.
- **Feature C — Custom Domain SSO (V1 deployed, Signed Ticket, ADR-0032)**: entregada el 2026-05-23. Endpoints reales: `/api/auth/sso-{init,issue,redeem,jwks}` (NO callback handler OIDC). Sin provisioning del OIDC client (la columna `oauth_client_id` queda NULL indefinidamente). Cero hooks en este slice — Feature C consume `app.lookup_place_by_domain` (Feature A/B) sin modificar el schema de `place_domain`. Spec canónico: [`docs/features/custom-domain-sso/spec.md`](../custom-domain-sso/spec.md).

---

## Pointers

- **Plan canónico vivo**: `/Users/maxi/.claude/plans/wise-greeting-mccarthy.md` — fuente de verdad de scope, riesgos, files index, decisiones cerradas.
- **ADR-0026**: `docs/decisions/0026-custom-domain-v1-lazy-verification.md` — decisión + alternativas rechazadas + consecuencias.
- **Spec del feature**: `docs/features/custom-domain/spec.md` — UX states, flows, error mapping, state-machine.
- **Tests del feature**: `docs/features/custom-domain/tests.md` — TDD plan detallado por sesión.
