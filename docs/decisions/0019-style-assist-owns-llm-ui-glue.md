# 0019 — `style-assist` también es dueño de su UI glue (hook + isla + `StyleAssistLabels`)

- **Fecha:** 2026-05-20
- **Estado:** Aceptada
- **Alcance:** arquitectura de slices (responsabilidad de UI del LLM; contrato de labels narrow; refactor puro de archivos)
- **Refina:** ADR-0015 (que creó `style-assist` con scope "saga + Server Action") — ahora el slice también es dueño del cliente UI (hook + isla) y de su contrato de labels. **Cierra** la deuda del slice `place-wizard` que quedó en 1638 LOC > 1500 tras el refactor de sub-hooks (precedente: ADR-0016 cerró deuda análoga extrayendo el wizard UI).

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

El refactor de `use-place-wizard.ts` (sub-hooks por dominio, 2026-05-20) resolvió el techo duro de archivo (≤300 LOC) — el orquestador quedó en 168 LOC, cada sub-hook ≤89. Pero el split inherentemente sumó ~170 LOC de overhead estructural (imports/headers/return-shape), llevando el slice `place-wizard` de 1469 a **1638 LOC** > **1500** (techo duro CLAUDE.md, mismo principio "superar un límite = dividir antes de continuar").

Dos opciones honestas: (a) aceptar la deuda y registrarla — exactamente el patrón que las reglas del repo proscriben; (b) mover la parte del slice que conceptualmente NO pertenece a `place-wizard`. La UI glue del LLM (hook `use-style-assist` + componente `style-assist-island`) es del concern del LLM — ya vive en `style-assist` su saga + Server Action (ADR-0015). Que la UI viva en `place-wizard` era una decisión por **proximidad al wizard** (la isla aparece dentro del Paso 2), no por **dominio**. Mover esa UI al slice dueño del LLM (a) baja `place-wizard` a ~1440 (margen 60 bajo 1500), (b) sube `style-assist` de 189 a ~410 (margen ~1090), (c) hace el grafo de slices más fiel al modelo de dominio.

**Restricción crítica diagnosticada por Explore (no asumida):** mover los 2 archivos *tal cual* crearía un ciclo `style-assist → place-wizard → style-assist`, porque los 2 archivos hoy importan tipos de `place-wizard/wizard-labels.ts`:
- `use-style-assist.ts` → `WizardSuggest` (tipo del callback `onSuggest`).
- `style-assist-island.tsx` → `WizardLabels` (la prop `labels` consume 12 keys de strings i18n).

`place-wizard` ya importa `StyleSuggestion` de `style-assist` (ADR-0015); el segundo import direccional crearía el ciclo. **Prohibido** por architecture.md §25 / ADR-0015 §"Decisión" punto 3 (`style-assist` no importa de ninguna feature).

## Decisión

1. **`style-assist` define y exporta `StyleAssistLabels`** (interfaz narrow con los 12 keys i18n que la isla consume: `assistButton`, `assistLoading`, `assistNeedDescription`, `assistUnavailable`, `assistProposedTitle`, `assistProposedHint`, `assistPaletteLabel`, `assistDescriptionLabel`, `assistApplyPalette`, `assistApplyDescription`, `assistApplied`, `guardrailNotice`). Vive en `src/features/style-assist/labels.ts`. Es el contrato narrow del LLM-island; va al slice dueño del LLM, NO a `shared/` (semánticamente no es primitivo cross-feature; ese es el criterio de ADR-0015 para `shared/`: primitivos comunes a múltiples slices).

2. **Los 2 archivos se mueven al slice `style-assist`** con `git mv` (historial preservado):
   - `src/features/place-wizard/use-style-assist.ts` → `src/features/style-assist/use-style-assist.ts`.
   - `src/features/place-wizard/style-assist-island.tsx` → `src/features/style-assist/style-assist-island.tsx`.
   - Tras el move, ambos importan **solo** de `./` (intra-slice), `@/shared/lib/...` y `react`. No importan de ninguna feature → acíclico verificable con `grep`.

3. **`place-wizard/wizard-labels.ts` compone**: `interface WizardLabels extends StyleAssistLabels { …wizard-own-keys }`. Place-wizard sigue siendo el dueño del bag completo del wizard; el subconjunto LLM viene tipado desde el slice LLM. `guardrailNotice` se shareea estructuralmente entre la isla (style-assist) y el `place-preview` (place-wizard), ambos lo consumen del mismo key — sin duplicación. `WizardSuggest` queda como alias `export type WizardSuggest = SuggestStyle;` (mantiene API pública del wizard sin duplicar el tipo).

4. **`style-assist/public.ts` agrega `useStyleAssist`, `StyleAssistIsland`, `StyleAssistLabels`** a sus exports. El header se refina (sigue afirmando acíclico — los 2 archivos no importan de ninguna feature). Aristas resultantes (verificadas por `grep` post-implementación):
   - `place-wizard → style-assist` (consume hook + isla + labels-contract + tipos).
   - `style-assist → nada` (solo `shared/` + react). ✅ Acíclico.

5. **El test integration `style-assist-island.test.tsx` queda en `place-wizard/__tests__/`** porque renderiza `<PlaceWizard>` (no la isla aislada); valida behavior del wizard cableado con LLM, no behavior aislada de style-assist. Confirmado por Explore: no importa `StyleAssistIsland` ni `useStyleAssist` directamente. Los 197 tests son la red de regresión — el refactor es puro (sin cambio de comportamiento), todos deben seguir 197/197 sin cambiar ni una aserción.

## Alternativas rechazadas

- **Mover los tipos `WizardLabels` y `WizardSuggest` a `shared/`** para que ambos slices puedan importarlos. Rechazado: `WizardLabels` es el bag completo del wizard (~75 keys, muchos i18n strings de pasos, account, palette, etc.), NO un primitivo cross-feature. Contaminaría `shared/`. ADR-0015 fijó el criterio: a `shared/` van primitivos verdaderamente comunes (palette schema lo era; aquí no).
- **Dejar los 2 archivos en `place-wizard` y aceptar el slice 1638 > 1500.** Rechazado: viola la misma regla dura que el refactor de sub-hooks vino a cerrar; registrarlo como "deuda" es el patrón que las reglas proscriben.
- **No definir `StyleAssistLabels`** y hacer que la isla acepte una prop con tipo `any` o un tipo súper genérico. Rechazado: pérdida de typecheck en el contrato + sin captura de keys faltantes.
- **Renombrar `style-assist-island.tsx` → `island.tsx` durante el move.** Diferido a housekeeping aparte; el rename adicional rompe la rename-detection de git al 100%.

## Consecuencias

- **Slice place-wizard ≤1500** (esperado ~1440). Slice style-assist ≤1500 (esperado ~410). Ambos cómodos.
- **Cohesión por dominio**: la asistencia LLM (saga + Server Action + hook + isla + labels contract) vive en un solo slice. El wizard la consume vía `public.ts` como cualquier otra dependencia.
- **Backward-compat preservada**: `WizardLabels` sigue siendo el bag completo (por composición); `WizardSuggest` sigue siendo un tipo exportado del wizard. Las rutas (`crear/page.tsx`, `login/page.tsx`) no cambian. Las fixtures de tests no cambian.
- **Patrón replicable**: cualquier futuro caso en que un slice "anfitrión" (place-wizard) necesite UI de un slice "concern" (style-assist), la solución canónica ahora es: el slice concern define un narrow labels contract + provee hook+componente; el anfitrión compone su labels bag con extends. Sin duplicar tipos, sin contaminar `shared/`.

## Detalle operativo canónico

- Plan operativo: `~/.claude/plans/wise-greeting-mccarthy.md` (sesión 2026-05-20).
- Verificación post-implementación: `grep -rn "from \"@/features/place-wizard" src/features/style-assist` debe devolver **vacío** (acíclico verificable, no asumido).
- Tests: 197/197 sin cambio de aserciones (red de regresión).
