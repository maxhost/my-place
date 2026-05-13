# Plan — Rediseño completo de permisos library (read + write)

**Fecha:** 2026-05-12
**Origen:** decisión user 2026-05-12 — clarificación de qué administra el admin de library.
**Reemplaza parcialmente:** `docs/plans/2026-05-12-settings-library-redesign.md` (ya no aplica master-detail; ver S3 abajo).

## Context

El admin de `/settings/library` debe permitir crear/editar categorías con **dos dimensiones de permisos** independientes:

- **Permiso de LECTURA** (acceso de consumo):
  - Todo el público (cualquier miembro del place)
  - N usuarios específicos
  - N tiers específicos
  - N grupos específicos

- **Permiso de ESCRITURA** (acceso de creación de items):
  - Solo owner
  - N usuarios específicos
  - N tiers específicos
  - N grupos específicos

**Comparación con el modelo actual:**

| Dimensión                              | Modelo actual                                                        | Modelo nuevo                                 | Gap                        |
| -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------- | -------------------------- |
| Read PUBLIC                            | ✅ `readAccessKind: 'PUBLIC'`                                        | ✅ igual                                     | —                          |
| Read N users                           | ✅ `LibraryCategoryUserReadScope`                                    | ✅ igual                                     | UI legacy no expone        |
| Read N tiers                           | ✅ `LibraryCategoryTierReadScope`                                    | ✅ igual                                     | UI legacy no expone        |
| Read N groups                          | ✅ `LibraryCategoryGroupReadScope`                                   | ✅ igual                                     | UI legacy no expone        |
| Write OWNER_ONLY                       | ❌ no existe                                                         | ✅ NEW (default)                             | requiere enum nuevo        |
| Write N users                          | ✅ `contributionPolicy: 'DESIGNATED'` + `LibraryCategoryContributor` | ✅ rename a `LibraryCategoryUserWriteScope`  | rename + drop tabla legacy |
| Write N tiers                          | ❌ NO existe                                                         | ✅ NEW tabla `LibraryCategoryTierWriteScope` | NEW schema                 |
| Write N groups                         | ✅ `contributionPolicy: 'SELECTED_GROUPS'` + `GroupCategoryScope`    | ✅ rename a `LibraryCategoryGroupWriteScope` | rename                     |
| Write MEMBERS_OPEN (cualquier miembro) | ✅ existe (default actual)                                           | ❌ **eliminado**                             | borrar concept             |

**Owner bypass (decisión user #1):** owner siempre puede leer + escribir cualquier categoría aunque no esté en el scope. Implícito en queries.

**Write implica Read (decisión user #2):** si X puede escribir, X aparece pre-seleccionado como puede leer. UI lo refleja al editar; backend lo valida implícito en query `canRead = isOwner || isInWriteScope || isInReadScope`.

**Permisos a nivel categoría (decisión user #3):** los items NO tienen permisos individuales — heredan los de la categoría. Si un user pierde acceso a la categoría (e.g. sale del tier asignado), pierde acceso a todos los items dentro.

**Categorías legacy (decisión user #4):** estamos en dev, podemos drop categorías existentes en la migration. NO necesitamos migration suave.

**PUBLIC scope (decisión user #5):** "todo el público" = todos los miembros activos del place. NO incluye internet abierto ni anónimos. NO respeta tier/group; es el opuesto explícito a las restricciones.

## Modelo de datos final

```prisma
enum ReadAccessKind {
  PUBLIC      // todos los miembros activos del place
  GROUPS      // restringido a N groups (via LibraryCategoryGroupReadScope)
  TIERS       // restringido a N tiers (via LibraryCategoryTierReadScope)
  USERS       // restringido a N users (via LibraryCategoryUserReadScope)
}

enum WriteAccessKind {  // NEW
  OWNER_ONLY  // solo owner del place (default restrictivo)
  GROUPS      // N groups (via LibraryCategoryGroupWriteScope)
  TIERS       // N tiers (via LibraryCategoryTierWriteScope)  — NEW pivot
  USERS       // N users (via LibraryCategoryUserWriteScope)  — rename de LibraryCategoryContributor
}

model LibraryCategory {
  id              String   @id @default(cuid())
  placeId         String
  slug            String
  emoji           String
  title           String
  position        Int?
  kind            LibraryCategoryKind @default(GENERAL)
  readAccessKind  ReadAccessKind  @default(PUBLIC)
  writeAccessKind WriteAccessKind @default(OWNER_ONLY)  // NEW, default restrictivo
  archivedAt      DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  // 6 pivots (3 read + 3 write) con shape idéntico
  groupReadScopes  LibraryCategoryGroupReadScope[]
  tierReadScopes   LibraryCategoryTierReadScope[]
  userReadScopes   LibraryCategoryUserReadScope[]
  groupWriteScopes LibraryCategoryGroupWriteScope[]   // rename de GroupCategoryScope
  tierWriteScopes  LibraryCategoryTierWriteScope[]    // NEW
  userWriteScopes  LibraryCategoryUserWriteScope[]    // rename de LibraryCategoryContributor

  // ELIMINADO: contributionPolicy (enum), inviteContributor metadata, etc.
}
```

**Eliminado del schema:**

- Enum `ContributionPolicy` (DESIGNATED | MEMBERS_OPEN | SELECTED_GROUPS) — reemplazado por `WriteAccessKind`.
- Tabla `LibraryCategoryContributor` con metadata `invitedAt + invitedByUserId` — reemplazada por `LibraryCategoryUserWriteScope` (solo categoryId + userId; sin metadata, owner audita via logs).
- Tabla `GroupCategoryScope` — renombrada a `LibraryCategoryGroupWriteScope`.

## Outcome esperado

Después de las 4 sesiones:

- Owner puede crear/editar categorías con elección independiente de read access (1 de 4 opciones) y write access (1 de 4 opciones).
- Cuando elige "USERS" / "TIERS" / "GROUPS" en cualquiera de los 2, picker multi-select muestra opciones disponibles.
- "Write implica read" reflejado en UI: pre-selección visible al cambiar a TIERS/GROUPS/USERS de write.
- Owner bypass garantizado en backend (queries + actions).
- UI consistente con hours/access (`<EditPanel>` side drawer).
- Cero regresión en zona gated `/library/[slug]/[item]` — los items siguen funcionando.

## Sesiones

Total: **4 sesiones independientes**, ~950 LOC. Riesgo decreciente (S1 alto, S4 bajo).

---

### S0 — ADR + spec update + plan validation

**Goal:** documentar las decisiones de modelo + actualizar spec antes de tocar código.

**Files:**

- **NEW** `docs/decisions/2026-05-12-library-permissions-model.md` (~200 LOC):
  - Contexto: clarificación user 2026-05-12 sobre qué administra el admin.
  - Decisión: 2 dimensiones independientes (read + write), 4 opciones cada una, 6 tablas pivote, owner bypass, write implica read.
  - Alternativas consideradas: (a) modelo unificado access (descartado: confunde read y write), (b) permisos por item (descartado: dec usuario #3, demasiada granularidad), (c) heredar de Place (descartado: cada categoría debe ser configurable).
  - Trade-offs: 6 tablas pivote vs 1 tabla genérica con discriminator (preferimos 6 — type safety + queries más simples).

- **MODIFIED** `docs/features/library/spec.md`:
  - Reemplazar sección de `ContributionPolicy` por la nueva `WriteAccessKind`.
  - Sumar sección "Owner bypass implícito" + "Write implica read".
  - Marcar como obsoleto/deprecated todo lo de `MEMBERS_OPEN`.
  - Update tabla de roadmap R.7.x si menciona contribución.

**No tocar en S0:** código, tests, schema (todo en S1).

**Verificación:** doc review por user antes de S1. `pnpm typecheck` + `pnpm lint` no aplican (solo docs).

**LOC delta:** +200 (docs).

**Riesgo deploy:** cero (solo docs).

**Commit final:** `docs(library): ADR modelo de permisos read + write con owner bypass`

---

### S1 — Backend: schema + migration + queries + actions

**Goal:** modelar nuevo, drop legacy, actualizar capa de datos completa.

**Files:**

- **NEW** `prisma/migrations/20260512xxxxxx_library_permissions_model/migration.sql`:
  - `DROP TABLE "LibraryCategoryContributor"`
  - `DROP TABLE "GroupCategoryScope"`
  - `DROP TABLE "LibraryCategory"` (drop completo, dev-only — decisión user)
  - Recrear `LibraryCategory` con `writeAccessKind` + drop de `contributionPolicy`.
  - `DROP TYPE "ContributionPolicy"`.
  - `CREATE TYPE "WriteAccessKind" AS ENUM ('OWNER_ONLY', 'GROUPS', 'TIERS', 'USERS')`.
  - `CREATE TABLE "LibraryCategoryGroupWriteScope"` (categoryId, groupId, PRIMARY KEY composite + FK cascade).
  - `CREATE TABLE "LibraryCategoryTierWriteScope"` (categoryId, tierId, PRIMARY KEY + FK cascade).
  - `CREATE TABLE "LibraryCategoryUserWriteScope"` (categoryId, userId, PRIMARY KEY + FK cascade).
  - RLS: 6 policies coordinated (member-only read si PUBLIC, scope check si GROUPS/TIERS/USERS — owner siempre puede).

- **MODIFIED** `prisma/schema.prisma`: ver § "Modelo de datos final" arriba.

- **MODIFIED** `src/features/library/domain/types.ts`:
  - Drop `ContributionPolicy` type.
  - Add `WriteAccessKind` type.
  - Update `LibraryCategory` shape.
  - Drop `LibraryCategoryContributor` type (sumarlo como `userWriteScopeIds` en LibraryCategory).

- **MODIFIED** `src/features/library/server/queries/categories.ts`:
  - `CATEGORY_SELECT` incluye `writeAccessKind` + 6 pivots.
  - `mapCategoryRow` mappea los 6 scope arrays.

- **MODIFIED** `src/features/library/server/queries/contributors.ts` (puede que se borre o renombre).

- **MODIFIED** `src/features/library/server/viewer.ts`:
  - `canRead(categoryId, userId)`: owner bypass → switch readAccessKind → check pivot.
  - `canWrite(categoryId, userId)`: owner bypass → switch writeAccessKind → check pivot.
  - **Write implica read**: si `canWrite() === true`, NO requiere check de read scope (implícito).

- **MODIFIED actions**:
  - `create-category.ts`: input ahora pide `readAccessKind + readScopeIds + writeAccessKind + writeScopeIds`. Actions atomic crea pivots junto con categoría.
  - `update-category.ts`: idem.
  - **DROP** `inviteContributorAction`, `removeContributorAction`, `setLibraryCategoryDesignatedContributorsAction`, `setLibraryCategoryGroupScopeAction` — reemplazados por `setReadAccess` + `setWriteAccess` actions.
  - **NEW** `setLibraryCategoryReadAccessAction` + `setLibraryCategoryWriteAccessAction` (actions atomic que reemplazan las pivots para una dimension).

- **MODIFIED tests**: actualizar todos los del slice library backend.

**No tocar en S1:** UI (S2 + S3). Tests UI (cubrir en S2/S3).

**Verificación:**

- `pnpm prisma migrate dev` corre sin error (en dev local + Supabase).
- `pnpm typecheck` verde (re-genera Prisma client).
- `pnpm vitest run src/features/library/` verde con tests actualizados.
- Suite completa verde.
- `pnpm lint` clean.

**LOC delta:** +400 net (schema + queries + actions + tests delta).

**Riesgo deploy:** **alto**. Drop tablas + migration destructiva. Mitigación:

- Estamos en dev (decisión user).
- Backup manual del DB antes de migrar.
- Tests cubren happy path + auth + scope checks.
- ADR documenta razón del breaking change.

**Commit final:** `feat(library): nuevo modelo de permisos read + write (breaking)`

---

### S2 — UI: wizard de categoría con read + write access

**Goal:** UI form completa que cubre las 2 dimensiones.

**Files:**

- **MODIFIED** `src/features/library/wizard/ui/category-form-sheet.tsx`: orquestador del wizard multi-step. Sumar step "Escritura" después de "Lectura".

- **NEW** `src/features/library/wizard/ui/wizard/category-form-step-write-access.tsx` (~150 LOC):
  - Análogo a `category-form-step-read-access.tsx`.
  - Radio group: Solo owner / Usuarios / Tiers / Groups.
  - Multi-select picker según opción.
  - **Pre-selección write→read**: cuando el user marca "X user/tier/group puede escribir", el step Lectura previo recibe esa selección como pre-checked. Implementación: state shared en el wizard orchestrator.

- **MODIFIED** `src/features/library/wizard/ui/wizard/category-form-step-read-access.tsx`:
  - Pre-checkear opciones que vienen de write step (write implica read).
  - UI hint: "X usuario/tier/group ya tiene acceso de escritura → tiene acceso de lectura automáticamente".

- **MODIFIED** `src/features/library/wizard/ui/wizard/category-form-types.ts`:
  - Sumar `WriteAccessKind` + scopes al type del form state.

- **NEW** `src/features/library/wizard/__tests__/...`:
  - Wizard renderiza los 4 steps (identity, contribution, read-access, write-access).
  - Submit con cada combinación de read/write access.
  - Pre-selección write→read funciona.

**No tocar en S2:** admin page todavía (S3).

**Verificación:** typecheck + vitest + lint verde. Smoke manual del wizard standalone si es invocable.

**LOC delta:** +400 net.

**Riesgo deploy:** medio. UI nueva pero contained al wizard.

**Commit final:** `feat(library): wizard con write access scope + write-implica-read UX`

---

### S3 — Admin page: migrar a wizard + decidir layout final + cleanup

**Goal:** rediseñar `/settings/library` admin completo. Eliminar legacy. Decidir layout (probable revertir master-detail a EditPanel ahora que tenemos info real).

**Files:**

- **MODIFIED** `src/app/[placeSlug]/settings/library/page.tsx`:
  - Decisión: revertir a lista plana + EditPanel (consistente con hours/access).
  - Razón: items NO se gestionan desde admin (viven en zona gated). Detail solo tiene 3-5 sections cortas.
  - Layout: header canon + section "Categorías" + lista plana + dashed-border "+ Nueva categoría" → abre wizard.
  - Cada row: emoji + título + chip readAccess + chip writeAccess + 3-dots (Editar = abre wizard, Archivar = amber confirm).

- **DROP** master-detail estructura:
  - `app/[placeSlug]/settings/library/layout.tsx` (S3.1 lo creó).
  - `app/[placeSlug]/settings/library/[categoryId]/page.tsx` + `loading.tsx`.
  - `app/[placeSlug]/settings/library/_category-detail-content.tsx`.

- **DROP legacy components**:
  - `src/features/library/ui/admin/category-form-dialog.tsx` (legacy — wizard lo reemplaza).
  - `src/features/library/ui/admin/contributors-dialog.tsx` (modelo de contributors eliminado).
  - `src/features/library/ui/admin/archive-category-button.tsx` (mover al detail/wizard si aplica, o mantener simple).

- **MODIFIED** `src/features/library/ui/admin/category-list-admin.tsx`:
  - Volver a `<ul>` plano con per-row 3-dots actions (no Link).
  - 3-dots: Editar (abre wizard EditPanel) / Archivar.

- **MODIFIED** tests.

- **MODIFIED** `docs/features/library/spec.md`: reflejar el admin page final.

- **CLEANUP** `docs/plans/2026-05-12-settings-library-redesign.md`: marcar como reemplazado por este plan.

**No tocar en S3:** wizard (ya done en S2).

**Verificación:** typecheck + vitest + lint verde. Smoke manual:

- Crear categoría con varias combinaciones de read/write.
- Editar categoría existente.
- Archivar.
- Verificar zona gated `/library/[slug]/[item]` aún funciona (sin regresión).

**LOC delta:** −200 net (limpieza de legacy + master-detail).

**Riesgo deploy:** medio. Reemplaza UI admin completa. Mitigación: tests + smoke.

**Commit final:** `feat(library): admin page con EditPanel wizard + cleanup legacy`

---

## Resumen total

| Sesión                    | LOC delta | Files                                                | Riesgo |
| ------------------------- | --------- | ---------------------------------------------------- | ------ |
| S0 — ADR + spec           | +200      | 2 docs                                               | Cero   |
| S1 — Backend              | +400      | ~12 (schema + migration + queries + actions + tests) | Alto   |
| S2 — Wizard UI            | +400      | ~5 (steps + types + tests)                           | Medio  |
| S3 — Admin page + cleanup | −200      | ~10 (page + lista + drops + tests + docs)            | Medio  |
| **Total**                 | **+800**  | **~29 archivos**                                     | —      |

## Cumplimiento CLAUDE.md

- ✅ Spec antes de código: S0 produce ADR + spec update.
- ✅ TDD: tests primero en S1 (validación de owner bypass + write-implies-read).
- ✅ Sesiones cortas: 4 sesiones independientes deployables solas (excepto S2/S3 dependen de S1).
- ✅ Vertical slice: solo `features/library/` + `app/[placeSlug]/settings/library/` + `prisma/`.
- ✅ Sin libertad arquitectónica: ADR documenta cada decisión de producto.
- ✅ Idioma: docs/comments español, código inglés.
- ✅ LOC: archivos individuales <300; feature library total monitorear (cap 1500).

## Reglas de trabajo agente

- ✅ Commit local previo a cada sesión.
- ✅ NO revertir cambios previos: este plan **REEMPLAZA** el master-detail de S3.1 deployado (commit `3ed47e9`) con un EditPanel + lista plana — explícito en S3, no es revert silencioso.
- ✅ Robusto para producción: schema breaking pero contained a dev (decisión user); RLS coordinada en S1; tests cubren todas las dimensiones.
- ✅ Si uso agentes: solo en S1 (queries + actions + RLS pueden paralelizarse en archivos distintos), pero asegurar cero overlap.

## Decisiones cerradas (2026-05-12)

Las 4 open questions del plan fueron resueltas por el user:

1. **Naming**: `WriteAccessKind` (simetría con `ReadAccessKind`).
2. **Audit trail en pivots write**: SIN metadata
   (`invitedAt`/`invitedByUserId`). Las 6 tablas pivote son
   `{ categoryId, subjectId }` puras. Si emerge requirement futuro, se
   suman columns sin breaking change.
3. **Owner del place que cambia**: el bypass `OWNER_ONLY` sigue al
   NUEVO owner (chequeo runtime contra `PlaceOwnership`, no contra el
   owner original que creó la categoría).
4. **S3 layout final**: revertir master-detail a EditPanel + lista
   plana. Consistencia con `/settings/hours` y `/settings/access`.
