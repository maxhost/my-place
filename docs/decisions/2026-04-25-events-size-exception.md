# Excepción de tamaño para el slice `events`

**Fecha:** 2026-04-25
**Milestone:** Fase 6 / F.A (spec-first del slice events)
**Autor:** Max

## Contexto

`CLAUDE.md` fija tres límites no cosméticos:

- **Archivos:** ≤ 300 líneas
- **Funciones:** ≤ 60 líneas
- **Feature completa:** ≤ 1500 líneas

El slice `events` está planificado en `~/.claude/plans/tidy-stargazing-summit.md` con sub-fases F.B–F.E. Las estimaciones por sub-fase suman:

| Sub-fase | Deliverable                                               | LOC estimado            |
| -------- | --------------------------------------------------------- | ----------------------- |
| F.B      | Schema + 2 migrations + RLS + 9 tests RLS                 | ~150 SQL + ~300 tests   |
| F.C      | Domain + queries + 4 actions + extensiones PR-1/PR-2/PR-3 | ~1100 code + ~600 tests |
| F.D      | UI listado + detalle + crear + editar + Playwright smoke  | ~700 code               |
| F.E      | RSVP flow + auto-thread tx + integración bidireccional    | ~400 code               |

**Total estimado del slice `events/`** (sin tests externos en `tests/rls/`, `tests/e2e/`): ~1100 + ~700 + ~400 = **~2200 LOC** sólo en `src/features/events/`. Si sumamos los `__tests__` co-localizados (~600 LOC), llegamos a **~2800 LOC totales del slice**, ~1.9× el cap de 1500.

Adicionalmente:

- Algunos archivos pueden superar 300 LOC individuales: `domain/types.ts` (3 entidades + enums + types derivados), `server/actions/create.ts` (auto-thread tx + validación + error handling), `ui/event-form.tsx` (4 estados RSVP + 7+ campos input + react-hook-form + Zod refinement client).

## Decisión

**Se acepta la excepción** para el slice `events` con los límites vigentes, documentada en este archivo. No se divide en sub-slices por ahora.

## Razones

1. **Densidad inherente del dominio.** Events cubre 3 entidades (`Event`, `EventRSVP`, enum `RSVPState`), 4 sub-fases de UI (listado, detalle, crear, editar), RSVP texturado con 4 estados + textfield condicional + visibility rules diferenciadas (público vs privado), auto-thread tx con discussions, integración con 4 slices vecinos (discussions, members, hours, flags), y algoritmo de momentos (estado derivado próximo/happening/pasado/cancelado). No hay otra entidad del MVP con esa amplitud post-discussions.

2. **Romper en sub-slices rompería el paradigma.** Separar `events/rsvp/` como slice hermano obliga a exportar API pública para algo que no tiene sentido independiente — los RSVPs no existen sin Event. La regla "features sólo se comunican por `public.ts`" se volvería ruido (events tendría que exportar `getEventForRsvp` para que rsvp lo importe; rsvp tendría que exportar mapping para que events lo importe). Acoplamiento intra-slice es OK, acoplamiento inter-slice no.

3. **El cap del `public.ts` está bajo control.** La superficie externa del slice (`public.ts` + `public.server.ts`) sigue acotada — ~120 LOC entre ambos según estimación. El volumen interno no afecta consumo inter-slice.

4. **Los archivos > 300 LOC tienen justificación puntual:**
   - `server/actions/create.ts`: orchestación de tx atómica con discussions + validación + revalidate paths múltiples. Dividir por sub-flow rompe la atomicidad lógica de "crear evento es 1 operación, no 3".
   - `domain/types.ts`: define `Event` + `EventRSVP` + `RSVPState` + `EventState` + types derivados (`EventListView`, `EventDetailView`, `EventRsvpListView`). Mantener el contrato del dominio en un sólo archivo permite que `public.ts` re-exporte lineal sin múltiples imports.
   - `ui/event-form.tsx`: 7+ inputs (title, description TipTap, startsAt, endsAt, timezone, location, description) + react-hook-form + Zod refinement. Cualquier split (form-fields/form-shell) duplica el contrato del input shape.

5. **Funciones por debajo del cap de 60 líneas.** El single-function cap NO se viola en ningún lugar planeado. Cada action (`createEvent`, `updateEvent`, `cancelEvent`, `rsvpEvent`) se mantiene < 60 LOC delegando en helpers cortos (validación, mapping, revalidate). El orchestrator de la tx atómica en `create.ts` se factorea explícitamente para no superar 60.

## Cuándo revisar

Revisar esta excepción al cerrar:

- **F.D** (UI completa): la suma real de `ui/` (event-form + event-detail + rsvp-button + rsvp-list + event-list + cancellation-badge) puede acercarse a 800 LOC. Evaluar si conviene sub-directorios `ui/list/`, `ui/detail/`, `ui/form/` para legibilidad — sin que eso sea un sub-slice ni romper boundary.
- **F.E** (RSVP + auto-thread): si el orchestrator de `create.ts` supera 80 LOC (+ helpers > 60), considerar mover `buildEventThreadIntroBody` a `events/server/thread-intro.ts` como módulo aparte.
- **Post-F.E** evaluación final: si el slice supera 3000 LOC totales (50% sobre la estimación), considerar split de `rsvp/` en sub-directorio interno (`server/rsvp/`, `domain/rsvp/`, `ui/rsvp/`) mantenido el slice unificado pero con mejor organización por capa.

## No aplica

Esta excepción **no** autoriza:

- Subir el cap general de `CLAUDE.md` — sigue siendo 1500 por feature, 300 por archivo.
- Excepciones en otras features sin su propio registro en `docs/decisions/`.
- Funciones > 60 líneas en cualquier lugar.
- Acoplamiento inter-slice por fuera de `public.ts` / `public.server.ts`.
- Tests `__tests__` agrupados en archivos > 300 LOC sin justificación.

## Referencias

- `CLAUDE.md` § Límites de tamaño
- `docs/decisions/2026-04-20-discussions-size-exception.md` — precedente con razonamiento similar
- `docs/features/events/spec.md` — spec canónico
- `docs/features/events/spec-rsvp.md` — sub-spec RSVP
- `docs/features/events/spec-integrations.md` — sub-spec integraciones
- Plan F.A: `~/.claude/plans/tidy-stargazing-summit.md` (sección "Sub-milestones detallados" con estimación LOC)
