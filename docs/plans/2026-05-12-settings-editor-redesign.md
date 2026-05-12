# Plan — Rediseño `/settings/editor`

**Fecha:** 2026-05-12
**Base canónica:** `docs/ux-patterns.md` (post commit `c0936aa`)
**Mini-spec referenciada:** § "Per-feature application matrix" → `/settings/editor`
**Orden global:** primero de 3 (editor → tiers → library)

## Context

`/settings/editor` ya está ~85% alineado con el canon. Investigación previa confirma:

- ✓ `<PageHeader>` aplicado
- ✓ Page padding canónico (`mx-auto max-w-screen-md space-y-6 px-3 py-6 md:px-4 md:py-8`)
- ✓ Section `aria-labelledby` + `<h2 font-serif text-xl pb-2 border-b>`
- ✓ Color palette neutrals
- ✓ Tests existentes (form + actions)

**Gaps reales:**

1. **Save model desviado**: hoy es **autosave con soft barrier** (`useFieldArray` de RHF con `commitOrDefer`). El canon es "todo manual" (anchor principle #3). Mismo gesto tiene 2 comportamientos según el estado dirty → confuso. **Decisión user 2026-05-12: migrar a "todo manual"**.

2. **Layout de items**: hoy `<ul className="divide-y"><li>checkbox + label</li></ul>`. El canon para items con estado on/off (plugins) es **Card-per-item** (§ ux-patterns L162). Cada plugin = card con border, header h-[56px] (nombre + descripción corta + switch on/off accesible). Sin body porque plugins no tienen sub-data — el header es el único contenido.

3. **Switch primitive**: usar el mismo `role="switch"` accesible que `week-editor-day-card.tsx` (button con aria-checked) en lugar de `<input type="checkbox">`. Coherencia visual con hours.

## Outcome esperado

Después del rediseño:

- 4 plugins como cards individuales (border-neutral-200 rounded-md), cada uno con switch on/off.
- Toggle = mutación local en RHF, NO autosave. `formState.isDirty` se enciende.
- Botón "Guardar cambios" page-level + indicator "• Cambios sin guardar".
- Eliminada lógica de `commitOrDefer`/soft barrier (~30 LOC menos en form).
- Tests actualizados: reemplazar tests de autosave por tests de manual save + dirty indicator.

## Pre-requisito: estado actual confirmado

- ✓ Page entry: `src/app/[placeSlug]/settings/editor/page.tsx` (66 LOC) — solo cambios mínimos.
- ✓ Form orquestador: `src/features/editor-config/ui/editor-config-form.tsx` (199 LOC) — refactor principal aquí.
- ✓ Action: `src/features/editor-config/server/actions.ts::updateEditorConfigAction` — sin cambios (mismo input shape).
- ✓ Schema: `Place.editorPluginsConfig` JSONB — sin cambios.
- ✓ Tests: `src/features/editor-config/ui/__tests__/editor-config-form.test.tsx` — actualizar.

## Sesiones

Total: **1 sesión focal** (~150 LOC delta net, todos UI).

### Sesión única — Refactor a "todo manual" + Card-per-item con switch

**Goal:** alinear editor-config-form al canon.

**Files:**

- **MODIFIED `src/features/editor-config/ui/editor-config-form.tsx`** (199 LOC actuales → ~170):
  - Eliminar `commitOrDefer`, `snapshot()` helpers, `DEFER_HINT` constant.
  - Handlers simplificados: `handleToggle(key, value)` solo hace `setValue(key, value)` (RHF). RHF marca dirty automático.
  - `onSubmit` invoca `updateEditorConfigAction` con snapshot completo + `methods.reset(snapshot)` post-success.
  - Reemplazar `<ul className="divide-y"><li>` por `<div className="space-y-3">` con `<PluginCard>` por cada plugin.
  - NEW sub-component `<PluginCard>` (in-file, ~50 LOC):
    - Container: `<div className="rounded-md border border-neutral-200">`
    - Header `<div className="flex min-h-[56px] items-center gap-3 px-3">`: name (text-base font-medium) + description (text-xs text-neutral-500) en flex-col + switch a la derecha.
    - Switch primitive: `<button role="switch" aria-checked>` con thumb h-5 w-5 dentro de track h-6 w-11 (idéntico a `week-editor-day-card.tsx` DaySwitch).
  - Botón "Guardar cambios" full-width neutral-900 + `disabled={pending || !formState.isDirty}` + label `• Cambios sin guardar` (idéntico a hours-form).

- **MODIFIED `src/features/editor-config/ui/__tests__/editor-config-form.test.tsx`**:
  - Quitar tests de autosave (`commits si limpio`, `defiere si dirty`).
  - Sumar tests:
    - Toggle aplica solo local (no se invoca action hasta submit).
    - Botón "Guardar cambios" disabled cuando limpio.
    - `formState.isDirty` activa el indicator.
    - Submit invoca action con snapshot completo.
  - Mantener tests de error mapping + auth (no cambian).

- **NO TOCAR**:
  - `src/app/[placeSlug]/settings/editor/page.tsx` (ya canon).
  - Server action (mismo input shape).
  - Schema/data.

**Verificación:**

- `pnpm typecheck` — verde.
- `pnpm vitest run src/features/editor-config/` — verde con tests nuevos.
- `pnpm vitest run` (suite completa) — 2139+ tests verde.
- `pnpm lint` — clean.
- Smoke manual post-deploy: abrir `/settings/editor`, togglear 2 plugins, ver indicator dirty + botón habilitado, click Guardar → toast success + indicator se va.

**LOC delta:** −30 (refactor reduce form 199→170; tests cambian sin sumar mucho).

**Riesgo deploy:** bajo. El contrato de la action no cambia. Solo cambia UX del form.

**Commit final:** `feat(editor-config): card-per-item con switch + save model manual`

## Cumplimiento CLAUDE.md

- ✅ TDD: tests primero (cambios mínimos a los existentes + nuevos para manual save).
- ✅ Mobile-first: cards rounded-md + switch min-h-11 + touch target ≥44px.
- ✅ Sin libertad arquitectónica: decisiones documentadas en este plan + ux-patterns.md canon.
- ✅ Vertical slice: solo toca `features/editor-config/`. Sin cross-feature.
- ✅ Idioma: docs/comments en español, código en inglés.
- ✅ Tipos estrictos: sin `any` ni `@ts-ignore`.
- ✅ Sesión corta: 1 file primario (form) + 1 test file. <5 archivos.
- ✅ LOC: form post-refactor ~170 (cap 300 OK).

## Reglas de trabajo agente

- ✅ Commit local previo: `c0936aa` (doc update). Working tree limpio.
- ✅ NO revertir cambios previos: el rediseño solo refactoriza UX del form. NO toca action, schema, ni layout previo.
- ✅ Robusto para producción: tests cubren happy path + error cases + dirty state. No quick fixes.
- ✅ Sin agentes paralelos: 1 sola sesión, 1 file primario.

## Open question

¿La descripción de cada plugin (texto secundario en la card) debe venir hardcoded en el component o en un mapping nuevo? Recomendación: hardcoded inline porque son 4 fijos. Si crece >6, extraer a constante.
