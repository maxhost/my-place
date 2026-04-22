# `DwellTracker` usa `useTransition`, no `useMutation`

**Fecha:** 2026-04-24
**Milestone:** Fase 5 / C.F (realtime presencia + dwell tracker + dot indicator + opening lifecycle)
**Autor:** Max

## Contexto

El plan aprobado de C.F (`.claude/plans/gleaming-chasing-comet.md`) especificaba que
`DwellTracker` invocaría `markPostReadAction` vía `useMutation` de **TanStack Query**
(documentado en `docs/stack.md:20` como parte del stack oficial). El rationale del
plan: retry policy, dedupe y devtools gratis.

Durante la implementación se detectó que **no existe un `QueryClientProvider` montado
en el root layout**. El resto del slice `discussions` (composer, reactions, load-more)
invoca server actions vía `useTransition` directo, sin `useMutation`. Agregar
`QueryClientProvider` como parte de C.F implicaba:

1. Modificar `src/app/layout.tsx` para montar el provider.
2. Crear/importar un `QueryClient` con config (stale time, retry defaults, etc.).
3. Tocar 0 archivos más (el resto del slice no lo necesita), es decir, se sumaría
   bundle + setup solo para este único componente.

## Decisión

`DwellTracker` usa `useTransition` + `server action` directo, consistente con el resto
del slice.

- `startTransition(() => void markPostReadAction(...).catch(silenceKnownErrors))`
- Silencia `OutOfHoursError` y `NotFoundError` inline (race inofensiva).
- Resto de errores: `console.error` (no UI — el componente es invisible).
- **No** hay retry automático. El `retry: false` explícito del plan ya no aplica;
  el comportamiento sin retry es el default de `useTransition`.
- Tras `firedRef.current = true`, el tracker no reintenta. `PostRead` es idempotente
  por `(postId, userId, placeOpeningId)` y el próximo mount (navegación de vuelta)
  vuelve a contar.

## Rationale

1. **Consistencia del slice.** Composer, reactions y load-more ya usan `useTransition`.
   Introducir `useMutation` solo en `DwellTracker` sería un camino divergente sin
   beneficio proporcional.
2. **Scope creep evitado.** Montar `QueryClientProvider` global es una decisión
   arquitectónica que merece su propio prompt/discussion, no un side-effect de C.F.
3. **Sin pérdida funcional.** El dwell tracker no necesita retry, dedupe ni devtools:
   corre una vez por mount, no tiene estado en el client (firedRef es un boolean), y
   el caller se desmonta con el page.

## Cuándo revisitar

Esta decisión se revisa cuando el stack agregue su primer cliente real de TanStack
Query (p.ej. panel de moderación con listado paginado que se beneficie de caching).
En ese momento:

- Se monta `QueryClientProvider` en `src/app/layout.tsx` como parte de esa feature.
- Se evalúa si `DwellTracker` gana algo migrando.
- Se actualiza `docs/stack.md` para reflejar el nuevo uso real (hasta entonces,
  `docs/stack.md:20` nombra TanStack Query aspiracionalmente pero no es load-bearing).

## Archivos afectados

- `src/features/discussions/ui/dwell-tracker.tsx` — implementación con `useTransition`.
- `src/features/discussions/__tests__/dwell-tracker.test.tsx` — test sin wrapper de
  `QueryClientProvider`; solo `vi.useFakeTimers()` + clock inyectable.
