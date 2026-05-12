# Plan — Rediseño `/settings/tiers`

**Fecha:** 2026-05-12
**Base canónica:** `docs/ux-patterns.md` (post commit `c0936aa`)
**Mini-spec referenciada:** § "Per-feature application matrix" → `/settings/tiers`
**Orden global:** segundo de 3 (editor → tiers → library)

## Context

`/settings/tiers` ya está ~70% alineado. Investigación previa confirma:

- ✓ `<PageHeader title="Tiers" description="...">` aplicado.
- ✓ Page padding canónico.
- ✓ Section `aria-labelledby="tiers-list-heading"` + h2 serif.
- ✓ Color palette neutrals + amber chip para HIDDEN.
- ✓ BottomSheet form para create/edit (debería migrar a `<EditPanel>` post-2026-05-12).
- ✓ 3-dots dropdown por tier para acciones (edit, publicar/ocultar).
- ✓ Tests robustos: 808 LOC en `__tests__/`.
- ✓ Save model: no aplica "todo manual" — cada acción es discreta (create / update / setVisibility) → persiste directo.

**Gaps reales:**

1. **Layout de items**: hoy `<ul><li flex>` plano, sin border/card container. El canon es **Card-per-item** (§ ux-patterns L162) con container `rounded-md border border-neutral-200`. Mismo patrón que hours/day-card.

2. **BottomSheet → EditPanel**: el form `<TierFormSheet>` usa `<BottomSheet>` directamente. El canon post-2026-05-12 es `<EditPanel>` para forms ≥2 inputs en settings (responsive: bottom sheet mobile + side drawer 520px desktop, con animations open + close).

3. **Switch on/off para visibility**: hoy visibility (PUBLISHED/HIDDEN) se toggle via dropdown menu item. El canon para items con estado binario es **switch on/off en el header del card**. Eleva el toggle de "acción escondida en menú" a "control prominente del card".

**Gaps que NO aplica corregir:**

- "Save model todo manual" — N/A. Cada CRUD es atómico (no hay form page-level).
- Master-detail — N/A. Cardinality típica ≤8 tiers (spec § 13). Card-per-item es lo correcto.

## Outcome esperado

Después del rediseño:

- Cada tier = card con border + header (nombre + price/duration secundario + 3-dots + switch on/off visibility).
- Switch PUBLISHED ↔ HIDDEN: tap dispara `setTierVisibilityAction` directo (atomic). Confirm dialog solo si va a colisionar (server retorna `name_already_published`).
- Form create/edit migrado de `<BottomSheet>` a `<EditPanel>` (drop-in API; ganar side drawer desktop + animation correcta).
- Botón "+ Nuevo tier" full-width dashed-border al final de la lista (canon).

## Pre-requisito: estado actual confirmado

- ✓ Page: `src/app/[placeSlug]/settings/tiers/page.tsx` (70 LOC).
- ✓ List orquestador: `src/features/tiers/ui/tiers-list-admin.tsx` (234 LOC).
- ✓ Form sheet: `src/features/tiers/ui/tier-form-sheet.tsx` (294 LOC).
- ✓ Actions: `create-tier.ts`, `update-tier.ts`, `set-tier-visibility.ts` (sin cambios).
- ✓ Schema: `Tier` con visibility enum (sin cambios).

## Sesiones

Total: **1 sesión focal** (~250 LOC delta net, todos UI).

### Sesión única — Card-per-item + EditPanel + switch on/off

**Goal:** alinear tiers admin al canon completo.

**Files:**

- **MODIFIED `src/features/tiers/ui/tiers-list-admin.tsx`** (234 → ~260 LOC):
  - Reemplazar `<ul className="divide-y"><li>` por `<div className="space-y-3">` con `<TierCard>` (in-file, ~80 LOC).
  - `<TierCard>` estructura:
    - Container: `<div className="rounded-md border border-neutral-200">`
    - Header: `<div className="flex min-h-[56px] items-center gap-3 px-3">` con:
      - flex-1 column: nombre (text-base font-medium) + meta secundario (price + duration formateado, text-xs text-neutral-500)
      - Status chip "Publicado" o "Oculto" (amber para HIDDEN).
      - 3-dots DropdownMenu: items "Editar" (abre sheet edit) + (solo si visible) "Detalle de miembros asignados" (placeholder mientras M.x no llega).
      - Switch on/off: PUBLISHED → ON, HIDDEN → OFF. Tap dispara `setTierVisibilityAction({ tierId, visibility: next })`. Optimistic toast.success + revalidatePath. Manejo error: si action retorna `name_already_published`, toast.error con copy específico.
  - Botón "+ Nuevo tier" al final: dashed-border full-width canon (NO top-right filled — ya cumplido hoy).
  - Empty state: copy + ilustración minimal si N=0.

- **MODIFIED `src/features/tiers/ui/tier-form-sheet.tsx`** (294 → ~280 LOC):
  - Reemplazar imports `BottomSheet*` → `EditPanel*` (drop-in API, doc del primitive lo garantiza).
  - Botón footer: "Listo" en lugar de "Guardar" (canon distingue sub-form vs page-level).
  - Sin cambios al form logic (RHF, Zod, action invocation).

- **MODIFIED `src/features/tiers/__tests__/...`**:
  - Verificar que tests existentes pasan tras refactor.
  - Sumar smoke test del switch on/off de visibility (mock action, assert called con correct visibility).
  - Sumar test de error path: `name_already_published` → toast.error con copy correcto.

- **NO TOCAR**:
  - Page entry-point (ya canon).
  - Server actions (mismo contrato).
  - Schema/data.

**Verificación:**

- `pnpm typecheck` — verde.
- `pnpm vitest run src/features/tiers/` — verde con tests actualizados.
- Suite completa 2139+ verde.
- `pnpm lint` — clean.
- Smoke manual post-deploy:
  - `/settings/tiers`: cards con border, switch on/off per tier.
  - Tap switch HIDDEN → PUBLISHED: tier pasa a publicado + toast.
  - Tap switch con colisión: toast error + switch revierte.
  - Tap "+ Nuevo tier" → EditPanel slide-in derecha (desktop) o bottom (mobile) con animation correcta.
  - Form "Listo" persiste + cierra panel con animation correcta.

**LOC delta:** +30 net (cards add structure; EditPanel migración drop-in).

**Riesgo deploy:** bajo. API actions sin cambios. UX cambia per visibility toggle (prominente vs escondido en menú) — mejora descubrimiento.

**Commit final:** `feat(tiers): card-per-item con switch visibility + EditPanel form`

## Cumplimiento CLAUDE.md

- ✅ TDD: smoke tests del switch + error path antes de codear.
- ✅ Mobile-first: cards rounded-md + switch min-h-11 + touch ≥44px.
- ✅ Sin libertad arquitectónica: decisiones documentadas en plan + canon.
- ✅ Vertical slice: solo toca `features/tiers/`. Sin cross-feature.
- ✅ Idioma: docs en español, código en inglés.
- ✅ Tipos estrictos.
- ✅ Sesión focal: 2 archivos primarios + tests. <5 archivos.
- ✅ LOC: list-admin post-refactor ~260, form sheet ~280, ambos <300.

## Reglas de trabajo agente

- ✅ Commit local previo (asumiendo editor session terminada): hash a confirmar.
- ✅ NO revertir cambios previos: el rediseño solo refactoriza UI. Sin tocar lo de access/hours/editor.
- ✅ Robusto para producción: tests cubren happy + error + visibility flip; no quick fixes.

## Open question

- Switch visibility: ¿"publicado/oculto" en español canon, o "visible/oculto"? Hoy spec usa PUBLISHED/HIDDEN en código y la UI muestra "Publicado"/"Oculto". Mantener "Publicado" como label visible + ON state, "Oculto" + OFF state. Validar con user en review.
