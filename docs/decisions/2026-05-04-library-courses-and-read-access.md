# Library: courses (prereqs + completion) + read access scopes + wizard UI + emoji picker

**Fecha:** 2026-05-04
**Slice:** `library` (con sub-slices nuevos `library/courses/` + `library/access/`)
**Status:** Decidido. Implementación dividida en G.1–G.7 (ver `docs/plans/2026-05-04-library-courses-and-read-access.md`).
**Autor:** Max

## Contexto

El slice `library` se extiende con cuatro features que el cleanup de F.5 dejó pendientes y que ahora se implementan juntos para evitar idas y vueltas:

1. **Acceso de lectura gateado**: hoy todos los miembros activos ven todo el contenido de la library. Queremos que el owner pueda restringir lectura por `PermissionGroup`, `Tier`, o `User` específico. Las categorías siguen visibles para todos en el listing — el gating ocurre al **abrir un item**.
2. **Categorías tipo "curso"**: una categoría puede declararse como curso. Los items dentro pueden declarar prereqs (item B requiere completar item A antes de abrirse).
3. **Completion tracking privado** por usuario para items en categorías-curso. Sin métricas públicas, sin badges, sin %, sin streaks (alineado con CLAUDE.md "sin gamificación").
4. **Wizard multi-step** para crear/editar categoría (4 pasos: identidad → acceso de aportación → acceso de lectura → tipo curso/general). El form lineal actual no escala con tantos campos.
5. **Emoji picker** real (no input texto libre).

## Decisiones

### D1 — Course = container-with-flag dentro de library, NO zona aparte

`LibraryCategory.kind: 'GENERAL' | 'COURSE'` enum. Los courses comparten la tabla `LibraryCategory` y `LibraryItem` con las categorías generales — sólo cambian semántica (items pueden tener prereqs) y UI (lock icon + Mark Complete).

**Por qué**: Skool, Circle y Mighty Networks (3 fuentes independientes) confirman que en community apps los courses se modelan como **discriminator sobre el container genérico**, no como entidad separada. Place no es LMS-first. El usuario rechazó explícitamente fragmentar en zona "Educación" porque "fragmenta más los contenidos publicados".

### D2 — Sequential unlock: visible-pero-locked

Lessons con prereq incompleto se muestran en el listing con candado + tooltip "Completá [X] primero". NO se ocultan. Si el viewer intenta abrir el item directamente vía URL, la action de detalle dispara un toast Sonner con el motivo + link al prereq.

**Por qué**: consenso de industria (Tutor LMS, Canvas, LearnDash, MasterStudy). Ocultar es anti-UX — pierde el "itinerary map". El toast (decisión C5) reemplaza un componente full-page tipo `<ItemBlockedView>` porque ya tenemos Sonner mounted globalmente.

### D3 — Manual `Mark Complete` button

El usuario marca completion explícitamente. Sin auto-detect por scroll/tiempo/quiz. Mighty Networks y Skool usan este patrón.

**Por qué**: auto-detect produce false positives (Brightspace's "marked complete on view" es la crítica clásica). Manual es honest, simple, sin heurísticas que mantener.

### D4 — Prereqs: single `LibraryItem.prereqItemId: string | null`, NO tabla DAG en v1

Cada item declara como mucho UN prereq directo. La cadena se forma transitivamente (item C declara B como prereq, B declara A → para abrir C hay que completar B y A).

**Por qué**: cubre 95% de casos en community apps. Tutor LMS, MasterStudy, Skool usan implícito-por-orden — Place ya es más sofisticado con prereq explícito. Si en el futuro aparece la necesidad real de múltiples prereqs por item (DAG), se evoluciona a tabla `LibraryItemPrerequisite` sin migración destructiva (los datos actuales se mantienen, sumamos rows).

**Validación de ciclos**: cuando el owner asigna prereq, se chequea que el item target no apunte de vuelta al item origin (directo o transitivo). Validación app-layer con BFS, max depth 50 (defensiva). No constraint SQL nativa.

### D5 — Tabla `LibraryItemCompletion` aparte (no boolean en LibraryItem)

```prisma
model LibraryItemCompletion {
  itemId      String
  userId      String
  completedAt DateTime @default(now())
  @@id([itemId, userId])
  @@index([userId])
}
```

**Por qué**: protege estructuralmente el invariante "completion es privado". Ninguna query de listing público de items toca `LibraryItemCompletion` — sólo el viewer del propio user. Más seguro que un campo en `LibraryItem` que podría leak vía select wildcard.

### D6 — Read access scopes: 3 tablas separadas (NO tabla única polimórfica)

```prisma
model LibraryCategoryGroupReadScope {
  categoryId String
  groupId    String
  @@id([categoryId, groupId])
}

model LibraryCategoryTierReadScope {
  categoryId String
  tierId     String
  @@id([categoryId, tierId])
}

model LibraryCategoryUserReadScope {
  categoryId String
  userId     String
  @@id([categoryId, userId])
}
```

**Por qué**: consistente con `GroupCategoryScope` (write side, ya existente). FKs simples, sin polimorfismo. RLS futura clara por tabla. GitLab docs explícito: "always use separate tables instead of polymorphic associations". Queries `canReadCategory()` hacen UNION de las 3 — manejable porque el N de scopes por categoría es chico (típico < 20 entries combinados).

**Discriminator** del tipo de scope: el owner elige UNO de los 4 (`PUBLIC | GROUPS | TIERS | USERS`) en el wizard. PUBLIC = sin rows en ninguna tabla. Los otros 3 = rows en su tabla correspondiente. El discriminator vive en una nueva columna `LibraryCategory.readAccessKind: 'PUBLIC' | 'GROUPS' | 'TIERS' | 'USERS'` (default PUBLIC, alineado con principio "calmo y abierto").

### D7 — `LibraryViewer` agrega `tierIds`

Hoy: `{ userId, isAdmin, groupIds }`. Después: `{ userId, isAdmin, groupIds, tierIds }`. Necesario para `canReadCategory()` cuando `readAccessKind === 'TIERS'`.

**Cómo se popula**: `tierIds` viene de `prisma.tierMembership.findMany({ where: { userId, placeId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } })`. Cacheable con `React.cache` en mismo request — el caller (`resolveActorForLibrary`) ya lo está.

### D8 — Wizard multi-step: 4 pasos lineales forzados

Pasos:

1. **Identidad** — emoji (picker) + nombre.
2. **Acceso de aportación** — DESIGNATED / MEMBERS_OPEN / SELECTED_GROUPS (lo que ya tenemos en F.1-F.5). Selector inline cuando aplica.
3. **Acceso de lectura** — discriminator único (PUBLIC / GROUPS / TIERS / USERS) + sub-picker condicional cuando ≠ PUBLIC.
4. **Tipo de categoría** — toggle GENERAL / COURSE (sólo flag, sin config adicional en v1).

**Navegación**: lineal forzado (sin saltos). X cierra el sheet y se pierde el progreso. Sin botón "Cancelar" — la X cumple esa función. Validación **por step** (no avanzás al siguiente sin completar el actual). Botón "Siguiente" en steps 1-3, "Guardar" en step 4. "Atrás" preservado entre steps (mientras el sheet está abierto).

**Por qué C5 confirma X = Cancel**: el patrón ya está en `BottomSheet` canónico. Sin doble affordance que confunde.

### D9 — Sub-split del slice library en 2 sub-slices internos

`library` se divide en 3 carpetas, cada una con su propio `public.ts` + `public.server.ts`:

- **`src/features/library/`** (slice raíz): contiene lo que ya hay (categorías, items, contributors, group scope de write, listing UIs). Reduce ~1500 LOC vs estado actual al mover courses + access fuera.
- **`src/features/library/access/`** (sub-slice nuevo): read access scopes (3 tablas + queries + actions + `canReadCategory`/`canReadItem` permission helpers + UI del step 3 del wizard).
- **`src/features/library/courses/`** (sub-slice nuevo): course flag + prereqs + completion (table + queries + actions + `canMarkCompleted` + lock UI + Mark Complete button + UI del step 4 del wizard).

**Por qué C1**: el usuario eligió esta opción explícitamente — "no se trata de la complejidad, se trata de tener archivos con los que puedas trabajar y mientras más grande es, más complicado es trabajar en una feature dentro de la ventana de contexto." Un slice library de 12k+ LOC es inmanejable para humanos y agentes; sub-split mantiene cada sub-slice bajo el cap original (1500 LOC) sin necesitar ADR de excepción.

**Boundary**: cada sub-slice respeta la regla "imports cross-slice sólo via public.ts". El sub-slice `library/courses/` puede importar de `library/public.ts` (acceso a tipos `LibraryCategory`, `LibraryItem`) pero no a internals. El boundary test (`tests/boundaries.test.ts`) ya acepta `public.ts` y `public.server.ts` — debe extenderse para validar también la regla en sub-paths (probablemente `src/features/*/*/public.ts` además de `src/features/*/public.ts`).

**Aliases TS**: el `tsconfig.json` debe permitir imports tipo `@/features/library/courses/public`. Verificable — el alias `@` apunta a `src/`, así que el path natural ya funciona.

### D10 — Emoji picker: `frimousse` (Liveblocks) con `locale="es"`

Headless, 0 deps runtime, peer `react ^19`, virtualizado nativo, data lazy desde CDN Emojibase (no engorda el bundle inicial). Search en español built-in.

**Configuración**:

- Native unicode glyphs (sin Twemoji images — alineado con "nada parpadea").
- Skin tones OFF (no aplica para emoji de categoría — institucional).
- Recents OFF (categoría es elección aspiracional, no repetitiva — anti-Place mostrar lo que otros eligieron).
- Default category al abrir: "Smileys & People" (estándar Notion).

**Integración con BottomSheet del wizard**: en mobile (<768px) el picker **reemplaza el contenido del sheet** (push interno con header "← Volver"). En desktop (≥768px) abre como Radix Popover anclado al botón. Patrón Notion iOS — el nested sheet (sheet sobre sheet) está descartado por focus trap doble + gestures ambiguos.

**Ubicación**: `src/shared/ui/emoji-picker/` (genérico — puede reusarse en otros lugares: settings del place, reactions futuras, etc.).

### D11 — UI de "lock por prereq incompleto" = Sonner toast (no view dedicado)

Cuando el viewer intenta abrir un item con prereq sin completar:

- En el listing: el item se muestra con candado + tooltip estático "Completá [X] primero".
- Al click/tap: la action de navegación dispara `toast.info('Completá [X] antes de abrir esto', { action: { label: 'Ir a [X]', onClick: () => router.push(...) } })`. NO redirect server-side, NO error page.
- Lo mismo si llegan vía URL directa: page sirve el detalle del item (porque el contenido SÍ es leíble — no es paywall, es prereq), pero muestra un banner inline + el toast es disparado por el componente que detecta el state.

**Por qué C5**: Sonner ya está mounted globalmente (`src/app/layout.tsx`). Patrón canónico de feedback en Place (autosave hours, library actions, etc.). Construir un `<ItemBlockedView>` full page es más componente del que la situación amerita.

**Distinción importante**: prereq incompleto ≠ read access denied. Read access es paywall verdadero (categoría privada, no soy del grupo/tier/user permitido) → ahí SÍ se muestra view dedicado tipo `<UserBlockedView>` análogo (pendiente de evaluar en G.2). Prereq es "podés ver, pero antes hacé esto".

### D12 — Validación por step + botón "Siguiente" disabled si step inválido

Cada step tiene su propio Zod schema validado on-blur o on-change. "Siguiente" disabled hasta que el step parsea OK. Errors inline por field en el step actual. El usuario no puede avanzar sin completar el step.

**Por qué C2**: errors localizados al step donde aparecen. Mobile-friendly. Reduce "submit final con muchos errors a la vez" que es frustrante.

## Riesgos

| Riesgo                                                                                       | Mitigación                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sub-split rompe imports existentes                                                           | G.1 incluye refactor mecánico de imports + correr boundary test + grep de `from '@/features/library/server/...'` en otros slices. Si hay hits, vienen de tests E2E que sí pueden importar internals (decisión histórica).                                                             |
| Validación de ciclos en prereqs es app-layer (no SQL)                                        | BFS con max depth 50 + test unit que cubre ciclo A→B→A, A→B→C→A, y autoreferencia A→A. Owner-only action (no se llama desde paths concurrent — race no es problema realista).                                                                                                         |
| Read access query (UNION 3 tablas) escala mal con N alto                                     | Place max 150 miembros, scopes típicos < 20 entries por categoría. Index `(categoryId)` en cada tabla es suficiente. Queries cacheables con `React.cache` por request.                                                                                                                |
| Wizard mobile: persistencia entre steps si el usuario rota el device, recarga, etc.          | State vive en `useState` del orquestador del wizard. NO persistimos a server entre steps — el commit final es atomic (crear/editar categoría + opcional set scope + opcional set readscope). Si el usuario cierra el sheet, pierde progreso (decisión explícita C5). Sin draft state. |
| Emoji picker en push interno del BottomSheet rompe focus trap                                | El picker es un sub-componente que se renderiza dentro del BottomSheetContent (no nested sheet). El focus trap del sheet original se mantiene; el picker tiene su propio focus management interno (Frimousse lo provee). Test manual obligatorio en iOS Safari.                       |
| `LibraryViewer.tierIds` requiere extender `resolveActorForPlace` cross-slice                 | Cambio aditivo (campo nuevo opcional al principio, required cuando todos los callers lo populan). G.1 lo agrega como opcional, G.2 lo populva, G.3 lo hace required. Mismo patrón que `groupIds` en F.1.                                                                              |
| Sub-slices `library/courses/` y `library/access/` pueden necesitar tipos del padre `library` | Cross-import via `@/features/library/public` desde el child. Boundary test debe permitir esto explícitamente — agregar regla "child puede importar parent public.ts pero no internals".                                                                                               |
| RLS deferida (consistente con sesión 2026-05-04) — todos los chequeos viven app-layer        | Documentado. Cuando llegue la fase RLS general, será una sola migration que agregue policies coherentes para library + courses + access.                                                                                                                                              |

## Rollback strategy

- D6 (read access tablas): aditivo. Drop tablas + drop columna `readAccessKind` revierte sin pérdida de data (no hay data productiva todavía).
- D5 (completion): aditivo. Drop tabla revierte sin pérdida.
- D4 (prereqItemId): aditivo. Drop columna revierte (sólo en pre-prod).
- D1/D2 (course flag): aditivo. Set todos los `kind` a `GENERAL` y drop columna revierte.
- D9 (sub-split): refactor reversible — si causa fricción, mover archivos de vuelta a `library/` raíz. Cero impacto data.

## Cuándo revisar

- Si aparecen casos reales de items con múltiples prereqs simultáneos → migrar D4 single-id a tabla DAG.
- Si la UX del wizard 4-step muestra fricción medible (abandonan a mitad) → reducir a 3 steps colapsando 2+3 o 3+4.
- Si la validación de ciclos es performance bottleneck con grafos grandes (>50 items/category) → migrar a SQL helper o cache.
- Si el sub-split causa más fricción de la que evita → consolidar de vuelta + ADR de excepción slice-level (mismo patrón que `discussions`).

## Referencias

- `docs/decisions/2026-05-04-library-contribution-policy-groups.md` — ADR previo (write access).
- `docs/decisions/2026-05-01-library-action-tests-size-exception.md` — ADR de excepción para 3 test files.
- `docs/decisions/2026-05-02-tier-model.md` — model de tiers (relevante para `TierMembership` join).
- `docs/decisions/2026-05-02-permission-groups-model.md` — model de groups + scope.
- `docs/features/library/spec.md` — actualizar en G.7 con todos los conceptos nuevos.
- `docs/plans/2026-05-04-library-courses-and-read-access.md` — plan de implementación G.1-G.7 (sibling de este ADR).
- Investigación 2026-05-04: Skool/Circle/LMS general/Frimousse — agentes A/B/C/D, output guardado en transcript de la sesión.

## Wiring follow-up (2026-05-14)

El plan original `2026-05-04-library-courses-and-read-access.md` G.2+3.b prometía cablear el feature end-to-end pero el wiring final de pages quedó incompleto (componentes + actions + queries listos pero sin caller en pages). Audit 2026-05-14 lo identificó.

Plan de wiring ejecutado en 5 sub-fases (W1-W5):

- **W1** — query `listCategoryItemsForPrereqLookup` para alimentar selector + lookup.
- **W2** — `<PrereqSelector>` cableado en page de edit (el selector existente solo soporta EDIT mode con `itemId` post-create, así que el composer no se tocó). Page de new muestra hint sutil "asigná prereq desde la edición".
- **W3** — `<MarkCompleteButton>` debajo del body en detail page + `<LockedItemView>` cuando `!canOpenItem` (visible-but-locked, decisión D2).
- **W4** — `<CourseItemList>` (lock-aware) reemplaza `<ItemList>` plana cuando `category.kind === 'COURSE'`.
- **W5** — seed E2E con cadena A → B → C en cookingCourse + ADR follow-up.

Plan completo: `docs/plans/2026-05-14-library-courses-wiring.md`.

Cero decisiones nuevas — solo wiring de D1-D12.
