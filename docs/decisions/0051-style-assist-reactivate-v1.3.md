# 0051 — Slice `style-assist` + dep `ai`: reactivación comprometida a V1.3

- **Fecha:** 2026-06-05
- **Estado:** Aceptada
- **Alcance:** scope/producto (asistencia LLM propose-only del onboarding), arquitectura (slice `style-assist`), dependencias (`ai@^6.0.185` se mantiene en `package.json`), tech-debt (Phase 3.A — decisión de scope)
- **Refina:** ADR-0020 (la pausa de la asistencia LLM en el MVP **sigue vigente HOY** — no se reactiva en Phase 3.A; lo que cambia es el stance de futuro: ADR-0020 §16/§54 señalaba que el LLM "probablemente no se reactive en el corto plazo" → esta ADR lo convierte en **reactivación comprometida a V1.3** con plan de reconstrucción). Refina ADR-0015 (el slice sigue existiendo; su motivación arquitectónica acíclica sigue válida).
- **No supersede:** ADR-0020 en su decisión de **pausar el MVP** (esa decisión fue correcta y sigue en efecto hasta V1.3). Esta ADR supersede únicamente la **expectativa de no-reactivación** de ADR-0020.
- **Origen:** Phase 3.A del tracker de tech-debt pre-V1.3 (`docs/tech-debt-pre-v1.3.md` §"Sesión 3.A — Scope decisions").

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El audit de tech-debt post-V1.2 marcó `src/features/style-assist/` (347 LOC) + la dependencia `ai@^6.0.185` como **código dormido**: la asistencia LLM propose-only del onboarding (paleta sugerida) fue **pausada por ADR-0020 (2026-05-19)**, que removió la UI glue (hook `use-style-assist`, isla `style-assist-island`, contrato `StyleAssistLabels`) y dejó sólo saga + Server Action + dominio como "código dormido y testeado", recuperable de git history (commit `f837e5b`).

Hoy el slice no tiene consumer activo de producción: `place-wizard` dejó de importarlo (su `public.ts` lo confirma) y el único callsite del Server Action (`suggest-style-action`) fue gateado por auth en Phase 0.A. La dependencia `ai` queda como **peso muerto** en `package.json` (bundle/install + superficie supply-chain) para código que nadie llama.

Phase 3.A obliga a cerrar el estado dormido con una de tres opciones: (A) reactivar en V1.3 (registrar timeline, mantener la dep), (B) drop slice + dep `ai`, (C) mantener dormido sin decisión nueva.

**Decisión del owner (2026-06-05):** Opción A — reactivar en V1.3.

## Decisión

1. **`style-assist` se reactivará en V1.3.** La pausa de ADR-0020 sigue vigente **hasta** V1.3 — Phase 3.A NO reactiva nada hoy (no construye UI glue, no re-cabla el wizard). Esta ADR fija el **compromiso + plan de reconstrucción + timeline (V1.3)**.

2. **La dep `ai@^6.0.185` se MANTIENE** en `dependencies` (no se dropea). Justificación: la reactivación está comprometida; dropearla ahora para re-agregarla en V1.3 sería churn de lockfile + riesgo de drift de versión mayor de un SDK que evoluciona rápido. El costo de mantenerla (bundle server-side, no client — el slice es server-only) es aceptable contra el compromiso de reactivación.

3. **Saga + Server Action + dominio se mantienen dormidos y testeados** (`suggest-style.ts`, `suggest-style-action.ts`, `domain/style-suggestion.ts`, `__tests__/suggest-style.test.ts` verde). Sin cambios en Phase 3.A.

4. **Plan de reconstrucción para V1.3** (lo que la sesión de reactivación deberá hacer, con nueva ADR que supersede ADR-0020 en su totalidad):
   - Reconstruir la UI glue desde git history commit `f837e5b`: hook `use-style-assist.ts`, isla `style-assist-island.tsx`, contrato `StyleAssistLabels` (`labels.ts`).
   - Re-cablear los 11 keys i18n `assist*` (`assistButton`, `assistLoading`, `assistNeedDescription`, `assistUnavailable`, `assistProposedTitle`, `assistProposedHint`, `assistPaletteLabel`, `assistDescriptionLabel`, `assistApplyPalette`, `assistApplyDescription`, `assistApplied`) en los 6 locales (es/en/fr/pt/de/ca — el catálogo creció desde el MVP monolingüe de ADR-0020).
   - Re-introducir el input fuente (campo "Descripción del lugar" del Paso 2, removido por ADR-0020 §5; la columna `place.description TEXT` sigue nullable y dormida en DB, forward-compat).
   - Re-cablear el wizard (`use-place-wizard.ts` + `wizard-steps.tsx` + `wizard-labels.ts`) respetando el grafo acíclico ADR-0015/ADR-0019.
   - **Verificar que la integración LLM produce propuestas** en preview — el blocker original de ADR-0020 §16 ("la asistencia no estaba funcional en preview") debe resolverse antes de exponer el botón.
   - **Re-validar el ROI** que ADR-0020 §C consideró bajo (presets curados + custom hex ya cubren el caso del onboarding) — la reactivación debe justificar por qué V1.3 cambia ese cálculo.

## Alternativas rechazadas

- **(B) Drop slice + dep `ai` + recuperar de git history si se reactiva.** Máxima limpieza: elimina 347 LOC dormidos + el peso de la dep `ai`. Es lo que ADR-0020 §B había rechazado en su momento por preservar trabajo validado. Rechazada por el owner: la reactivación está comprometida a V1.3, así que dropear ahora sólo para reconstruir en meses agrega churn (lockfile, re-instalación de un SDK de versión mayor evolucionante) sin ganancia real — el peso de `ai` server-side es tolerable contra el compromiso firme.

- **(C) Mantener dormido como hoy sin ADR nueva.** Status quo de ADR-0020 intacto. Rechazada: no cierra el item de Phase 3.A — la dep seguiría siendo peso muerto "sin decisión", y el tracker exige resolver el scope explícitamente (decidir, no postergar).

## Consecuencias

- **`style-assist` deja de ser "dormido sin fecha"** y pasa a "dormido con reactivación comprometida a V1.3 + plan de reconstrucción documentado".
- **`package.json` sin cambios** — la dep `ai@^6.0.185` se mantiene **deliberadamente** (esta ADR es el rationale de por qué no se dropea, para que un audit futuro no la marque como huérfana).
- **ADR-0020 recibe banner** de refinamiento apuntando a esta ADR (la pausa MVP sigue vigente; la expectativa de no-reactivación queda revertida).
- **V1.3 hereda una sesión concreta de reactivación** con checklist (plan §4) + obligación de nueva ADR que supersede ADR-0020 en su totalidad + re-validación de ROI + fix del blocker de preview.
- **El header de `style-assist/public.ts`** se actualiza: "dormido, listo para reactivar cuando ADR-0020 sea superseded" → "dormido, reactivación **comprometida a V1.3** por ADR-0051 (plan de reconstrucción en la ADR)".
- **ADR-0020 y ADR-0015 NO se editan en su cuerpo** (inmutabilidad); reciben/mantienen banners.
