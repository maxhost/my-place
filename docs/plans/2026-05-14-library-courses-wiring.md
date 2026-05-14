# Plan — Wiring del feature "Library Courses" (5 sub-fases)

## Context

El feature **Library Courses** (categorías tipo curso con lecciones encadenadas por prereqs) tiene **dominio + UI primitives + server actions construidos** desde la sesión 2026-05-04 (ADR `library-courses-and-read-access`), pero el **wiring final con las pages** quedó incompleto.

**Estado actual** (verificado por audit 2026-05-14):

| Capa                                                       | Componente                                                                                                                             | Estado |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Schema Prisma                                              | `LibraryCategory.kind`, `LibraryItem.prereqItemId`, tabla `LibraryItemCompletion`                                                      | ✅     |
| Domain                                                     | Types + `canMarkItemCompleted` + `canOpenItem` + `validateNoCycle`                                                                     | ✅     |
| Server actions                                             | `setItemPrereqAction`, `markItemCompletedAction`, `unmarkItemCompletedAction`                                                          | ✅     |
| Server queries                                             | `listCompletedItemIdsByUser`                                                                                                           | ✅     |
| UI primitives                                              | `<PrereqSelector>`, `<MarkCompleteButton>`, `<PrereqLockBadge>`, `<LibraryItemLockedRow>`, `<CourseItemList>` (post cleanup `5ea630b`) | ✅     |
| Wizard category                                            | Permite seleccionar `kind: GENERAL \| COURSE` (paso 4)                                                                                 | ✅     |
| Form de item con `<PrereqSelector>`                        | ❌ NO cableado                                                                                                                         |
| Detail page con `<MarkCompleteButton>`                     | ❌ NO cableado                                                                                                                         |
| Detail page chequea `canOpenItem`                          | ❌ NO cableado                                                                                                                         |
| Page categoría usa `<CourseItemList>` cuando `kind=COURSE` | ❌ Usa siempre `<ItemList>` plana                                                                                                      |
| Query "lookup de items para prereq selector"               | ❌ Falta query batch                                                                                                                   |

**ADR canónico**: `docs/decisions/2026-05-04-library-courses-and-read-access.md` (D1-D12).
**Plan original** (parcialmente ejecutado): `docs/plans/2026-05-04-library-courses-and-read-access.md` (G.2+3.b → wiring NO completado).

**Outcome esperado** post-5 sub-fases: el feature courses funcional end-to-end. El admin puede crear categorías-curso, los authors seleccionan prereq al publicar lecciones, los viewers marcan completion y desbloquean lecciones secuencialmente.

**LOC budget global**: archivos ≤300, funciones ≤60, sub-slice courses ≤800.

---

## Sub-fase W1 — Backend: query batch de items para prereq lookup

**Goal**: query reusable que devuelve los items de una categoría (id + title + slug) para alimentar tanto `<PrereqSelector>` (lista de candidates al crear/editar item) como `<CourseItemList>` (lookup para resolver prereqs en el page de categoría).

**Files**:

- `src/features/library/courses/server/queries.ts` (extender, ~50 LOC nuevos)
  - Sumar `listCategoryItemsForPrereqLookup(categoryId, placeId): Promise<Array<{ id, title, postSlug, prereqItemId }>>`. Devuelve items NO archivados de la categoría, ordenados por `createdAt asc`. Sin paginación (cap real es ~50 items por categoría según UX de courses).
  - Devuelve `prereqItemId` también para que la UI pueda detectar ciclos optimistically.
- `src/features/library/courses/public.server.ts` — sumar export.
- `src/features/library/courses/__tests__/queries.test.ts` — sumar 3 tests nuevos: items vacíos, orden por createdAt, filtro por archivedAt nulo.

**Verificación**:

- `pnpm vitest run src/features/library/courses` — verde.
- `pnpm typecheck` — verde.

**LOC delta**: +80 (50 query + 30 tests).

**Riesgo deploy**: cero (query nueva sin callers todavía).

---

## Sub-fase W2 — Form de item: PrereqSelector cableado

**Goal**: cuando la categoría es `kind === 'COURSE'`, el form de crear/editar item muestra el `<PrereqSelector>` con la lista de items de la misma categoría. Submit dispara `setItemPrereqAction` post create/update.

**Files**:

- `src/features/discussions/ui/library-item-composer-form.tsx` (267 LOC actuales → ~310 LOC)
  - Sumar props opcionales: `categoryKind: 'GENERAL' | 'COURSE'`, `prereqOptions: ReadonlyArray<{ id, title, postSlug, prereqItemId }>`, `initialPrereqItemId: string | null` (solo edit).
  - Estado nuevo: `prereqItemId: string | null` (default `initialPrereqItemId ?? null`).
  - Render condicional: si `categoryKind === 'COURSE'` y `prereqOptions.length > 0`, montar `<PrereqSelector>` debajo del campo título (preservar layout). Si no hay options (categoría vacía), no mostrar.
  - Submit:
    - Create: `onCreate(...)` igual que hoy. Después de OK, si `prereqItemId !== null`, llamar `setItemPrereqAction({ itemId: res.itemId, prereqItemId })`. Toast por separado si falla solo el prereq (item creado OK).
    - Edit: `onUpdate(...)` igual. Si `prereqItemId !== initialPrereqItemId`, llamar `setItemPrereqAction`. Toast separado.
  - **Importante**: extender el contract de `onCreate` para que devuelva `itemId` además del `postSlug` actual. Verificar `createLibraryItemAction` ya lo devuelve; si no, extender la action (cambio chico).

- `src/app/[placeSlug]/(gated)/library/[categorySlug]/new/page.tsx`
  - Cargar `prereqOptions` via `listCategoryItemsForPrereqLookup(category.id, place.id)` SOLO si `category.kind === 'COURSE'`.
  - Pasar `categoryKind={category.kind}`, `prereqOptions={...}`, `initialPrereqItemId={null}` al composer.

- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/edit/page.tsx`
  - Mismo patrón: cargar `prereqOptions` si COURSE.
  - Filtrar el item actual de las opciones (un item no puede ser su propio prereq).
  - Pasar `initialPrereqItemId={item.prereqItemId}`.

- `src/features/library/courses/__tests__/prereq-selector-integration.test.tsx` (nuevo, ~120 LOC)
  - Tests del composer con `categoryKind='COURSE'`: renderea selector, submit dispara setItemPrereqAction, error en setItemPrereqAction muestra toast separado.

**Verificación**:

- `pnpm typecheck` + `pnpm vitest` verde.
- Smoke manual local: crear categoría con `kind: COURSE` (vía wizard de category), publicar 2 items en ella, segundo item permite seleccionar el primero como prereq.

**LOC delta**: +90 net (composer +45, pages +25, tests +120, props nuevas).

**Riesgo deploy**: medio — toca composer central. Mitigación: props NUEVAS opcionales, GENERAL categories no rompen.

---

## Sub-fase W3 — Detail page del item: MarkCompleteButton + canOpenItem gate

**Goal**: cuando la categoría es COURSE y el viewer puede leer el item (`canReadItem` ya gateado), si el prereq NO está completado, mostrar la versión "locked" del contenido (header + cover + lock view en lugar del body). Si SÍ está completado o no hay prereq, mostrar `<MarkCompleteButton>` debajo del body.

**Files**:

- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/page.tsx`
  - Extender carga: si `category.kind === 'COURSE'` y `item.prereqItemId`, cargar `listCompletedItemIdsByUser(viewer.userId, place.id)` y verificar `item.prereqItemId in completedIds`.
  - Si bloqueado (no completado + no es owner): renderear inline view "Necesitás completar X primero" con link al prereq item. NO bloquear el page entero — el viewer ve título + cover pero NO el body. Toast adicional opcional.
  - Si desbloqueado: render normal del body + `<MarkCompleteButton itemId={item.id} completed={isCompleted} />` debajo del body (solo si `category.kind === 'COURSE'`).
  - El `<MarkCompleteButton>` ya maneja markItemCompletedAction + unmarkItemCompletedAction internamente.

- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/_library-item-content.tsx` o crear `_locked-item-view.tsx`
  - Componente nuevo `<LockedItemView>` (~50 LOC) que se monta cuando bloqueado por prereq. Card calmo: heading "Lección bloqueada", copy "Completá [prereq.title] para desbloquearla" + button link a `/library/{categorySlug}/{prereq.postSlug}`.

- Tests:
  - `src/features/library/courses/__tests__/mark-complete-integration.test.tsx` (nuevo, ~100 LOC) — test del flow completo: viewer no completó prereq → ve LockedItemView. Viewer completó prereq → ve body + MarkCompleteButton.

**Verificación**:

- typecheck + vitest verde.
- Smoke manual: viewer abre lección 2 sin completar lección 1 → ve LockedItemView. Marca lección 1 como completed → vuelve a lección 2 → ahora ve body completo + button.

**LOC delta**: +150 net (page +50, locked view +50, button wiring inline, tests +100).

**Riesgo deploy**: bajo — solo afecta categorías COURSE, GENERAL sigue igual.

---

## Sub-fase W4 — Page categoría: usar CourseItemList cuando kind=COURSE

**Goal**: el listado de items de una categoría detecta `kind === 'COURSE'` y renderea `<CourseItemList>` con `completedItemIds` + `itemsLookup` precargados. La versión "tonta" `<ItemList>` queda para categorías GENERAL.

**Files**:

- `src/app/[placeSlug]/(gated)/library/[categorySlug]/page.tsx`
  - Si `category.kind === 'COURSE'`:
    - Cargar `listCompletedItemIdsByUser(viewer.userId, place.id)` en paralelo con items.
    - Construir `itemsLookup: Map<id, { title, categorySlug, postSlug }>` desde el listado de items.
    - Renderear `<CourseItemList items={items} completedItemIds={completedIds} itemsLookup={itemsLookup} viewerIsOwner={viewer.isOwner} />`.
  - Si `kind === 'GENERAL'` (o undefined): renderear `<ItemList items={items} />` igual que hoy.

- `src/features/library/courses/ui/library-item-locked-row.tsx`
  - Verificar que el toast "Completá X primero" ya esté implementado (audit del componente actual). Si no, sumarlo: click en row bloqueado dispara `toast.info('Completá [prereq.title] antes de abrir esto', { action: { label: 'Ir a [X]', onClick: () => router.push(...) } })`.
  - Si el componente ya lo hace, solo verificar.

- Tests:
  - `src/features/library/courses/__tests__/course-item-list.test.tsx` (renombrar el test legacy si quedó algo, o crear nuevo). 4 cases: items vacíos, items sin prereqs (todos abiertos), items con prereqs incompletos (lock), viewerIsOwner bypass.

**Verificación**:

- typecheck + vitest verde.
- Smoke manual: categoría COURSE con cadena A → B → C. Viewer ve A abierto + B/C con candado. Click en B → toast "Completá A primero" con CTA. Marca A → B se desbloquea visualmente al refrescar.

**LOC delta**: +130 net (page +60, locked-row check +20, tests +100).

**Riesgo deploy**: bajo — categorías GENERAL siguen con `<ItemList>` plano, COURSE upgrade visible.

---

## Sub-fase W5 — E2E + smoke checklist + spec update + cleanup

**Goal**: cerrar el feature con E2E + spec actualizada + manual smoke documentado.

**Files**:

- `tests/fixtures/e2e-data.ts`
  - Sumar 1 categoría `kind: COURSE` con cadena A → B → C (3 items con prereqItemId encadenado). Para tests E2E manuales y futuros automatizados.
- `tests/fixtures/e2e-seed.ts`
  - Persistir la nueva categoría + items + prereqs.
- `tests/e2e/flows/library-courses.spec.ts` (nuevo, ~150 LOC opcional)
  - E2E test del flow completo: owner crea curso → author publica lecciones → viewer ve locks → completa secuencialmente → todas se desbloquean.
- `docs/features/library/spec.md`
  - Sumar sección dedicada § 14 "Cursos" con tabla resumen del flow + matriz de permisos (canOpen, canMarkComplete) + ejemplos.
  - Actualizar el comentario del schema Prisma para reflejar que LibraryItemCompletion + prereqItemId YA están wireados (no "pendiente de cablear").
- `docs/decisions/2026-05-04-library-courses-and-read-access.md`
  - Sumar nota al final: "**Wiring completado** 2026-05-14 en plan `2026-05-14-library-courses-wiring.md`."

**Manual smoke checklist** (obligatorio antes de close):

- [ ] Owner crea categoría kind=GENERAL → publica 2 items → ambos abiertos sin prereq selector.
- [ ] Owner crea categoría kind=COURSE → publica item A (sin prereq) + item B (prereq=A) + item C (prereq=B).
- [ ] Author que NO es owner publica item D en la categoría COURSE — ve PrereqSelector con A, B, C como opciones.
- [ ] Viewer NO completó nada → ve A abierto, B/C con candado.
- [ ] Viewer click en B locked → toast "Completá A primero" con CTA "Ir a A".
- [ ] Viewer abre A → ve body + button "Marcar como completado". Click → toast success.
- [ ] Viewer vuelve al listado de la categoría → A muestra check, B desbloqueado, C aún locked.
- [ ] Viewer abre B → marca completed → C desbloquea.
- [ ] Owner abre B sin completar A → ve body completo (bypass viewerIsOwner).
- [ ] Owner abre item con prereq desde detail directo (URL) → ve LockedItemView (no es bypass de detail page, solo de listing).

**Verificación**:

- `pnpm typecheck` + `pnpm vitest run` + `pnpm lint` verde.
- E2E pass (si se sumó test).

**LOC delta**: +200 (spec sumas + seed + E2E opcional).

**Riesgo deploy**: cero (solo docs + fixtures + test E2E).

---

## Resumen total

| Sub-fase  | LOC delta       | Files tocados                           | Riesgo deploy |
| --------- | --------------- | --------------------------------------- | ------------- |
| W1        | +80             | 3 (query + public.server + tests)       | Cero          |
| W2        | +290 net        | 4 (composer + 2 pages + tests)          | Medio         |
| W3        | +250 net        | 3 (page + locked-view + tests)          | Bajo          |
| W4        | +180 net        | 3 (page + locked-row check + tests)     | Bajo          |
| W5        | +200            | 5 (spec + ADR + seed + E2E + checklist) | Cero          |
| **Total** | **~+1,000 net** | **~18**                                 | —             |

## Cumplimiento CLAUDE.md / architecture.md

- **LOC caps**: cada archivo nuevo ≤300, funciones ≤60. `library-item-composer-form.tsx` post-W2 ≤310 — si supera 300, extraer la lógica del `<PrereqSelector>` integration a un sub-component (`composer-prereq-section.tsx`).
- **Vertical slices**: el feature courses vive en `library/courses/` sub-slice. Nuevas queries en `courses/server/queries.ts`, nuevas integrations en pages consumen via `library/courses/public` y `library/courses/public.server`.
- **TDD**: tests primero en W1 (query), W2/W3/W4 (integration tests del wiring).
- **Streaming agresivo del shell** (architecture.md): pages mantienen gate top-level + Suspense para data. La detección de `kind === 'COURSE'` se hace después del gate.
- **Mobile-first padding canónico**: pages mantienen el patrón actual (gated zone usa `px-3 py-6`, no settings padding).
- **Color palette**: `<MarkCompleteButton>` y `<LockedItemView>` usan brand vars (`var(--accent)`, `var(--text)`) — son gated zone, NO settings, así que pueden usar la palette del place.
- **Sin gamificación** (CLAUDE.md): completion es PRIVADO por viewer, sin contadores públicos, sin %, sin streaks. Solo el viewer ve sus propios items completados (canónico ya en `listCompletedItemIdsByUser`).
- **Sin métricas vanidosas**: no mostrar "X de Y lecciones completadas" como counter público. Solo lock visual + bypass cuando completado.
- **Idioma**: docs/comentarios español, código inglés.

## Decisiones implícitas (ya cerradas en ADR 2026-05-04)

- D1: course = container-with-flag (`kind: 'GENERAL' | 'COURSE'`).
- D2: sequential unlock visible-pero-locked (no ocultar).
- D3: manual `Mark Complete` (no auto-detect).
- D4: single `prereqItemId`, no DAG.
- D5: tabla `LibraryItemCompletion` aparte (privacy by design).
- D11: distinción visual entre access denied (paywall view) vs prereq locked (LockedItemView).

NO hay decisiones nuevas pendientes — el wiring solo cablea lo decidido.

## Critical files reference

- `src/features/library/courses/server/queries.ts:26` — `listCompletedItemIdsByUser` existente.
- `src/features/library/courses/server/actions/{mark-item-completed,unmark-item-completed,set-item-prereq}.ts` — actions existentes.
- `src/features/library/courses/ui/{prereq-selector,mark-complete-button,prereq-lock-badge,library-item-locked-row,course-item-list}.tsx` — UI primitives (post cleanup `5ea630b`).
- `src/features/discussions/ui/library-item-composer-form.tsx` — form a extender con PrereqSelector (W2).
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/page.tsx` — page categoría a wirear (W4).
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/[itemSlug]/page.tsx` — page detail item a wirear (W3).
- `src/app/[placeSlug]/(gated)/library/[categorySlug]/{new,[itemSlug]/edit}/page.tsx` — pages form a extender (W2).
- `docs/decisions/2026-05-04-library-courses-and-read-access.md` — ADR canónico del feature.
- `docs/features/library/spec.md` — spec a actualizar con sección dedicada (W5).
