# Excepción de tamaño para el slice `discussions`

**Fecha:** 2026-04-20
**Milestone:** Fase 5 / C.E (UI de conversations)
**Autor:** Max

> **Update 2026-05-06:** Tras la migración TipTap → Lexical (`docs/decisions/2026-05-06-tiptap-to-lexical.md`), el AST y schemas Zod del rich-text viven ahora en `src/features/rich-text/` (slice nuevo). El cap 20 KB del documento se mantiene; el shape del AST cambió. Esta excepción de tamaño sigue vigente para la densidad propia de discussions (posts + comments + threads + reads + presence + citas), independiente del rich-text.

> **Update 2026-05-09:** Aplicación del Approach C del plan G.3 port (`docs/plans/2026-05-09-g3-debt-port-to-legacy.md`). Cierre del experimento sub-slice posts/comments/moderation (35 archivos borrados, ADR `2026-05-09-discussions-subslice-experiment-closed.md`). El raíz queda en **6202 LOC** (vs cap 1500 — viola por 4702). B.4 y B.5 cancelados. B.3 (threads consolidation) sigue vigente como follow-up no urgente — el sub-slice `discussions/threads/` es byte-equivalente al legacy y su consolidación bajaría -550 LOC del raíz a ~5650 (sigue 4× sobre el cap). **El cap 1500 no es alcanzable con el dominio actual.** Se acepta excepción permanente con cap mayor autorizado a ser definido cuando B.3 cierre. Tabla de medición actualizada abajo.

## Contexto

`CLAUDE.md` fija tres límites no cosméticos:

- **Archivos:** ≤ 300 líneas
- **Funciones:** ≤ 60 líneas
- **Feature completa:** ≤ 1500 líneas

La medición al cerrar C.E (UI camino feliz del foro) es:

```
feature discussions (sin __tests__):
  domain/         5 archivos
  server/        10 archivos
  ui/            18 archivos
  public.ts       1 archivo
  schemas.ts      1 archivo
  ──────────────────────────────
  total         35 archivos · 4 785 líneas
```

Top de archivos más largos:

| Archivo                      | Líneas |
| ---------------------------- | ------ |
| `server/actions/posts.ts`    | 353    |
| `schemas.ts`                 | 331    |
| `server/queries.ts`          | 297    |
| `domain/types.ts`            | 242    |
| `ui/edit-window-actions.tsx` | 239    |
| `ui/rich-text-editor.tsx`    | 235    |
| `domain/invariants.ts`       | 218    |
| `public.ts`                  | 178    |

Dos archivos superan el cap de 300 (`server/actions/posts.ts` y `schemas.ts`); la feature completa supera el de 1500 por un factor ~3×.

## Decisión

**Se acepta la excepción** para el slice `discussions` con los límites vigentes, documentada en este archivo. No se divide en sub-slices por ahora.

## Razones

1. **Densidad inherente del dominio.** Discussions cubre 6 entidades (`Post`, `Comment`, `Reaction`, `PlaceOpening`, `PostRead`, `Flag`), tres superficies (domain, server, ui), y el rich-text AST (TipTap) que es spec-heavy (schemas, renderer puro-React, editor client). No hay otro slice del MVP con esa amplitud.
2. **Romper en sub-slices rompería el paradigma.** Separar `reactions/` o `flags/` como slices hermanos obliga a exportar API pública y dependencias circulares con `discussions` (lastActivityAt, moderación). La regla "features solo se comunican por `public.ts`" se volvería ruido.
3. **El cap del `public.ts` está bajo control (178 líneas)** — la superficie externa del slice sigue acotada. El volumen interno no afecta consumo inter-slice.
4. **Los dos archivos sobre 300 tienen justificación puntual:**
   - `server/actions/posts.ts` (353): 4 actions (`create/edit/hide/unhide/delete`) + helper de revalidate + slug collision loop + validación de ownership/admin. Dividir por action sería exportar 4 archivos nuevos con el mismo import path — costo > beneficio.
   - `schemas.ts` (331): define el AST TipTap entero con Zod restrictivo (paragraph, heading, bulletList, orderedList, blockquote, codeBlock, text + marks + mention + link). El allowlist debe vivir junto para que el round-trip server↔client use el mismo contrato. Splitting requeriría reexportar y abre drift.
5. **Funciones por debajo del cap de 60 líneas.** El single-function cap no se viola en ningún lugar.

## Cuándo revisar

Revisar esta excepción al cerrar:

- **C.F** (realtime + dwell tracker + dot indicator): sumará ~400–600 líneas en `ui/` y `server/realtime.ts`. Evaluar si el bucket `ui/` justifica ya un `ui/thread/` y `ui/list/` como subdirectorios.
- **C.G** (moderación: flag modal, cola admin, hide/unhide UI): sumará ~500–700 líneas. Evaluar si `flags` debería pasar a su propio slice — candidato fuerte porque tiene página propia (`/settings/flags`) y un RLS/actions distinto.
- Si la feature cruza 6 000 líneas antes de C.G, tratar el split de `flags/` como prioridad.

## Estado a 2026-05-09 (post-G.3 port + cierre sub-slices)

**Medición actual** (output de `pnpm tsx scripts/lint/check-slice-size.ts`):

```
✗  discussions                   6202 / 1500 (-4702)
✓  discussions/presence           872 / 1500 (+628)
✓  discussions/threads            531 / 1500 (+969)
✓  discussions/reactions          368 / 1500 (+1132)
✓  discussions/composers          192 / 1500 (+1308)
```

**Sub-slices consolidados** (`presence`, `reactions`, `composers`) suman **1432 LOC** descontados del raíz.

**Sub-slice orphan vigente:** `threads/` (531 LOC) — sigue sin consumers externos. Plan B.3 (`docs/plans/2026-05-09-threads-subslice-migration.md`) propone consolidación con bajada esperada del raíz -550 LOC. Pendiente de ejecución.

**Sub-slices borrados (cierre del experimento, 2026-05-09):**

- `posts/` (~1004 LOC) — eliminado por drift bidireccional irreconciliable.
- `comments/` (~1354 LOC) — idem.
- `moderation/` (~170 LOC) — orphan adicional limpiado por dependency chain.

Total ~2528 LOC fuera del repo. Detalle en ADR `2026-05-09-discussions-subslice-experiment-closed.md`.

**Pendientes para acercarse al cap (no para cerrarlo — el cap 1500 no es alcanzable):**

- [x] **`presence/`** — cerrado.
- [x] **`reactions/`** — cerrado.
- [x] **`composers/`** — cerrado.
- [x] **`posts/`** — sub-slice eliminado, port G.3 al legacy en su lugar.
- [x] **`comments/`** — sub-slice eliminado, port G.3 al legacy en su lugar.
- [x] **`moderation/`** — sub-slice orphan eliminado.
- [ ] **`threads/`** — pendiente B.3 (-550 LOC esperados).
- [ ] **`server/queries.ts` cleanup** — ya no contiene queries de comments duplicadas. Sigue con queries de posts (-287 LOC eliminables si se hace un `posts/server/queries/` mini-split en el futuro, pero no es urgente).
- [ ] **`server/actions/posts/{create,edit}.ts`** — son los 2 archivos legacy más grandes del raíz. Su split por concern (CRUD vs auditoría) podría bajar otros -200 LOC.

**Estimación de cierre máximo:** post-B.3 + posibles micro-splits = ~5450 LOC en el raíz. **Sigue 3.6× sobre el cap 1500.** Se acepta excepción permanente con cap mayor autorizado (a definir formalmente cuando B.3 cierre o al lanzamiento, lo que ocurra primero).

## No aplica

Esta excepción **no** autoriza:

- Subir el cap general de `CLAUDE.md` — sigue siendo 1500 por feature, 300 por archivo.
- Excepciones en otras features (members, places, hours, billing) sin su propio registro en `docs/decisions/`.
- Funciones > 60 líneas en cualquier lugar.

## Referencias

- `CLAUDE.md` § Límites de tamaño
- `docs/features/discussions/spec.md`
- Plan C.E: `/Users/maxi/.claude/plans/gleaming-chasing-comet.md` (sección "Tamaños" anticipó esta excepción)
