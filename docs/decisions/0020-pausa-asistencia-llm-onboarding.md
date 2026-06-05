# 0020 — Pausa de la asistencia LLM propose-only en el onboarding del MVP

> **Refinada por ADR-0051 (2026-06-05, Phase 3.A):** la **pausa del MVP sigue vigente** (la asistencia LLM no se reactiva todavía), pero el stance de futuro cambia — esta ADR §16/§54 señalaba que el LLM "probablemente no se reactive en el corto plazo"; ADR-0051 lo convierte en **reactivación comprometida a V1.3** con plan de reconstrucción documentado. La saga + Server Action + dominio siguen dormidos y testeados; la dep `ai@^6.0.185` se mantiene deliberadamente. La ADR que reactive efectivamente el slice en V1.3 reemplaza a ésta en su totalidad.

- **Fecha:** 2026-05-19
- **Estado:** Aceptada
- **Alcance:** producto (onboarding), arquitectura (slice `style-assist`), i18n (drop 11 keys), tests (drop integration de la isla)
- **Pausa:** ADR-0005 §5 (asistencia LLM en el onboarding), ADR-0007 (LLM no propone horario — queda sin objeto), ADR-0019 §"UI glue propia" (la UI glue se elimina; el slice queda con saga + Server Action dormidos)
- **No supersede:** ADR-0015 (el slice `style-assist` SIGUE EXISTIENDO; sólo se reduce su scope a saga + Server Action + dominio; la motivación arquitectónica acíclica sigue válida)
- **Relacionada:** misma ADR cubre la remoción del campo "Descripción" del wizard (la columna `place.description` permanece nullable en DB — forward-compat para `/settings` futuro, mismo patrón que `opening_hours` por ADR-0007)

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

La asistencia LLM propose-only del onboarding (ADR-0005 §5 / ADR-0007 / ADR-0015 / ADR-0019) tenía como objetivo que el LLM propusiera al owner una paleta + un borrador de descripción a partir de una "descripción de para quién es el lugar" — siempre propose-only (humano confirma; nada se auto-aplica) para respetar el principio de `producto.md` §30 "Customización activa, no algorítmica".

Al momento del corte del MVP, la asistencia **no estaba funcional** en el entorno de preview (la integración no producía propuestas, lo que dejaba el botón en estado `unavailable`). Aún si funcionara, su valor proporcional al diseño del onboarding es bajo: el owner ya tiene presets curados (Papel/Bosque/Tinta/Arcilla) + modo "Personalizado" con 3 hex configurables — opciones suficientes para arrancar el lugar con identidad propia. La presencia de la isla agrega:

- Un botón visualmente cargado en el Paso 2 que distrae del segmented control (que es el flujo principal).
- 11 keys i18n (`assistButton`, `assistLoading`, `assistNeedDescription`, `assistUnavailable`, `assistProposedTitle`, `assistProposedHint`, `assistPaletteLabel`, `assistDescriptionLabel`, `assistApplyPalette`, `assistApplyDescription`, `assistApplied`) a mantener traducidos al sumar locales.
- ~210 LOC de UI glue (hook `use-style-assist`, componente `style-assist-island`, contrato `StyleAssistLabels`) en el repo + ~10 tests integration en el wizard.
- Una dependencia activa cross-slice (`place-wizard` → `style-assist`) que requería razonamiento extra para mantener el grafo acíclico (ADR-0019).

Decidimos pausar la asistencia en el MVP y reducirla al **mínimo dormido recuperable**: la saga + Server Action + dominio (que ya están testeados — `__tests__/suggest-style.test.ts`) quedan en el slice `style-assist` por si el ROI cambia y se reactiva en una versión futura. Eso preserva el trabajo invertido sin contaminar el repo con UI zombi.

El campo "Descripción del lugar" del Paso 2 también se retira en el mismo movimiento: era el input que alimentaba al LLM y, sin asistencia, queda como un campo opcional sin valor en el alta (el lugar nace usable sin descripción; la edición se difiere a `/settings` futuro — mismo patrón que ADR-0007 §3 con `opening_hours`). La columna `place.description TEXT` permanece nullable en DB; no se requiere migration.

## Decisión

1. **Ocultar la isla LLM del wizard.** Las rutas `(marketing)/[locale]/crear` y `(marketing)/[locale]/login` dejan de cablear `onSuggest={suggestStyleAction}` y eliminan los 11 keys i18n de `assist*` del `labels` que pasan al `<PlaceWizard>`. El componente `StyleAssistIsland` se elimina del wizard junto con su renderizado condicional en `wizard-steps.tsx`. El hook `useStyleAssist` se elimina del cableado del orquestador `use-place-wizard.ts` (el wrapper `setPaletteMode` se simplifica y el cruce con `resetPaletteApplied` desaparece).

2. **Eliminar la UI glue del slice `style-assist`** (`git rm`):
   - `src/features/style-assist/use-style-assist.ts`
   - `src/features/style-assist/style-assist-island.tsx`
   - `src/features/style-assist/labels.ts`
   - `src/features/place-wizard/__tests__/style-assist-island.test.tsx` (test integration del wizard renderizando la isla — sin consumer queda sin objeto; se eliminó en el commit anterior, ver ADR-0020 commit 2).

3. **Preservar la saga + Server Action + dominio del LLM** como código **dormido y testeado**:
   - `src/features/style-assist/suggest-style.ts` (la saga)
   - `src/features/style-assist/suggest-style-action.ts` (el Server Action)
   - `src/features/style-assist/domain/style-suggestion.ts` (el dominio)
   - `src/features/style-assist/__tests__/suggest-style.test.ts` (tests del dominio — sigue verde)
   - El `public.ts` del slice sigue exportando `suggestStyleAction`, `StyleSuggestion`, `StyleSuggestionResult`, `SuggestStyle` — sin consumer activo de producción, pero disponible para una reactivación rápida.

4. **Reducir `WizardLabels`**: ya no extiende `StyleAssistLabels` (que se eliminó); el key `guardrailNotice` queda explícito en `WizardLabels` (su dueño semántico real — lo consumen `place-preview` y `wizard-success` cuando el guardrail de contraste ajusta un color de cualquier paleta, no sólo de la LLM). El tipo `WizardSuggest` se elimina (era alias del `SuggestStyle` del slice LLM).

5. **Quitar el campo "Descripción" del wizard** (commit anterior del mismo ADR): drop textarea + validación + 4 keys i18n + payload (`buildInputCore` ya no envía `description`; el Zod schema acepta `undefined` y la DB queda con `null`). La columna `place.description TEXT` permanece — `docs/data-model.md` la marca como "dormida pero presente" (forward-compat para `/settings`).

6. **`producto.md` §30** se actualiza para reflejar que el MVP no tiene asistencia LLM en el onboarding: la nota original sobre el LLM propose-only (que afirmaba la asistencia como complemento del principio "Customización activa, no algorítmica") se reemplaza por una nota que cita ADR-0020 y aclara que el diseño LLM queda en histórico, reactivable cuando se justifique.

7. **Las ADRs afectadas reciben banners** en su encabezado: ADR-0005 §5 (Pausada parcialmente), ADR-0007 (Pausada — queda sin objeto), ADR-0019 (Pausada parcialmente — UI glue eliminada), ADR-0015 (Refinada — scope reducido). Las ADRs son históricas y no se editan en su contenido; el banner indica el estado de vigencia.

## Alternativas rechazadas

- **(A) Dejar la isla LLM oculta tras un feature flag.** Agregaría una rama no-default en el código + complejidad de flag management para una funcionalidad que probablemente no se reactive en el corto plazo. Rechazada: prefiere claridad ("está pausada y documentada") sobre opcionalidad oculta. La reactivación se hace con una nueva ADR + recuperar archivos del git history.

- **(B) Eliminar el slice `style-assist` completo** (incluyendo saga + Server Action + dominio + tests). Cero zombi en el repo, máxima limpieza. Rechazada porque (i) la saga + Server Action son código de calidad ya validado por tests; (ii) eliminarlos significaría reconstruirlos desde cero si se reactiva el LLM, vs. sólo reconstruir UI glue (mínima); (iii) el slice acíclico que justifica ADR-0015 sigue siendo válido arquitectónicamente — sólo se reduce su scope.

- **(C) Mantener la isla LLM intacta y "mejorar" la integración** para que funcione en preview. El problema de fondo no es bug sino ROI: aún funcionando, el botón LLM no aporta valor proporcional a su carga visual + complejidad en el flujo principal del onboarding (presets + custom hex ya cubren el caso). Rechazada.

- **(D) Mantener el campo descripción del wizard "sólo para el LLM oculto en el futuro".** Rechazada: deja una caja en blanco sin propósito visible en el MVP. Sin el LLM, la descripción es un campo libre que tendría que justificar su lugar — y la decisión clara es que para el MVP no aporta. La columna en DB queda nullable y forward-compat para `/settings` (ADR-0007 §3 patrón).

## Consecuencias

- **place-wizard slice baja ~50 LOC** (Commit 2: descripción) + **~40 LOC** adicionales (Commit 3: isla LLM cableado/wrapper) = ~1346 LOC (margen sano bajo 1500).
- **style-assist slice baja ~236 LOC** (UI glue eliminada) — queda en ~206 LOC (saga + Server Action + dominio + public.ts).
- **Tests bajan ~10** (los integration de la isla; los del dominio LLM siguen verdes).
- **i18n baja 15 keys** (4 de descripción + 11 de assist*) en `es.json`. `guardrailNotice` se mantiene (consumer activo en preview/success).
- **Grafo acíclico revalidado**: `grep -rn 'from "@/features/style-assist'` en `src/features/place-wizard/` y en `src/app/` debe devolver vacío (post-Commit 3). El slice `style-assist` queda **sin consumer activo de producción** — su `public.ts` re-exporta el Server Action pero nadie lo llama desde cliente o ruta.
- **Reactivación futura**: cuando `style-assist` se quiera reactivar, será trabajo de una nueva ADR que supersede a ésta — reconstruir UI glue (hook + isla + labels contract) tomando como precedente git history (los archivos eliminados están en `HEAD~N` cuando este commit caiga en main).
- **Columna `place.description TEXT`** permanece nullable y dormida — `data-model.md:57` la documenta con nota explícita "ADR-0020: nullable y *dormida* en el MVP". Sin migration ni cambio de schema.
- **Doc canónico vivo**: `docs/architecture.md` líneas 25, 41 y 78 se editan para reflejar el estado actualizado del onboarding y del slice (architecture.md no es ADR-inmutable, es doc vivo).

## Detalle operativo canónico

- Estado de cada ADR pausada/refinada: ver banner al tope de cada archivo (`0005`, `0007`, `0015`, `0019`).
- Estado vivo del onboarding: `docs/producto.md` §30 ("Customización activa") refleja que no hay LLM en el MVP.
- Estado vivo del slice `style-assist`: header de `src/features/style-assist/public.ts` documenta el código dormido y advierte sobre reactivación.
