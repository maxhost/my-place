# Plan — Rediseño `/settings/library` con master-detail

**Fecha:** 2026-05-12
**Base canónica:** `docs/ux-patterns.md` (post commit `c0936aa`)
**Mini-spec referenciada:** § "Per-feature application matrix" → `/settings/library`
**Orden global:** tercero de 3 (editor → tiers → library)

## Context

`/settings/library` está ~50% alineado. La más compleja de las 3 sub-pages del bloque actual. Investigación previa:

- ✗ NO usa `<PageHeader>` — header manual con `<h1>` + breadcrumbs.
- ✗ Padding fuera de spec (`p-4 md:p-8` en vez de `px-3 py-6 md:px-4 md:py-8`).
- ✗ `<section>` sin `aria-labelledby`.
- ✗ **Lista plana** — no master-detail (groups ya lo tiene).
- ✓ Save model manual atómico (cada acción discreta).
- ✓ Color palette mayormente neutrals.
- ✓ `<ArchiveCategoryButton>` confirm dialog amber (recoverable destructive) — canon satisfecho.
- ✓ `<ContributorsDialog>` modal — funcional pero usa Radix Dialog directamente, no `<EditPanel>`.

**Decisión user 2026-05-12: migrar a master-detail AHORA** (no esperar R.7.5 items). Permite que cuando lleguen items + permisos de read, el detail page ya esté estructurado.

## Outcome esperado

Después del rediseño:

- `/settings/library`: master pane con lista de categorías (cards), botón "+ Nueva categoría".
- `/settings/library/[categoryId]`: detail pane con secciones [Info, Contributors, (futuro: Items, Read access)].
- Layout responsive: desktop split 360px lista + detail; mobile stack navigation.
- Forms migrados a `<EditPanel>` (responsive side drawer + bottom sheet).
- Page padding canónico, `<PageHeader>`, sections con `aria-labelledby`.
- Cero regresión funcional: CRUD categorías + contributors sigue igual.

## Pre-requisito: estado actual confirmado

- ✓ Page: `src/app/[placeSlug]/settings/library/page.tsx` (106 LOC).
- ✓ Components admin: `CategoryListAdmin`, `CategoryFormDialog`, `ContributorsDialog`, `ArchiveCategoryButton`.
- ✓ Reference master-detail: `src/app/[placeSlug]/settings/groups/{layout,page,_group-detail-content}.tsx` + `[groupId]/page.tsx`. Replicar estructura.
- ✓ Actions sin cambios.
- ✓ Schema sin cambios.

## Sesiones

Total: **2 sesiones independientes** (~600 LOC delta net).

Razón de split: la migración a master-detail toca múltiples archivos + nueva ruta. Sesión 1 establece la estructura base. Sesión 2 migra los dialogs a EditPanel + canon polish.

---

### Sesión 1 — Master-detail layout + canon básico

**Goal:** introducir master-detail (igual a groups) + aplicar canon básico (PageHeader, padding, sections). Sin tocar dialogs todavía.

**Files:**

- **NEW `src/app/[placeSlug]/settings/library/layout.tsx`** (~60 LOC):
  - Gate (mismo que groups: auth + admin/owner verificado por parent settings layout).
  - Carga lista de categorías inline (server component).
  - Renderea `<MasterDetailLayout master={<CategoryMasterList />} detail={children} hasDetail={pathnameHasCategoryId} />`.
  - Reference: `groups/layout.tsx` (copy-paste structure, swap data).

- **NEW `src/app/[placeSlug]/settings/library/page.tsx`** (REPLACE existing ~106 LOC → ~30 LOC placeholder):
  - Mobile mostrará la lista (master pane), desktop mostrará un placeholder "Elegí una categoría".
  - Mismo patrón que `groups/page.tsx`.

- **NEW `src/app/[placeSlug]/settings/library/[categoryId]/page.tsx`** (~120 LOC):
  - Carga la categoría por id + contributors + counts.
  - Renderea `<CategoryDetailContent>` (shared, in-file).
  - Sections: "Información" (emoji, título, slug, contribution policy) + "Contributors" (si DESIGNATED) + (placeholder para futuro "Items" + "Permisos de lectura").
  - Back link `md:hidden` (mobile only, igual a groups detail).

- **NEW `src/app/[placeSlug]/settings/library/_category-detail-content.tsx`** (~80 LOC):
  - Shared Server Component invocado desde `[categoryId]/page.tsx`.
  - Mismo patrón que `groups/_group-detail-content.tsx`.

- **MODIFIED `src/features/library/admin/ui/category-list-admin.tsx`** (105 → ~110 LOC):
  - Cambiar a estilo "master pane list" — cards compactas con emoji + título + contributors count + chip policy + chevron (link a detail).
  - QUITAR las actions inline (Editar, Contributors, Archivar) — ahora viven en el detail page.
  - NEW: `<CategoryRowLink>` sub-component per item, link a `/settings/library/[categoryId]`.

- **NEW `src/app/[placeSlug]/settings/library/loading.tsx`** (~30 LOC):
  - Skeleton consistente con `groups/loading.tsx`.

- **NEW `src/app/[placeSlug]/settings/library/[categoryId]/loading.tsx`** (~30 LOC).

- **MODIFIED tests existentes**: ajustar a la nueva estructura.

**No tocar en Sesión 1:**

- `CategoryFormDialog` y `ContributorsDialog` (sesión 2 los migra a EditPanel).
- `ArchiveCategoryButton` (ya canon).
- Server actions (sin cambios).
- Schema.

**Verificación Sesión 1:**

- `pnpm typecheck` verde.
- Suite completa verde.
- `pnpm lint` clean.
- Smoke manual:
  - `/settings/library` (mobile): lista de categorías. Tap row → navega a `/settings/library/[id]`.
  - `/settings/library` (desktop): split view. Lista a la izquierda, "Elegí una categoría" a la derecha.
  - `/settings/library/[id]`: detail con secciones funcionales (form Editar abre dialog actual, contributors abre dialog actual, archive button funciona). Back link mobile-only.
  - Cero regresión: CRUD funciona igual.

**LOC delta Sesión 1:** ~+250 (layout + page placeholder + detail + skeleton + minor master list refactor).

**Riesgo deploy Sesión 1:** medio. Cambio estructural de routing. Mitigación: tests automated + smoke manual exhaustivo + ADR del split documentado.

**Commit final S1:** `feat(library): master-detail layout + canon básico (PageHeader/padding/sections)`

---

### Sesión 2 — Migrar dialogs a EditPanel + polish

**Goal:** completar el alineamiento canon. Migrar CategoryFormDialog y ContributorsDialog a `<EditPanel>` (responsive). Polish detalles del detail page.

**Files:**

- **MODIFIED `src/features/library/admin/ui/category-form-dialog.tsx`** (207 → ~200 LOC):
  - Renombrar a `category-form-sheet.tsx` (drop-in API of EditPanel).
  - Reemplazar imports `Dialog*` → `EditPanel*`.
  - Botón footer "Listo" (sub-form pattern canon).
  - Sin cambios al form logic.

- **MODIFIED `src/features/library/admin/ui/contributors-dialog.tsx`** (250 → ~245 LOC):
  - Renombrar a `contributors-sheet.tsx`.
  - Reemplazar `Dialog*` → `EditPanel*`.
  - Footer cierra sin "Listo" (no es form de submit, es manage list inline).
  - Sin cambios a la lógica de invite/remove.

- **MODIFIED callsites**: en `_category-detail-content.tsx`, actualizar imports.

- **MODIFIED `library/admin/public.ts`** si exporta los components con nombres viejos.

- Tests de los dialogs: ajustar al new naming + verificar drop-in funciona.

**Verificación Sesión 2:**

- `pnpm typecheck` verde.
- Suite completa verde.
- `pnpm lint` clean.
- Smoke manual: ambos sheets abren con slide animation correcta (right desktop, bottom mobile). Cerrar = animation reverse. Funcionalidad idéntica a antes.

**LOC delta Sesión 2:** ~−10 neto (rename + small adjustments).

**Riesgo deploy Sesión 2:** bajo. Drop-in API. Solo cambia animación + responsive behavior.

**Commit final S2:** `feat(library): migrar dialogs admin a EditPanel responsive`

---

## Resumen total

| Sesión                           | LOC delta | Files                                                       | Riesgo | Commit local |
| -------------------------------- | --------- | ----------------------------------------------------------- | ------ | ------------ |
| 1 — Master-detail + canon básico | +250      | 7 (layout + page + detail + skeleton + master list + tests) | Medio  | OK           |
| 2 — EditPanel migration + polish | −10       | 2-3 (form sheet + contributors sheet + callsites)           | Bajo   | OK           |
| **Total**                        | **+240**  | **~10**                                                     | —      | —            |

## Cumplimiento CLAUDE.md

- ✅ TDD: tests existentes actualizados + smoke tests del routing.
- ✅ Mobile-first: master-detail con stack mobile (igual a groups, ya canon).
- ✅ Vertical slice: solo toca `features/library/` + `app/[placeSlug]/settings/library/`.
- ✅ Sesiones focalizadas: split en 2 por size + tipo de cambio (estructural vs primitive migration).
- ✅ LOC: cada file <300; feature total dentro de cap.
- ✅ Sin libertad arquitectónica: ADR del master-detail timing documentado (decisión user 2026-05-12: "ahora" vs esperar R.7.5).

## Reglas de trabajo agente

- ✅ Commit local previo: hash a confirmar (post-tiers session).
- ✅ NO revertir cambios previos: el rediseño aplica el patrón canon. NO modifica server actions ni schema ni decisiones de producto.
- ✅ Robusto para producción: tests + smoke manual exhaustivo + ADR + reference implementation (groups).
- ✅ Cero overlap entre sesiones: S1 estructura (layout + pages + master list), S2 primitive (forms en sheets).

## ADR considered

¿Vale la pena un ADR formal `docs/decisions/2026-05-12-library-master-detail-timing.md`?

Argumento para SÍ: el user explicitamente decidió "migrar a master-detail AHORA" en vez de esperar R.7.5 (items). Esa es decisión de timing que vale la pena documentar.

Argumento para NO: la decisión está capturada en este plan + en ux-patterns.md mini-spec post-update.

**Recomendación:** sumar nota breve a `docs/features/library/spec.md` mencionando que admin page usa master-detail desde 2026-05-12 (sin ADR formal — el plan + mini-spec suficiente).

## Open questions

1. **Slug "library" vs "biblioteca"** en el sidebar (canon expone como "Biblioteca"). Ya correcto en `settings-sections.ts` (`label: 'Biblioteca'`).
2. **Reordering categorías** (R.7.3.X deferred): NO incluido en este plan. Sumar cuando emerja necesidad.
3. **Permisos de lectura (G.1)**: section placeholder en detail page — sin UI activo hasta que G.1 esté implementado. Confirmar con user.
