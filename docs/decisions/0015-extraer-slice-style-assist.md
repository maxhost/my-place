# 0015 — Extraer la asistencia LLM a un slice propio `style-assist`

> **Refinada por ADR-0020 (2026-05-19):** el slice `style-assist` sigue existiendo y la motivación arquitectónica (acíclico, slice dueño del concern LLM) sigue válida, pero su scope se reduce a saga + Server Action + dominio (sin UI glue, sin consumer activo). La asistencia LLM del wizard está pausada en el MVP.

- **Fecha:** 2026-05-18
- **Estado:** Aceptada
- **Alcance:** arquitectura (estructura de vertical slices; primitivo de paleta a `shared/`; sin cambio de comportamiento)
- **Cierra:** la deuda estructural abierta al cerrar S10a (slice `place-creation` = 1544 líneas no-test > 1500, límite duro `CLAUDE.md`). No supersede ninguna ADR; refina la materialización física de ADR-0005 §5 / ADR-0007 (asistencia LLM) en un slice propio, mismo precedente que ADR-0014.

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Al cerrar S10a (servicio LLM propose-only, `docs/features/onboarding/plan-sesiones.md`) se midió el slice y se diagnosticó (disciplina `CLAUDE.md`, evidencia reproducible, no hipótesis):

- `src/features/place-creation/` = **1544 líneas no-test > 1500** (límite duro `CLAUDE.md` § Límites / `architecture.md` §37). "Superar un límite = dividir antes de continuar."
- La asistencia LLM (ADR-0005 §5 / ADR-0007) es un **concern cohesivo y separable**: dominio Zod de la propuesta + guardrail + saga pura + Server Action del Gateway. ~160 líneas que no comparten estado con la saga de creación.
- S10b (isla UI en el wizard) sumaría más líneas al mismo slice → reventaría el límite otra vez. Igual situación exacta que S9 → S9.5.

Mismo procedimiento que S9.5: el trabajo funcional de S10a se cerró verde y se commiteó como rollback (`aff661e`), la decisión se elevó al owner (extraer a slice propio) y se ejecuta como **sesión propia ADR-backed (S10a.5) antes de S10b**.

**Grafo de dependencias (diagnóstico, no asumido).** El wizard vive en `place-creation` y consumirá `suggestStyleAction` (S10b) → arista `place-creation → style-assist`. Para que sea **acíclica** (`architecture.md` §25: un ciclo se resuelve extrayendo lo común a `shared/`), `style-assist` NO puede depender de `place-creation`. Hoy `domain/style-suggestion.ts` importa `paletteSchema`/`Palette` de `place-creation/domain/schema.ts`. Dejar esa arista + la del wizar­d formaría un ciclo `place-creation ↔ style-assist` (prohibido). El primitivo común es el schema Zod de paleta hex.

## Decisión

1. **Slice nuevo `src/features/style-assist/`** con su `public.ts` (interfaz pública: `suggestStyleAction`, `StyleSuggestionResult`, `StyleSuggestion`, `SuggestStyle`). Contiene: `domain/style-suggestion.ts` (+test), `suggest-style.ts` (+test), `suggest-style-action.ts` (seam), `ports.ts` (`StyleSuggester`). Movido con `git mv` (preserva historial, precedente S7/S9.5).
2. **Primitivo de paleta a `shared/`** (`src/shared/lib/palette-schema.ts`): `hexColorSchema` + `paletteSchema` + tipo `Palette` (re-usa el `Palette` estructural de `@/shared/lib/contrast`, no se duplica el tipo). `place-creation/domain/schema.ts` y `style-assist/domain/style-suggestion.ts` lo importan de ahí. Resuelve el ciclo por la regla de `architecture.md` §25 (extraer lo común a `shared/`), no por una arista feature→feature.
3. **Arista resultante:** `place-creation → style-assist` (unidireccional, vía `public.ts`, la consumirá S10b); `style-assist` no importa de ninguna feature (solo `shared/`). Acíclica. Segundo ejemplo canónico del patrón de ADR-0014 (el primero: `access → place-creation`).
4. **Refactor puro, sin cambio de comportamiento.** La suite de 179 tests es la red de regresión: debe seguir 179/179 sin cambiar una aserción. `place-creation` vuelve a ~1384 no-test (margen sano); `style-assist` ~160.

## Alternativas rechazadas

- **Dejar `place-creation` en 1544 y recortar comentarios para entrar bajo 1500.** Cosmético sobre un problema estructural; production-minded lo rechaza; S10b lo volvería a reventar. Rechazada.
- **`style-assist` importa `paletteSchema` de `place-creation/public.ts`** (arista feature→feature). Forma un ciclo con la arista wizard→style-assist de S10b (prohibido `architecture.md` §25). Rechazada.
- **Duplicar el schema de paleta en `style-assist`.** Duplicación de un invariante de dominio (formato hex) en dos lugares → drift. Rechazada; se extrae a `shared/` (la regla canónica para lo común entre slices).
- **No partir; meter el LLM dentro de `place-creation` y subir el límite.** Cambiar un límite duro es desvío de `CLAUDE.md`; no se hace en una sesión. Rechazada.

## Consecuencias

- `place-creation` deja de exportar lo de LLM (sus consumidores aún no existen — S10b cablea la ruta; sin retarget externo hoy). `style-assist/public.ts` pasa a ser la única entrada.
- Nuevo módulo `shared/` (`palette-schema.ts`) ≤800 trivialmente; `place-creation/domain/schema.ts` re-exporta `paletteSchema`/`Palette` para sus consumidores internos/tests existentes (sin cambio de comportamiento ni de tests).
- Segunda arista feature→feature del repo (`place-creation → style-assist`, la materializa S10b), unidireccional y acíclica — mismo patrón ADR-0014.
- Deuda estructural de S10a **cerrada**; S10b puede sumar UI sin reventar el límite.
- Sin cambio de comportamiento ni de tests: la suite de 179 es el contrato.

## Detalle operativo canónico

- Estado de sesiones y cierre verde: `docs/features/onboarding/plan-sesiones.md` § S10a.5.
- Paradigma vertical-slice + regla de ciclos: `docs/architecture.md` §11/§21/§25.
- Precedente del patrón (split + arista feature→feature + `git mv`): ADR-0014.
