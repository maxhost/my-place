# Plan — Rediseño `/settings/flags` con detail-from-list (3 sesiones)

## Context

`/settings/flags` hoy renderea cards pesadas (`<FlagQueueItem>` de 238 LOC) con header de badges + título + preview + nota del reporter + acciones inline al pie. Cada card es densa visualmente; las acciones (Ignorar / Ocultar / Eliminar) viven inline y disparan `<Dialog>` confirm dentro del mismo card. Tabs Pendientes/Resueltos URL-based, paginación cursor-based 20/page.

Aplicamos el **patrón canónico `detail-from-list`** ya consolidado en:

- `features/library/admin/` (canon S5).
- `features/groups/admin/` (S7).
- `features/tiers/ui/` (TierDetailPanel).
- `features/members/admin/` (S1-S4, mayor consumer, 2 listados intercambiables + sub-sheets).

**Decisiones del rediseño (2026-05-14):**

- **Tabs Pendientes / Resueltos**: mantener URL-based (`?tab=`); estilo nuevo con chip-pill (mismo patrón visual que `<TabChip>` de members admin) — los tabs con `border-b-2` actuales son inconsistentes con el resto del settings rediseñado.
- **Tabs como `<Link>`** de `next/link` para navegación client-side (Next 15 hace RSC payload diff del segment — no full page reload). El page actual ya usa `<Link>` correctamente; el wrapper nuevo lo respeta.
- **Row tappable → `<FlagDetailPanel>`**: EditPanel responsive (sidepanel desktop 520px / bottom sheet mobile). Read-only del flag completo + acciones en el footer.
- **Drop `<FlagQueueItem>` legacy**: la lógica de acciones migra al detail panel + atajos kebab en el row. Card pesada → row liviana + detail propio.
- **NO sumar search**: hoy no hay caso justificado (ux-patterns.md anti-pattern: "no agregar features sin caso real"). Si emerge con volúmenes altos, sumar después.
- **SÍ sumar filtro por targetType** (POST / COMMENT / EVENT + "Todos"): URL-based con chips. La distinción del tipo de contenido es relevante para el admin (workflow distinto según target). Default `?type=all`; combina con `?tab=`.
- **Mantener paginación cursor-based**: la primitive existente (`{ items, nextCursor }`) funciona; sólo se re-estiliza el botón "Siguientes →" + visibilidad del "Anterior" si lo agregamos (opcional V1; ver § Open questions).
- **`router.refresh()` post-action**: mantener el patrón legacy. `reviewFlagAction` ya hace `revalidatePath` server-side, pero el browser actual queda con el RSC payload stale hasta que un trigger client-side disparase el re-fetch. `router.refresh()` es ese trigger. Sin esto, el item revisado seguiría visible como OPEN hasta que el user navegue manualmente.
- **Drop dots de navegación entre zonas dentro de settings**: ya fixed en commit `b821f43` (paso C). No es parte de este plan.

**Backend mostly disponible** (1 extensión menor):

- `listFlagsByPlace({ placeId, status, cursor, pageSize })` en `server/queries.ts:277` — keyset pagination con cursor `{ createdAt, id }`. **Extender**: sumar `targetType?: ContentTargetKind | 'all'` al param. Si `'all'` o undefined → sin filtro. Sino → `WHERE targetType = $param`. Cambio chico (~5 LOC + test).
- `listFlagTargetSnapshots(flags)` en `server/queries.ts` — batch query polimórfica (POST/COMMENT/EVENT) en una transacción. Sin cambios.
- `mapFlagToView(flag, snapshot)` en `flag-view-mapper.ts:104` — resuelve `contentStatus` (VISIBLE/HIDDEN/DELETED), trunca preview, resuelve `postSlug`. Sin cambios.
- `reviewFlagAction({ flagId, decision, sideEffect })` en `server/actions.ts:339` — concurrent-safe guard con `updateMany({ status: 'OPEN' })`. Sin cambios.

**Outcome esperado** post-3 sesiones:

- `/settings/flags` page flat con `<PageHeader>` + chip tabs (Pendientes / Resueltos) + filter chips de targetType (Todos / Posts / Comentarios / Eventos) + listado `<ul divide-y>` + paginación cursor-based.
- Click row → EditPanel con preview completo, reason, reporter, content status, link "Ver en contexto", footer con acciones de moderación.
- Kebab atajo en row: Ignorar (no-confirm) + Eliminar (destructive con confirm). Ocultar requiere preview del impacto → solo en detail panel.
- Resueltos: row sin kebab; detail panel muestra status + reviewedAt + reviewNote (read-only).
- Sub-slice `features/flags/admin/` con `public.ts` (mirror de members admin estructura).
- Drop `<FlagQueueItem>` legacy (238 LOC).
- Drop el TabLink inline en page.tsx (reemplazado por `<TabChip>` propio del sub-slice admin).
- Backend `listFlagsByPlace` extendida con `targetType?` param.

**LOC budget global**: archivos ≤300, funciones ≤60.

---

## Sesión 1 — Backend extension + sub-slice `features/flags/admin/` (orchestrator + detail + row + tabs + targetType filter)

**Goal**: extender backend con filtro targetType + crear el sub-slice con orchestrator, detail panel, row primitives y filter chips. Mirror estructural de `features/members/admin/`. NO se consume aún en page — eso queda para S2.

**Backend extension**:

- `src/features/flags/server/queries.ts:277` — extender `listFlagsByPlace` para aceptar `targetType?: ContentTargetKind | 'all'`. WHERE clause condicional. Si `undefined` o `'all'`, sin filtro.
- `src/features/flags/__tests__/queries.test.ts` — sumar 2 tests: filter por POST, filter por COMMENT.

**Files (sub-slice nuevo)**:

- `src/features/flags/admin/public.ts` (nuevo, ~18 LOC)
  - Barrel: exporta `FlagsAdminPanel`, `FlagDetailPanel`, `FlagRow`, `FlagsPagination`, `TabChip`, `TargetTypeFilter`.

- `src/features/flags/admin/ui/flags-admin-panel.tsx` (nuevo, ~250 LOC)
  - Client orchestrator. State machine: `'closed' | { kind: 'detail'; flagId: string }`. Simpler que members admin (sin invite ni sub-sheets de tiers/groups).
  - Props: `placeSlug`, `tab: 'pending' | 'resolved'`, `targetType: 'all' | 'POST' | 'COMMENT' | 'EVENT'`, `views: FlagView[]`, `nextHref: string | null`, `hrefs: { pendingTab, resolvedTab, typeFilters: Record<typeKey, string> }`, `viewerActorId`.
  - Renderiza tabs Pendientes/Resueltos + filter chips de targetType (Todos / Posts / Comentarios / Eventos) below tabs + listado `<ul divide-y>` con `<FlagRow>` por view. Empty state contextualizado según tab + filter.
  - Latch interno para detail panel (Radix Presence exit anim).
  - Sin invite/sub-sheets — el flag es read-only desde la UI admin (excepto las 3 acciones de review).
  - Post-action: `router.refresh()` para sincronizar listado (la action ya hace `revalidatePath`; el refresh dispara el re-fetch del RSC payload client-side).

- `src/features/flags/admin/ui/flag-detail-panel.tsx` (nuevo, ~280 LOC máx)
  - Read-only EditPanel + footer con 3 acciones de moderación.
  - Header: chip targetType (POST/COMMENT/EVENT) + chip reason + chip contentStatus.
  - Body sections:
    - **Reporte**: reason label + reasonNote (si presente) + reporter info (con fallback "ex-miembro" si `reporterUserId === null`) + createdAt (Intl).
    - **Contenido reportado**: title (si POST/EVENT), preview completo (no truncado al panel — el truncate de 160 chars del view aplica a la row, en el detail pintamos todo el preview disponible), link "Ver en contexto" → `targetHref`.
    - **Resolución** (solo si `status !== 'OPEN'`): reviewedAt + reviewNote (si presente) + decisión "con acción" / "sin acción".
  - Footer (solo si OPEN):
    - **Ignorar**: Dispara `reviewFlagAction({ decision: REVIEWED_DISMISSED, sideEffect: null })`. Sin confirm dialog (acción suave, reversible re-flagging).
    - **Ocultar** (solo POST, no DELETED ni HIDDEN): Dispara `reviewFlagAction({ decision: REVIEWED_ACTIONED, sideEffect: HIDE_TARGET })`. Con confirm dialog (afecta visibilidad).
    - **Eliminar** (POST | COMMENT, no DELETED): destructive con confirm dialog. Dispara `reviewFlagAction({ decision: REVIEWED_ACTIONED, sideEffect: DELETE_TARGET })`. Hard delete para POST, soft delete para COMMENT.
  - Cerrar post-action: el orchestrator cierra el panel + dispara `router.refresh()` para re-fetch del listado (la action ya hace `revalidatePath`, el refresh garantiza el repaint del page).
  - Latch interno con last non-null `view`.

- `src/features/flags/admin/ui/flag-row.tsx` (nuevo, ~140 LOC)
  - Row tappable: button principal (targetType chip + reason label + preview truncado + contentStatus chip + TimeAgo del createdAt) + kebab `<RowActions forceOverflow>` con [Ver en contexto (link out), Ignorar (no-confirm), Eliminar (destructive con confirm)] si OPEN; sin kebab si resolved.
  - Kebab fuera del button principal (sibling) para evitar tap propagation (patrón canónico `<TierCard>` / `<MemberRow>`).
  - Reason label resuelto inline (no necesita helper compartido — solo 5 valores enum).

- `src/features/flags/admin/ui/flags-pagination.tsx` (nuevo, ~50 LOC)
  - Cursor-based: prev `null` o href, next `null` o href. Mismo shape que `<MembersPagination>` pero sin pageSize derivable (cursor opaco).
  - Texto simple ("N reportes · Siguientes →"). Sin totalCount calculado (`listFlagsByPlace` no devuelve count hoy — sumar count requiere query extra; aceptable V1 sin count, los admins ven la lista misma).

- `src/features/flags/admin/ui/tab-chip.tsx` (nuevo, ~40 LOC)
  - Copy exacta del `<TabChip>` de `features/members/admin/`. Decisión deliberada de duplicar — extraer a `shared/ui/` queda para cuando emerja un 3er consumer (regla CLAUDE.md "evitar abstracciones prematuras"). Anotado como follow-up en el commit message.

- `src/features/flags/admin/ui/target-type-filter.tsx` (nuevo, ~70 LOC)
  - Filter chips horizontales: Todos / Posts / Comentarios / Eventos. Cada chip es un `<Link>` (URL-based, navegación client-side preservando `?tab=`). Active chip con `bg-neutral-900 text-white`; inactivos con border + hover. Reset de `?cursor=` al cambiar filtro (cursor del tab anterior no aplica al nuevo conjunto).

- `src/features/flags/admin/__tests__/flags-admin-panel.test.tsx` (nuevo, ~100 LOC)
  - Tests: render empty state según tab; render con views; click row dispara detail open.

- `src/features/flags/admin/__tests__/flag-detail-panel.test.tsx` (nuevo, ~120 LOC)
  - Tests: header con badges correctos; sección resolución sólo si `status !== 'OPEN'`; footer acciones según contentStatus + targetType (no "Ocultar" para COMMENT/EVENT; no "Eliminar" si DELETED).

**Verificación**:

- `pnpm typecheck` verde.
- `pnpm vitest run src/features/flags/admin` 100% verde.
- `pnpm lint` verde.

**LOC delta**: +850 (5 archivos UI ≈ 730 + 2 tests ≈ 220 + barrel 15 - tabchip dup minor).

**Riesgo deploy**: cero. Componentes no consumidos aún.

---

## Sesión 2 — Page integration + drop legacy

**Goal**: reescribir `/settings/flags/page.tsx` consumiendo el nuevo sub-slice. Drop `<FlagQueueItem>` import (el archivo queda en S3 cleanup).

**Files**:

- `src/app/[placeSlug]/settings/flags/page.tsx` (142 LOC → ~140 LOC)
  - Reescribir flat con `<PageHeader>` + `<FlagsAdminPanel>`.
  - `searchParams` parsing extendido: `tab`, `cursor`, **`type` (POST | COMMENT | EVENT | all)**. Default tab=pending, type=all.
  - Pasar `targetType` al call de `listFlagsByPlace` (la query extendida en S1 lo soporta).
  - Compute `nextHref` igual que hoy preservando `tab` + `type` en el URL.
  - Compute `hrefs = { pendingTab, resolvedTab, typeFilters: { all, POST, COMMENT, EVENT } }` precomputed (no funciones cross-boundary — lección del fix `023eff9`).
  - Drop `<TabLink>` interno (reemplazado por `<TabChip>` del sub-slice).
  - Drop import de `<FlagQueueItem>` + `mapFlagToView` import directo (mapper sigue siendo consumido server-side dentro del page para construir `FlagView[]`; import via `flags/public`).
  - Resolve `viewerActorId` via `getCurrentAuthUser()` (necesario para el detail panel — solo verifica auth, no permission gate adicional; el gate admin/owner ya está en `settings/layout.tsx`).

- `src/app/[placeSlug]/settings/flags/loading.tsx` (sin cambios)
  - El skeleton actual no necesita ajuste — sigue siendo válido para el nuevo layout (header + listado).

- `src/app/[placeSlug]/settings/flags/error.tsx` (sin cambios)

**Verificación**:

- `pnpm typecheck` verde.
- `pnpm vitest run` full suite verde (esperado 0 regresiones de los 2100 actuales).
- Boundaries test verde (`tests/boundaries.test.ts`).
- Smoke manual local: `/settings/flags` muestra listado nuevo, click row abre detail, acciones funcionan, paginación funciona.

**LOC delta**: -50 net (-92 page reescrita más compacta + 0 nuevos en page).

**Riesgo deploy**: medio — refactor central de la page. Mitigación: lit tests + smoke manual antes de push.

---

## Sesión 3 — Cleanup + docs

**Goal**: eliminar `<FlagQueueItem>` legacy + actualizar `docs/ux-patterns.md` con flags como cuarto consumer canónico.

**Files**:

- Drop `src/features/flags/ui/flag-queue-item.tsx` (238 LOC).
  - Verificar con grep que no hay otros callers (el único era `/settings/flags/page.tsx` que ya no lo importa post-S2).
- Update `src/features/flags/public.ts`: drop re-export de `FlagQueueItem`.
- Update tests: drop tests de `<FlagQueueItem>` si existen (audit: ninguno en `__tests__/` actualmente — el slice tiene tests de queries, actions, mapper, modal pero no del queue item específicamente).
- Update `docs/ux-patterns.md`:
  - § "Detail-from-list pattern" (línea 432, list de reference implementations): sumar `features/flags/admin/` como cuarto consumer canónico.
  - Si existe sección dedicada a `/settings/flags` con propuesta antigua, reescribir con la implementación final (audit: no existe sección dedicada hoy — sumar nota breve en § "Per-feature application matrix" si aplica).

**Verificación**:

- `grep -rn "FlagQueueItem" src/` post-cleanup: 0 hits en código vivo (solo docs/tests).
- `pnpm typecheck` + `pnpm vitest run` + `pnpm lint` verde.

**LOC delta**: -240 (drop legacy) + 30 (docs) = -210 net.

**Riesgo deploy**: bajo (solo limpieza + docs).

---

## Resumen total

| Sesión    | LOC delta    | Files tocados                                 | Riesgo deploy |
| --------- | ------------ | --------------------------------------------- | ------------- |
| 1         | +940         | 9 (admin sub-slice nuevo + query ext + tests) | Cero          |
| 2         | -50 net      | 1 (page reescrita)                            | Medio         |
| 3         | -210 net     | 3 (drop legacy + docs)                        | Bajo          |
| **Total** | **+680 net** | **~13**                                       | —             |

## Cumplimiento CLAUDE.md / ux-patterns.md

- **LOC caps**: cada archivo ≤300, funciones ≤60. Orchestrator ≤220 (más simple que members admin porque sin invite/sub-sheets).
- **Vertical slices**: nuevo sub-slice `features/flags/admin/` con su `public.ts`. Cross-slice imports vía public (members admin como reference, no consume sus internals).
- **TDD**: tests primero en S1 (orchestrator + detail panel).
- **Streaming agresivo del shell**: page `/settings/flags` aplica gate top-level (loadPlaceBySlug + redirect), cargas de data quedan dentro del page render (queries paralelas `listFlagsByPlace` + `listFlagTargetSnapshots`).
- **Mobile-first padding canónico**: `space-y-6 px-3 py-6 md:px-4 md:py-8`.
- **Color palette neutrals**: raw Tailwind, no CSS vars de brand.
- **`<RowActions>` destructive auto-confirm**: Eliminar usa el confirm dialog automático del primitive.
- **Permission gating server-side**: `reviewFlagAction` ya tiene el gate (revisar ownership + concurrent guard). Sin cambios.
- **Privacy**: `reporterUserId === null` post-erasure 365d → UI muestra "ex-miembro". Mismo patrón que en members admin con bloqueos.
- **Idioma**: docs/comentarios español, código inglés.
- **Sub-sesiones cortas y focalizadas**: 3 sub-sesiones, cada una commiteable separada.

## Decisiones cerradas (user 2026-05-14)

1. ✅ **Páginación "Anterior" NO V1**. Cursor-based no soporta prev-cursor sin extender backend; sumar si emerge necesidad.
2. ✅ **SÍ filtro por `targetType`** (POST / COMMENT / EVENT + Todos). URL `?type=`. Sumado al plan en S1 (query extension) + S1 UI (`<TargetTypeFilter>` chips).
3. ✅ **Bulk actions NO V1**.
4. ✅ **`<TabChip>` duplicado** inicialmente; extraer a `shared/ui/` cuando emerja 3er consumer.
5. ✅ **`router.refresh()` post-action mantener**. Patrón canónico Next 15 + Server Actions; sin esto el listado quedaría stale en pantalla hasta navegación manual.

## Critical files reference

- `src/app/[placeSlug]/settings/flags/page.tsx:142 LOC` — page a reescribir (S2).
- `src/features/flags/ui/flag-queue-item.tsx:238 LOC` — legacy a dropear (S3).
- `src/features/flags/server/queries.ts:277 LOC` — `listFlagsByPlace`, `listFlagTargetSnapshots` (sin cambios).
- `src/features/flags/server/actions.ts:339 LOC` — `reviewFlagAction` (sin cambios).
- `src/features/flags/server/flag-view-mapper.ts:104 LOC` — `mapFlagToView` (sin cambios).
- `src/features/flags/domain/types.ts:121 LOC` — `FlagView` shape (referencia para el detail panel).
- `src/features/members/admin/ui/members-admin-panel.tsx:364 LOC` — referencia canónica del orchestrator.
- `src/features/members/admin/ui/member-detail-panel.tsx:302 LOC` — referencia del detail panel.
- `src/features/members/admin/ui/tab-chip.tsx:39 LOC` — referencia para `<TabChip>` (a duplicar inicialmente).
- `src/shared/ui/edit-panel.tsx` — primitive del panel responsive.
- `src/shared/ui/row-actions.tsx:309 LOC` — primitive con `forceOverflow` + destructive auto-confirm.
