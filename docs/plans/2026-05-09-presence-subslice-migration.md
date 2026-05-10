# Plan — Migración del sub-slice `discussions/presence/`

**Fecha:** 2026-05-09
**Estado:** Pendiente de aprobación
**Owner:** Maxi
**Origen:** Item out-of-scope del fix de presence (commit `1bba053`). Sub-slice `presence/` quedó parcialmente cableado desde refactors previos; el bug de presence forzó duplicar `thread-presence.tsx` en ambas copias defensivamente. Esta migración cierra la deuda.

---

## 0. Estado verificado (auditoría 2026-05-09)

### 0.1 Inventario presence en `discussions/`

**Sub-slice nuevo `discussions/presence/`** — existe, parcialmente cableado:

| Archivo                                   | LOC | Cableo                                                                                                                                                                                                       |
| ----------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `presence/public.ts`                      | 16  | exporta `DwellTracker`, `PostReadersBlock`, `PostUnreadDot`, `ReaderStack`, `ThreadPresence`, `markPostReadAction`                                                                                           |
| `presence/public.server.ts`               | 19  | exporta `findOrCreateCurrentOpening`, `fetchCommentCountByPostId`, `fetchLastReadByPostId`, `fetchReadersSampleByPostId`, `listReadersByPost`, `PostReader`                                                  |
| `presence/server/place-opening.ts`        | 119 | **idéntico byte-a-byte** a `discussions/server/place-opening.ts`                                                                                                                                             |
| `presence/server/queries/post-readers.ts` | 176 | superset funcional: agrupa `listReadersByPost` + 3 helpers privatizados en legacy + tipo `PostReader` exportable; difiere de legacy en que esos 3 helpers son `export` (legacy son `function` no exportadas) |
| `presence/server/actions/reads.ts`        | 101 | difiere del legacy SOLO en una línea: `import { resolveActorForPlace } from '@/features/discussions/server/actor'` (legacy usa `'../actor'`). Lógica idéntica.                                               |
| `presence/ui/dwell-tracker.tsx`           | 109 | difiere SOLO en `import { DWELL_THRESHOLD_MS } from '@/features/discussions/domain/invariants'` (legacy `'../domain/invariants'`)                                                                            |
| `presence/ui/post-readers-block.tsx`      | 45  | difiere SOLO en `import type { PostReader } from '@/features/discussions/presence/server/queries/post-readers'` (legacy `'../server/queries'`)                                                               |
| `presence/ui/post-unread-dot.tsx`         | 32  | byte-a-byte idéntico a legacy                                                                                                                                                                                |
| `presence/ui/reader-stack.tsx`            | 72  | difiere SOLO en `import type { ReaderForStack } from '@/features/discussions/domain/types'` (legacy `'../domain/types'`)                                                                                     |
| `presence/ui/thread-presence.tsx`         | 133 | difiere del legacy en 2 comentarios (referencia cruzada al otro archivo). Lógica byte-a-byte idéntica incluyendo el fix `post:<id>:presence` del commit `1bba053`                                            |

**Total sub-slice:** 795 LOC prod (`scripts/lint/check-slice-size.ts`).

**Tests sub-slice (`presence/__tests__/`)** — 6 archivos, todos clones del legacy con un import cambiado:

| Test sub-slice                 | vs. legacy `discussions/__tests__/`                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dwell-tracker.test.tsx`       | byte-a-byte idéntico                                                                                                                                |
| `place-opening.test.ts`        | byte-a-byte idéntico                                                                                                                                |
| `list-readers-by-post.test.ts` | difiere en 1 línea (`from '@/features/discussions/presence/server/queries/post-readers'` vs `'../server/queries'`)                                  |
| `post-readers-block.test.tsx`  | difiere en 1 línea (import del componente migrado al sub-slice)                                                                                     |
| `reader-stack.test.tsx`        | difiere en 1 línea (import del componente migrado al sub-slice)                                                                                     |
| `post-event-relation.test.ts`  | difiere en 1 línea — pero apunta a `posts/public.server` (NO a presence). **Test mal ubicado**; debería vivir en `posts/__tests__/`. Flag F1 abajo. |

**Legacy presence en `discussions/ui/`** — TODAVÍA wireado por `discussions/public.ts`:

| Archivo legacy                         | Wireado por                                                                                                                                                                         | Sigue ahí porque                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ui/thread-presence.tsx` (132 LOC)     | `public.ts:131` re-exporta vía `thread-presence-lazy.tsx`                                                                                                                           | Es la copia que entra al runtime hoy |
| `ui/thread-presence-lazy.tsx` (70 LOC) | `public.ts:131` `ThreadPresenceLazy as ThreadPresence`                                                                                                                              | Wrapper `React.lazy` post-FCP        |
| `ui/dwell-tracker.tsx` (108 LOC)       | `public.ts:120`                                                                                                                                                                     | Cableo principal                     |
| `ui/post-readers-block.tsx` (45 LOC)   | `public.server.ts:73`                                                                                                                                                               | Cableo principal                     |
| `ui/post-unread-dot.tsx` (32 LOC)      | `public.ts:121`                                                                                                                                                                     | Cableo principal                     |
| `ui/reader-stack.tsx` (72 LOC)         | NINGÚN consumer `@/features/discussions/...` lo usa hoy. Solo `featured-thread-card.tsx` y `thread-row.tsx` legacy (no wireados por `public.ts`) lo importan. **Es código muerto**. |

**Legacy presence en `discussions/server/`** — TODAVÍA wireado por `public.server.ts`:

| Archivo legacy                               | Wireado                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `server/place-opening.ts` (119 LOC)          | `public.server.ts:65` `findOrCreateCurrentOpening`                    |
| `server/queries.ts` (545 LOC, multi-dominio) | `public.server.ts:39-50` `listReadersByPost` + Posts/Comments queries |
| `server/actions/reads.ts` (101 LOC)          | `public.ts:103` `markPostReadAction`                                  |

**Legacy tests duplicados:**

- `discussions/__tests__/dwell-tracker.test.tsx`
- `discussions/__tests__/place-opening.test.ts`
- `discussions/__tests__/post-readers-block.test.tsx`
- `discussions/__tests__/reader-stack.test.tsx`
- `discussions/__tests__/list-readers-by-post.test.ts`
- `discussions/__tests__/reactions-reads.test.ts` (mixto: `reactAction` + `markPostReadAction`)

### 0.2 Consumidores externos al slice

| Caller                                                                | Importa                                                           | De                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------- |
| `(gated)/conversations/[postSlug]/_thread-content.tsx`                | `DwellTracker, ThreadPresence`                                    | `discussions/public`        |
| `(gated)/conversations/[postSlug]/_comments-section.tsx`              | `PostReadersBlock, findOrCreateCurrentOpening, listReadersByPost` | `discussions/public.server` |
| `(gated)/library/[categorySlug]/[itemSlug]/_library-item-content.tsx` | `DwellTracker, ThreadPresence`                                    | `discussions/public`        |
| `(gated)/library/[categorySlug]/[itemSlug]/_comments-section.tsx`     | `PostReadersBlock, findOrCreateCurrentOpening, listReadersByPost` | `discussions/public.server` |
| `(gated)/layout.tsx`                                                  | `findOrCreateCurrentOpening`                                      | `discussions/public.server` |

(5 callers externos. Otros internos al slice — `threads/`, `reactions/`, `posts/` — ya migraron al sub-slice.)

### 0.3 LOC del slice raíz

```
discussions (raíz, descontando sub-slices)  6811 LOC  (cap 1500 — viola)
discussions/presence                          795 LOC  (cap 1500 — OK)
```

**Estimado de bajada del raíz post-migración:** entre -260 y -679 LOC. **Esta migración no cierra la excepción de tamaño** (el raíz queda en ~6132-6551). Posts/Comments cleanup de `server/queries.ts` queda como deuda separada.

### 0.4 Flags abiertos (decisión del owner)

- **F1.** `presence/__tests__/post-event-relation.test.ts` testea `findPostById/findPostBySlug` de `posts/public.server` — está geográficamente mal ubicado. **Decisión:** mover en sesión follow-up con scope Posts. NO en este plan.
- **F2.** `presence/server/queries/post-readers.ts` exporta 3 helpers privados que solo `posts/server/queries/posts.ts` consume cross-sub-slice. Decisión sobre desacoplar (DI vs export directo) queda para `posts/`.
- **F3.** Bundle size del lazy `thread-presence` puede romperse si webpack reorganiza chunks — verificar con `ANALYZE=true pnpm build` antes/después de A.2.
- **F4.** Mientras la migración no se cierre (A→B), cualquier sesión que toque presence debe actualizar AMBAS copias (legacy + sub-slice). Riesgo activo de drift.

---

## 1. Objetivo

**Sustantivo:** los Server/Client Components y la action de presence viven solo en `discussions/presence/`. La API pública del slice (`discussions/public.ts` + `discussions/public.server.ts`) re-exporta desde el sub-slice (no se rompe el contrato externo).

**Adjetivos no negociables:** zero downtime, tests verdes en cada commit, equivalente bundle (chunk lazy preservado), reversible commit-a-commit.

**Fuera de scope:**

- Migración del legacy `server/queries.ts` que cubre Posts/Comments.
- Cleanup de los archivos `discussions/ui/*-thread*`/`*comment*`/`*composer*` ya duplicados.
- Fix de la race secundaria de `viewer.displayName` en `useEffect` de ThreadPresence.
- Cleanup de logs `DEBUG TEMPORAL` (en `docs/pre-launch-checklist.md`).

---

## 2. Estrategia (resumen)

3 fases / 5 sub-fases / cada una commit autosuficiente:

- **Fase A — Re-wire (2 sub-fases):** apuntar `discussions/public.ts` y `public.server.ts` a `presence/`. No se borra nada. No-op semántico (ambas copias son idénticas).
- **Fase B — Eliminación legacy (2 sub-fases):** borrar archivos legacy de presence + tests duplicados.
- **Fase C — Docs (1 sub-fase):** actualizar ADRs/gotchas afectados.

Orden por riesgo creciente. Si algo falla, revert solo de la sub-fase actual.

---

## 3. Sub-fases

### A.1 — Re-wire de `discussions/public.server.ts` a `presence/public.server`

**Archivos:** `discussions/public.server.ts`, `discussions/server/queries.ts` (eliminar exports presence-related).

**Verificación:** `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm test --run tests/boundaries.test.ts`.

**Rollback:** revert.

### A.2 — Re-wire de `discussions/public.ts` + preservar lazy chunk

**Decisión a tomar:**

- **Opción 1 (cohesión completa):** mover `thread-presence-lazy.tsx` al sub-slice. Cambia shape de `presence/public.ts` (exporta lazy en lugar del real).
- **Opción 2 (mínimo cambio):** dejar `thread-presence-lazy.tsx` en raíz; importar el real desde `presence/public`.

**Recomendación:** Opción 1, validando con `grep` que nadie externo a `presence/` importa el ThreadPresence real desde `presence/public`.

**Verificación:** typecheck + lint + tests + `ANALYZE=true pnpm build` con comparación de chunks vs baseline.

**Smoke manual obligatorio en preview:** abrir thread → verificar Network tab que el chunk presence baja post-FCP, console sin `cannot add presence callbacks`, markPostReadAction dispara tras 5s. Repetir en library.

### B.1 — Borrar legacy server/ + tests legacy server-related

**Borrar:** `discussions/server/place-opening.ts`, `discussions/server/actions/reads.ts`, `__tests__/place-opening.test.ts`, `__tests__/list-readers-by-post.test.ts`, `__tests__/reactions-reads.test.ts` (verificar drift vs sub-slice antes).

**Editar:** `discussions/server/queries.ts` — quitar `listReadersByPost` y `PostReader`. **Cuidado** con los 3 helpers privados que `listPostsByPlace` legacy puede seguir usando — verificar grep antes de borrarlos.

**Verificación:** typecheck + tests + `pnpm tsx scripts/lint/check-slice-size.ts` (debe mostrar bajada de ~220-300 LOC).

### B.2 — Borrar legacy ui/ + tests UI

**Borrar:** `discussions/ui/{dwell-tracker,post-readers-block,post-unread-dot,reader-stack,thread-presence,thread-presence-lazy}.tsx`, `__tests__/{dwell-tracker,post-readers-block,reader-stack}.test.tsx`.

**Verificación crítica antes de borrar `reader-stack.tsx`:** `grep -rn "from './reader-stack'\|from '\\.\\./ui/reader-stack'" src/features/discussions`. Si hay consumers en legacy `featured-thread-card.tsx`/`thread-row.tsx`/`post-list.tsx`, son código muerto wireado por nada — borrar también (cleanup oportunista, mencionar en commit).

**Verificación:** typecheck + tests + `ANALYZE=true pnpm build` (chunks comparables).

### C — Documentación + verificación final

**Tocar:**

- `docs/decisions/2026-04-20-discussions-size-exception.md` — actualizar tabla LOC + nota de pendientes.
- `docs/decisions/2026-05-09-realtime-presence-topic-split.md` § "Consecuencias" — borrar bullets sobre duplicación temporal.
- `docs/gotchas/supabase-channel-topic-collision.md` § "Fix aplicado" — borrar mención al archivo legacy.
- `members/ui/resend-invitation-button.tsx` (línea 18) — actualizar comentario apuntando a la ruta nueva.
- `src/features/discussions/presence/README.md` (nuevo, opcional) — 1 página describiendo el sub-slice.

**No requerido:** ADR nuevo (cubierto por `2026-05-04-library-root-sub-split-and-cap-enforcement.md` + `2026-05-08-sub-slice-cross-public.md`).

---

## 4. Riesgos integrales

| Riesgo                                                                  | Probabilidad                | Impacto | Mitigación                                                                     |
| ----------------------------------------------------------------------- | --------------------------- | ------- | ------------------------------------------------------------------------------ |
| Chunk lazy `thread-presence` se rompe                                   | media                       | alto    | `ANALYZE=true pnpm build` antes/después de A.2; rollback si crece >5 kB        |
| Bug de presence regresiona                                              | baja                        | alto    | Smoke manual en preview tras A.2 + B.2; tests RLS `helpers-realtime.test.ts`   |
| Drift entre copias mientras la migración está en limbo                  | alta (mientras dura A)      | medio   | Cerrar A→B en sesiones consecutivas; máximo 2 semanas de limbo                 |
| `server-only` import escapa al cliente                                  | baja                        | alto    | Test `boundaries.test.ts` enforce; build falla loud                            |
| Borrar helpers privados de `queries.ts` rompe `listPostsByPlace` legacy | media (B.1 si no se valida) | alto    | Verificar con grep antes de borrar; si sigue usado, dejar para migración Posts |
| Tests legacy con cobertura mayor que sub-slice                          | baja                        | medio   | Diff antes de borrar; portar casos faltantes                                   |

---

## 5. Test plan integral (cierre)

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts tests/rls/helpers-realtime.test.ts tests/rls/post-read.test.ts
ANALYZE=true pnpm build
# CI: pnpm e2e si hay
```

**Verificaciones grep:**

```bash
# Nada externo importa legacy
grep -rn "from '@/features/discussions/ui/dwell-tracker\|from '@/features/discussions/ui/thread-presence\|from '@/features/discussions/ui/post-readers-block\|from '@/features/discussions/ui/post-unread-dot\|from '@/features/discussions/ui/reader-stack\|from '@/features/discussions/server/place-opening\|from '@/features/discussions/server/actions/reads" src tests
# Esperado: 0

# Nada externo a presence importa internals
grep -rn "from '@/features/discussions/presence/ui\|from '@/features/discussions/presence/server\|from '@/features/discussions/presence/__tests__" src tests | grep -v "discussions/presence/"
# Esperado: 0

# LOC bajó
pnpm tsx scripts/lint/check-slice-size.ts
# Esperado: discussions raíz < 6300 LOC (vs 6811 baseline)
```

**Smoke manual en preview deploy:**

1. `/conversations/<post>` con DevTools — sin `cannot add presence callbacks`, dwell tracker dispara markPostReadAction tras 5s, presence chunk no eager.
2. `/library/<cat>/<item>` — idem.
3. Thread abierto en dos tabs — avatares aparecen en cada tab.
4. Cambio a otra tab por 6s y volver — dwell tracker pausa y reanuda.

---

## 6. Cronograma sugerido

- **Sesión 1** (1-2h): A.1 + A.2 (re-wire). Merge a main si verde + smoke OK.
- **Sesión 2** (1-2h): B.1 + B.2 (borrar legacy). Merge.
- **Sesión 3** (30 min): C (docs). Merge.

Total ~4-5h efectivas. Ventana entre sesiones puede ser días sin riesgo (Fase A es no-op semántico).
