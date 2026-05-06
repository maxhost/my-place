# Excepción de tamaño para el slice `discussions`

**Fecha:** 2026-04-20
**Milestone:** Fase 5 / C.E (UI de conversations)
**Autor:** Max

> **Update 2026-05-06:** Tras la migración TipTap → Lexical (`docs/decisions/2026-05-06-tiptap-to-lexical.md`), el AST y schemas Zod del rich-text viven ahora en `src/features/rich-text/` (slice nuevo). El cap 20 KB del documento se mantiene; el shape del AST cambió. Esta excepción de tamaño sigue vigente para la densidad propia de discussions (posts + comments + threads + reads + presence + citas), independiente del rich-text.

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

## No aplica

Esta excepción **no** autoriza:

- Subir el cap general de `CLAUDE.md` — sigue siendo 1500 por feature, 300 por archivo.
- Excepciones en otras features (members, places, hours, billing) sin su propio registro en `docs/decisions/`.
- Funciones > 60 líneas en cualquier lugar.

## Referencias

- `CLAUDE.md` § Límites de tamaño
- `docs/features/discussions/spec.md`
- Plan C.E: `/Users/maxi/.claude/plans/gleaming-chasing-comet.md` (sección "Tamaños" anticipó esta excepción)
