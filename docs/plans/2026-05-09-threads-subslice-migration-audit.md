# Auditoría del Plan B.3 — `discussions/threads/` sub-slice migration

**Doc destino:** `docs/plans/2026-05-09-threads-subslice-migration-audit.md`
**Fecha auditoría:** 2026-05-09
**Auditor:** Claude (perspectiva: production-readiness + delegación-paralela + drift-prevention)
**Plan auditado:** `docs/plans/2026-05-09-threads-subslice-migration.md` (813 líneas)
**Estado del repo en el momento:** rama `main`, 18 commits ahead de `origin/main`, 4 commits G.3 mergeados (`860e15a`, `dd42afc`, `875b14b`, `35e0e69`), tip = `35e0e69`.

---

## Sección 1 — Re-auditoría empírica (drift check)

**Premisa central del plan:** sub-slice `discussions/threads/` es byte-equivalente al legacy salvo paths de imports.

### 1.1 Diff actualizado (comando exacto reproducible)

```bash
for f in empty-threads featured-thread-card load-more-posts post-list \
         thread-filter-pills thread-header-bar thread-row threads-section-header; do
  echo "===== $f ====="
  diff src/features/discussions/ui/$f.tsx \
       src/features/discussions/threads/ui/$f.tsx
done
```

**Resultado empírico:**

| Archivo                      | Estado            | Diff observado                                                                                                                       |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `empty-threads.tsx`          | drift=imports     | 1 línea: `'../domain/filter'` → `'@/features/discussions/domain/filter'`                                                             |
| `featured-thread-card.tsx`   | drift=imports     | 4 líneas: paths absolutos + `ReaderStack`/`PostUnreadDot` desde `@/features/discussions/presence/public` (legacy importa local roto) |
| `load-more-posts.tsx`        | drift=imports     | 5 líneas: paths absolutos + `friendlyErrorMessage` desde `@/features/discussions/ui/utils` cross-sub-slice                           |
| `post-list.tsx`              | drift=imports     | 2 líneas (paths)                                                                                                                     |
| `thread-filter-pills.tsx`    | drift=imports     | 4→5 líneas (formato multi-línea del import — legacy 1 línea, sub-slice 5 líneas; **+4 LOC sub-slice**)                               |
| `thread-header-bar.tsx`      | **byte-idéntico** | sin output                                                                                                                           |
| `thread-row.tsx`             | drift=imports     | 4 líneas: paths absolutos + `ReaderStack`/`PostUnreadDot` desde `@/features/discussions/presence/public`                             |
| `threads-section-header.tsx` | **byte-idéntico** | sin output                                                                                                                           |

```bash
diff src/features/discussions/__tests__/thread-filter-pills.test.tsx \
     src/features/discussions/threads/__tests__/thread-filter-pills.test.tsx
# Sin output → byte-idéntico (los dos importan ../ui/thread-filter-pills relativo, cada uno resuelve al suyo).
```

**Veredicto:** la premisa central del plan se sostiene. El sub-slice `threads/` **NO sufrió drift de lógica**; solo difiere en imports (paths absolutos y cross-sub-slice via `presence/public`). El test legacy es byte-idéntico al duplicado del sub-slice. **A diferencia de posts/comments, threads SIGUE siendo viable la consolidación.**

### 1.2 Drift en LOC del raíz (afecta el plan)

```bash
pnpm tsx scripts/lint/check-slice-size.ts
# discussions raíz: 6202 LOC (NO 6176 como dice el plan B.3 línea 19, 27, 173)
```

**Drift detectado:** el plan B.3 fue redactado pre-G.3 port (cuando raíz medía 6176 LOC). Post-merge de los 4 commits G.3 (`860e15a`, `dd42afc`, `875b14b`, `35e0e69`) el raíz subió a **6202 LOC** (+26 LOC: `if hasPermission` + comments). El ADR `2026-05-09-discussions-subslice-experiment-closed.md` línea 82 lo confirma. El ADR `2026-04-20-discussions-size-exception.md` líneas 9 y 73-79 lo confirman dos veces más.

**Implicancia para el plan:**

- LOC accounting de § 2 está obsoleto: post-B.3 quedaría en **5602** (no 5576) si se ejecutan B.3.1-B.3.5 completos.
- Mensajes de commit y ADR addendum (§ C.1) deben citar **6202 → 5602**, no `6176 → 5576`.

### 1.3 Estado de los archivos asociados (`reader-stack`, `post-unread-dot`, `load-more.ts`)

```bash
grep -rn "from '\\./reader-stack'\|from '\\./post-unread-dot'" src tests | grep -v "presence/"
# Salida actual:
#  src/features/discussions/ui/thread-row.tsx:5,6
#  src/features/discussions/ui/featured-thread-card.tsx:5,6
```

Confirmado: post-B.3.4, los únicos consumers de `reader-stack`/`post-unread-dot` legacy desaparecen. **B.3.5 cleanup oportunista válido**.

```bash
grep -n "hasPermission" src/features/discussions/server/actions/load-more.ts
# 8: import; 68 + 108: usos en loadMoreCommentsAction y loadMorePostsAction
```

`load-more.ts` ya tiene G.3 wired (`hasPermission(... 'discussions:hide-post')`). **B.3 NO debe tocar este archivo**.

### 1.4 Verificación de consumers externos

```bash
grep -rn "ThreadHeaderBar\|PostList" src/app | grep "from '@"
# src/app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx:6: ThreadHeaderBar from '@/features/discussions/public'
# src/app/[placeSlug]/(gated)/conversations/page.tsx:5: PostList (junto con parsePostListFilter)
# src/app/[placeSlug]/(gated)/conversations/page.tsx:8: from '@/features/discussions/public.server'
```

Cero consumers externos del sub-slice `threads/public` directamente. Solo el barrel raíz (`public.ts:123` y `public.server.ts:78`) re-exporta. Verificación del plan correcta.

---

## Sección 2 — Mapa de archivos por sub-fase

### Convenciones

- **M** = modificado · **D** = borrado · **C** = creado · **R** = read-only consultado.
- Paths relativos al repo root.

### B.3.1 — Re-wire `public.ts` (ThreadHeaderBar)

| Tipo | Archivo                                                          |
| ---- | ---------------------------------------------------------------- |
| M    | `src/features/discussions/public.ts` (línea 123, cambio 1 línea) |
| R    | `src/features/discussions/threads/public.ts` (verificar export)  |
| R    | `src/features/discussions/threads/ui/thread-header-bar.tsx`      |
| R    | `src/features/discussions/ui/thread-header-bar.tsx`              |
| R    | `src/app/[placeSlug]/(gated)/conversations/[postSlug]/page.tsx`  |

### B.3.2 — Re-wire `public.server.ts` (PostList)

| Tipo | Archivo                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M    | `src/features/discussions/public.server.ts` (línea 78, cambio 1 línea)                                                                               |
| R    | `src/features/discussions/threads/public.ts`                                                                                                         |
| R    | `src/features/discussions/threads/ui/post-list.tsx`                                                                                                  |
| R    | `src/features/discussions/threads/ui/{featured-thread-card,thread-row,empty-threads,thread-filter-pills,threads-section-header,load-more-posts}.tsx` |
| R    | `src/features/discussions/ui/post-list.tsx` (legacy — sigue presente)                                                                                |
| R    | `src/app/[placeSlug]/(gated)/conversations/page.tsx`                                                                                                 |

### B.3.3 — Borrar test legacy + thread-header-bar legacy

| Tipo | Archivo                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| D    | `src/features/discussions/__tests__/thread-filter-pills.test.tsx`                                |
| D    | `src/features/discussions/ui/thread-header-bar.tsx`                                              |
| R    | `src/features/discussions/threads/__tests__/thread-filter-pills.test.tsx` (cobertura preservada) |
| R    | `src/features/discussions/public.ts` (verificar B.3.1 mergeado)                                  |

### B.3.4 — Borrar 7 archivos legacy thread

| Tipo | Archivo                                                                |
| ---- | ---------------------------------------------------------------------- |
| D    | `src/features/discussions/ui/post-list.tsx`                            |
| D    | `src/features/discussions/ui/load-more-posts.tsx`                      |
| D    | `src/features/discussions/ui/threads-section-header.tsx`               |
| D    | `src/features/discussions/ui/thread-filter-pills.tsx`                  |
| D    | `src/features/discussions/ui/empty-threads.tsx`                        |
| D    | `src/features/discussions/ui/featured-thread-card.tsx`                 |
| D    | `src/features/discussions/ui/thread-row.tsx`                           |
| R    | `src/features/discussions/public.server.ts` (verificar B.3.2 mergeado) |
| R    | `src/features/discussions/threads/ui/*` (cobertura preservada)         |

### B.3.5 — Cleanup oportunista (reader-stack + post-unread-dot)

| Tipo | Archivo                                                           |
| ---- | ----------------------------------------------------------------- |
| D    | `src/features/discussions/ui/reader-stack.tsx`                    |
| D    | `src/features/discussions/ui/post-unread-dot.tsx`                 |
| R    | `src/features/discussions/presence/public.ts` (verificar exports) |

### C — Documentación

| Tipo | Archivo                                                                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M    | `docs/decisions/2026-04-20-discussions-size-exception.md` (sumar entry post-B.3)                                                                                                                      |
| M    | `docs/plans/2026-05-09-presence-subslice-migration.md` (marcar B.3 cerrado en § 7.8)                                                                                                                  |
| C    | `src/features/discussions/threads/README.md` (NUEVO, opcional pero recomendado)                                                                                                                       |
| M    | `src/app/[placeSlug]/settings/members/components/member-search-bar.tsx` (línea 13: actualizar comentario `discussions/ui/thread-filter-pills.tsx` → `discussions/threads/ui/thread-filter-pills.tsx`) |
| M    | `docs/plans/2026-05-09-threads-subslice-migration.md` (sumar fecha + commit hash final)                                                                                                               |
| R    | `docs/gotchas/public-server-split.md` (verificar, sin cambios)                                                                                                                                        |

---

## Sección 3 — Grafo de dependencias entre sub-fases

### Grafo ASCII

```
[B.3.1: rewire public.ts]    [B.3.2: rewire public.server.ts]
        |                                |
        |                                |
        +---------+----------+-----------+
                  |          |
                  V          V
         [B.3.3]          [B.3.4]
        delete              delete 7
        thread-              legacy
        header-              thread
        bar +                files
        test legacy
                  |          |
                  V          V
              [B.3.5: delete reader-stack + post-unread-dot]
                            |
                            V
                          [C: docs]
```

### Tabla de dependencias hard

| Fase  | Depende de          | Razón                                                                                                                              |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| B.3.1 | —                   | Independiente. Cambio trivial 1-línea.                                                                                             |
| B.3.2 | —                   | Independiente. Cambio trivial 1-línea.                                                                                             |
| B.3.3 | **B.3.1**           | Borra `ui/thread-header-bar.tsx`. Pre-B.3.1 está vivo `public.ts:123 → './ui/thread-header-bar'`. Borrar antes rompe build.        |
| B.3.4 | **B.3.2**           | Borra `ui/post-list.tsx`. Pre-B.3.2 está vivo `public.server.ts:78 → './ui/post-list'`. Borrar antes rompe build.                  |
| B.3.5 | **B.3.4**           | Borra `reader-stack.tsx` + `post-unread-dot.tsx`. Antes de B.3.4 los consume `featured-thread-card.tsx` + `thread-row.tsx` legacy. |
| C     | **B.3.5** (o B.3.4) | Doc cita LOC final. Sin las borraduras la cifra es incorrecta.                                                                     |

### Sub-fases paralelizables (cero overlap de archivos)

#### **PAR 1 — Rewires (B.3.1 ∥ B.3.2)**

- Tocan archivos distintos: `public.ts` vs `public.server.ts`.
- Sin overlap. **Pueden ejecutarse en paralelo en 2 agentes**.
- Ambos requieren los mismos pre-flight gates (diff verificación + grep consumers + ANALYZE baseline).
- Bundle ANALYZE conviene capturarlo UNA SOLA VEZ pre-paralelo y comparar UNA SOLA VEZ post-merge de ambos (ver Sección 9).

#### **NO paralelizable: B.3.3 ∥ B.3.4**

- Aunque tocan archivos distintos, B.3.4 borra `post-list.tsx` legacy que importa `threads-section-header.tsx`, `thread-filter-pills.tsx`, etc. Si B.3.3 borra `threads-section-header.tsx` (incluso siendo "byte-idéntico al sub-slice"), `post-list.tsx` legacy (todavía vivo entre B.3.3 y B.3.4) queda con import roto → typecheck rompe.
- **Decisión del plan original:** B.3.3 borra solo `thread-header-bar.tsx` (no consumido por nada post-B.3.1) + test legacy (no consumido por nada). Esta segregación está bien razonada en el plan línea 382-388. **Honrarla**.

#### **NO paralelizable: B.3.4 ∥ B.3.5**

- B.3.5 valida con grep que reader-stack/post-unread-dot tienen 0 consumers. Pre-B.3.4, los consumers (legacy featured/thread-row) están vivos. Ejecutar B.3.5 antes de B.3.4 = grep con ≥2 hits = abortar. Secuencial obligatorio.

### Conclusión paralelización

- **Paralelizable:** B.3.1 + B.3.2 (en 2 agentes simultáneos).
- **Secuencial obligatorio:** B.3.3 → B.3.4 → B.3.5 → C.
- Ahorro vs plan original: ~30 min (ver Sección 9).

---

## Sección 4 — Pre-flight greps obligatorios por sub-fase

### B.3.1 — Re-wire `public.ts`

**Pre-cambio:**

```bash
# 1. Verificar byte-equivalencia del archivo target
diff src/features/discussions/ui/thread-header-bar.tsx \
     src/features/discussions/threads/ui/thread-header-bar.tsx
# Esperado: sin output. Si difiere → ABORTAR. Reconciliar drift primero (sub-slice debe ser snapshot funcional).

# 2. Verificar que threads/public.ts exporta ThreadHeaderBar
grep -n "ThreadHeaderBar" src/features/discussions/threads/public.ts
# Esperado: línea 13: export { ThreadHeaderBar } from './ui/thread-header-bar'
# Si no aparece → ABORTAR. El sub-slice no expone el símbolo.

# 3. Verificar consumers externos del barrel raíz
grep -rn "ThreadHeaderBar" src/app
# Esperado: solo conversations/[postSlug]/page.tsx + comentarios.
# Si aparece otro caller no listado → flag al owner antes de proceder.
```

**Si grep retorna inesperado:** revertir el cambio local (no commit), avisar al owner con el caller imprevisto, esperar instrucción. **NO improvisar wire alternativo**.

### B.3.2 — Re-wire `public.server.ts`

**Pre-cambio:**

```bash
# 1. Diff completo del set
for f in post-list featured-thread-card thread-row empty-threads \
         thread-filter-pills threads-section-header load-more-posts; do
  echo "===== $f ====="
  diff src/features/discussions/ui/$f.tsx \
       src/features/discussions/threads/ui/$f.tsx
done
# Esperado: solo líneas de import (paths absolutos / cross-sub-slice).
# Si aparece OTRO diff (lógica, JSX, props) → ABORTAR. Sub-slice quedó stale.

# 2. Verificar que threads/public.ts exporta PostList
grep -n "PostList" src/features/discussions/threads/public.ts
# Esperado: línea 11.

# 3. Consumers externos del barrel server
grep -rn "from '@/features/discussions/public.server'" src/app | grep "PostList"
# Esperado: solo conversations/page.tsx.

# 4. Capturar baseline bundle PRE
ANALYZE=true pnpm build 2>&1 | tee /tmp/build-baseline-b32.log
# Anotar tamaño exacto reportado para /conversations.
```

### B.3.3 — Borrar test legacy + `thread-header-bar.tsx`

**Pre-borrado:**

```bash
# 1. Confirmar que B.3.1 está MERGEADO (commit en main)
git log --oneline main | head -10 | grep "B.3.1"
# Si no aparece → ABORTAR. B.3.3 depende de B.3.1.

# 2. 0 consumers externos de thread-header-bar legacy
grep -rn "ui/thread-header-bar['\"]" src tests | grep -v "discussions/threads/"
# Esperado: 0 hits.
# Si ≥1 hit no esperado → revertir, flag al owner.

# 3. 0 consumers de test legacy
grep -rn "thread-filter-pills.test" src tests | grep -v "discussions/threads/"
# Esperado: solo el archivo a borrar.

# 4. NO borrar threads-section-header — sigue siendo importado por post-list.tsx legacy
grep -n "threads-section-header" src/features/discussions/ui/post-list.tsx
# Esperado: línea 3 (import). Si aparece, NO borrar threads-section-header.tsx en esta fase.
```

### B.3.4 — Borrar 7 archivos legacy thread

**Pre-borrado:**

```bash
# 1. Confirmar que B.3.2 está MERGEADO (commit en main)
git log --oneline main | head -10 | grep "B.3.2"
# Si no → ABORTAR. Borrar post-list.tsx con public.server.ts:78 todavía apuntando = build roto.

# 2. Pre-flight grep de cada uno (loop)
for f in post-list load-more-posts threads-section-header thread-filter-pills \
         empty-threads featured-thread-card thread-row; do
  echo "===== $f ====="
  grep -rn "ui/$f['\"]" src tests | grep -v "discussions/threads/"
done
# Esperado para cada uno: solo refs internas al set (siete que mueren juntos).
# CASO ESPECIAL: thread-filter-pills puede aparecer en cross-refs textuales (member-search-bar.tsx:13 — comentario, no import). OK.
# Si aparece IMPORT externo no esperado → revertir, flag al owner.

# 3. Re-correr diff completo (paranoia: drift en último minuto)
for f in post-list load-more-posts threads-section-header thread-filter-pills \
         empty-threads featured-thread-card thread-row; do
  diff src/features/discussions/ui/$f.tsx \
       src/features/discussions/threads/ui/$f.tsx
done
# Esperado: solo paths. Si aparece drift de lógica → ABORTAR.
```

### B.3.5 — Cleanup oportunista

**Pre-borrado:**

```bash
# 1. Confirmar B.3.4 mergeado
git log --oneline main | head -10 | grep "B.3.4"

# 2. 0 imports de reader-stack/post-unread-dot legacy
grep -rn "from '\\./reader-stack'\|from '\\./post-unread-dot'" src tests | grep -v "presence/"
# Esperado: 0 hits.
# Si ≥1 hit → flag y resolver. Posibilidades:
#   (a) Comentario textual en otro archivo (ignorable, NO un import)
#   (b) Nuevo caller introducido en sesión paralela → revertir cleanup y revaluar.

# 3. Ningún test del repo importa esos archivos
grep -rn "reader-stack\|post-unread-dot" src tests | grep -v "presence/" | grep "from"
# Esperado: 0 hits o solo comments.
```

### Acción común si grep retorna inesperado

1. **NO continuar.**
2. Revertir el commit local (`git checkout HEAD -- <archivos>`).
3. Documentar el hit imprevisto con archivo + línea + contenido.
4. Flagear al owner con: `"PRE-FLIGHT B.3.X falló: <descripción>. Esperaba 0 hits para <patrón>, encontré N hits en <archivo>:<línea>: <contenido>. Pausa pendiendo decisión owner."`
5. Esperar instrucción explícita. NO inferir un wire alternativo.

---

## Sección 5 — Archivos "frozen" (NO tocar en B.3)

### Frozen por commit G.3 reciente — alta sensibilidad

| Archivo                                                                   | Por qué                                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/discussions/server/actions/load-more.ts`                    | G.3 wired (`hasPermission(... 'discussions:hide-post')` líneas 8, 68, 108). Restaurar `actor.isAdmin` revierte el commit `dd42afc`.                      |
| `src/features/discussions/server/actions/posts/{delete,moderate,edit}.ts` | G.3 wired en commit `dd42afc`. NO tocar — ningún sub-fase B.3 lo necesita.                                                                               |
| `src/features/discussions/server/actions/comments/delete.ts`              | G.3 wired en commit `dd42afc`. Out of scope B.3.                                                                                                         |
| `src/features/discussions/__tests__/posts-actions.test.ts`                | Mocks G.3 actualizados (`groupMembershipFindMany` líneas 15-19, 36-37, 125-128). Restaurar mocks viejos rompe G.3 path tests.                            |
| `src/features/discussions/__tests__/comments-actions.test.ts`             | Idem (líneas 9, 11, 29-30, 119-121). NO tocar.                                                                                                           |
| `src/features/discussions/server/queries.ts`                              | Cierre experimento posts/comments revirtió funciones aquí. Restaurar lo que el cierre borró revierte commit `875b14b`.                                   |
| `src/features/discussions/server/queries/index.ts`                        | **No existe** — borrado por commit `875b14b`. NO recrear.                                                                                                |
| `src/features/discussions/{posts,comments,moderation}/`                   | **Carpetas no existen** — borradas por `875b14b`. NO recrear. Si algún sub-fase B.3 las "necesita", es señal de error en el plan: re-leer ADR de cierre. |

### Frozen por scope explícito B.3

| Archivo                                                                                                                                                      | Por qué                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `src/features/discussions/ui/utils.ts` (`friendlyErrorMessage`)                                                                                              | Out of scope B.3. Mover a `shared/` es deuda separada.                    |
| `src/features/discussions/ui/post-detail.tsx`                                                                                                                | UI de detalle de post (no listing). Out of scope B.3.                     |
| `src/features/discussions/ui/{comment-*,load-more-comments,post-admin-menu,post-hidden-watcher,reaction-bar,quote-*,edit-window-*,use-comment-realtime}.tsx` | NO son thread UI. Comments/reactions/post-detail. Tocar = expandir scope. |
| `src/features/discussions/presence/`                                                                                                                         | Sub-slice ya consolidado (B.1 + B.2 + B.2c, mergeados). NO tocar.         |
| `src/features/discussions/composers/`                                                                                                                        | Sub-slice consolidado. NO tocar.                                          |
| `src/features/discussions/reactions/`                                                                                                                        | Sub-slice consolidado. NO tocar.                                          |

### Frozen por riesgo "DEBUG TEMPORAL"

| Archivo                                | Por qué                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Cualquier archivo con `DEBUG TEMPORAL` | El plan línea 163 lo dice: NO tocar logs DEBUG TEMPORAL. Mantener intactos. |

---

## Sección 6 — Gaps identificados

### Gap 1 — LOC accounting desactualizado

**Severidad:** baja-media (estético, pero impacta mensajes commit y ADR).

**Detalle:** plan dice raíz = 6176 LOC. Real = **6202 LOC** (ADR de cierre + check-slice-size empírico).

**Fix propuesto:** actualizar el plan ANTES de ejecutar:

- § 0.1 línea 19: `6176` → `6202`
- § 0.1 línea 27: `4676` → `4702`
- § 2 línea 173: `6176 LOC (cap 1500 — viola por 4676)` → `6202 LOC (cap 1500 — viola por 4702)`
- § 2 línea 198: tabla, raíz pre-B.3 = `6202`, post-B.3 = `5602`, distancia = `-4102`
- § 2 línea 211, 220 y commit message C: usar `6202 → 5602`
- § 4.1 línea 606: `discussions raíz 5576 LOC` → `discussions raíz 5602 LOC`

### Gap 2 — Dependencia hard B.3.4 → B.3.2 NO está en pre-flight gate

**Severidad:** alta (puede romper build a un agente paralelo distraído).

**Detalle:** § B.3.4 línea 441 menciona `(legacy ref que ya migró en B.3.2 — ¡cuidado! verificar en commit B.3.2 que public.server.ts apunta al sub-slice antes de borrar)`. Pero esa "verificación" está en un comentario del comando grep, no es una gate ejecutable.

**Fix propuesto:** sumar a pre-flight de B.3.4:

```bash
# GATE: B.3.2 debe estar mergeado antes de B.3.4
grep -n "PostList" src/features/discussions/public.server.ts
# Esperado: línea 78: export { PostList } from './threads/public'
# Si aparece './ui/post-list' → ABORTAR. B.3.2 no está mergeado.
```

Análogo para B.3.3 → B.3.1:

```bash
grep -n "ThreadHeaderBar" src/features/discussions/public.ts
# Esperado: 'export { ThreadHeaderBar } from './threads/public'
# Si aparece './ui/thread-header-bar' → ABORTAR. B.3.1 no está mergeado.
```

### Gap 3 — Smoke check no cubre layout multi-place ni tier-gated places

**Severidad:** media.

**Detalle:** `/conversations` es la home gated. El smoke check § 4.3 cubre memberA/palermo, pero no:

- Place con tiers activos (member sin tier: ¿ve PostList vacía?, ¿ve placeholder?).
- Place fuera de horario (gate del `(gated)/layout.tsx` debería redirect, pero verificar que el shell no intente cargar PostList antes del gate).
- `/library/[categorySlug]` con `_library-item-content.tsx` que comparte el mismo barrel — confirmar visualmente que NO usa el sub-slice indirectamente.

**Fix propuesto:** sumar a § 4.3:

```
8. **Place fuera de horario** — owner login vía `/conversations` redirige a `/settings/hours`. Member redirige a `/closed`. Verificar que no hay 500 ni hydration warning durante el redirect.
9. **Place con tier-gating** — member sin tier accede a `/conversations` y ve placeholder de access (no PostList).
10. **`/library` (no [categorySlug])** — confirmar que sigue idéntico (no usa PostList).
```

### Gap 4 — No se documenta qué pasa si el bundle se infla EXACTAMENTE 5 kB

**Severidad:** baja (edge case).

**Detalle:** § B.3.2 dice "aceptar Δ ±5 kB; revert si >+5 kB". Pero ¿exactamente 5 kB? Y ¿qué hacer si infla 4.9 kB en B.3.2 y otro 4.9 kB en B.3.4 (acumulado 9.8 kB)?

**Fix propuesto:**

- Reformular: "aceptar Δ ≤+5 kB en cada sub-commit, **acumulado ≤+5 kB sobre baseline pre-B.3**".
- Si B.3.2 = +4 kB y B.3.4 = +2 kB acumulado = +6 kB → revert ambos, investigar.

### Gap 5 — Falta gate "tests en verde" entre sub-fases

**Severidad:** alta.

**Detalle:** plan asume típico flow "verde local → push → preview → smoke". Pero no establece explícitamente: **antes de iniciar B.3.X+1, B.3.X DEBE estar verde en CI Y mergeado en main**. En delegación a agentes paralelos esto es crítico — un agente puede asumir que su rama tiene los pre-requisitos cuando no los tiene.

**Fix propuesto:** sumar a cada sub-fase B.3.X (X ≥ 3):

```
**Pre-fase gate:**
1. `git fetch origin && git log origin/main --oneline -5` — confirmar que el último commit B.3.<X-N> mergeado está en main.
2. `git checkout main && git pull` antes de crear branch para B.3.X.
```

### Gap 6 — Falta gate de WHITELIST del slice-size script

**Severidad:** baja-media.

**Detalle:** § 8.3 línea 801 menciona que el WHITELIST del script está vacío y `discussions` falla con exit 1. **El plan NO especifica si CI bloquea por esto**. Si CI bloquea, todos los sub-commits B.3 fallan en CI hasta que se decida el rumbo del WHITELIST.

**Fix propuesto:**

- Owner clarification PRE-EJECUCIÓN: ¿CI ejecuta `check-slice-size.ts` como blocking gate? ¿O es informativo?
- Si bloqueante: re-poblar WHITELIST con `discussions` antes de iniciar B.3 (1-line change), y planear remover post-cierre de excepción.
- Si no bloqueante: documentar en el plan.

### Gap 7 — Falta cobertura SSR del PostList en tests

**Severidad:** media.

**Detalle:** § 8.3 línea 803 lo flagea: "La cobertura del SSR descansa solamente en smoke manual + E2E". B.3.2 cambia el path del componente que renderiza el SSR de la home gated del place — el riesgo de regresión SSR (componente no renderiza, hydration mismatch) NO está cubierto por tests automatizados.

**Fix propuesto:**

- Aceptar el riesgo (el smoke + E2E lo cubre razonablemente bien para un MVP) PERO documentar como tech-debt.
- O sumar un test `tests/integration/post-list-ssr.test.ts` con `renderToString` de `<PostList>` con datos mock — fuera de scope B.3 pero útil.
- Como mínimo: en preview deploy de B.3.2, abrir DevTools → Sources → buscar el chunk del Server Component y verificar que el archivo correcto se cargó.

### Gap 8 — `post-event-relation.test.ts` puede explotar silenciosamente

**Severidad:** baja.

**Detalle:** vive en `discussions/presence/__tests__/post-event-relation.test.ts` y desde el cierre del experimento importa de `'@/features/discussions/server/queries'` legacy (commit `875b14b`). El test NO toca thread UI, pero comparte fixtures con `posts-actions.test.ts`. Si B.3 toca queries por accidente, este test puede fallar silenciosamente.

**Fix propuesto:**

- Sumar a verificación post-cada-fase: `pnpm vitest run src/features/discussions/presence/__tests__/post-event-relation.test.ts` — explícito.
- O mejor: sumar `pnpm vitest run` (full suite) al gate post-cada-fase, no solo a cierre.

### Gap 9 — README.md de threads/ es opcional pero el plan no decide

**Severidad:** muy baja.

**Detalle:** § C.3 dice "(NUEVO, opcional pero recomendado)". Si se delega a un agente, queda ambiguo si crearlo o no.

**Fix propuesto:** decidir explícitamente. Recomendación: crearlo (paridad con `presence/README.md`, ayuda a futuros agentes que se topen con el sub-slice).

---

## Sección 7 — Plan de delegación a agentes

### Modelo de delegación

- **PAR 1 (paralelo, 2 agentes simultáneos):** B.3.1 + B.3.2.
- **SEQ (secuencial, 1 agente single-thread):** B.3.3 → B.3.4 → B.3.5 → C.

Cada brief abajo es **listo para copy-paste** a un agente general-purpose. Asume que el agente ya leyó `CLAUDE.md` y `docs/architecture.md`.

---

### Brief Agente B.3.1 — Re-wire `public.ts` (`ThreadHeaderBar`)

**Contexto obligatorio (lectura previa):**

- `docs/plans/2026-05-09-threads-subslice-migration.md` § 0.2, § 0.3, § B.3.1 (líneas 254-296).
- `docs/plans/2026-05-09-threads-subslice-migration-audit.md` (este doc) § 4 (pre-flight greps), § 5 (frozen files).

**Objetivo:** cambiar 1 línea en `src/features/discussions/public.ts:123` para que `ThreadHeaderBar` se exporte desde el sub-slice.

**Pre-flight (correr ANTES de tocar nada):**

```bash
# 1. Branch limpio
git status
git checkout -b refactor/b31-rewire-public-ts main

# 2. Diff verificación byte-equivalencia
diff src/features/discussions/ui/thread-header-bar.tsx \
     src/features/discussions/threads/ui/thread-header-bar.tsx
# Esperado: sin output. Si difiere → ABORTAR, flag owner.

# 3. Verificar export en threads/public.ts
grep -n "ThreadHeaderBar" src/features/discussions/threads/public.ts
# Esperado: línea 13.

# 4. Consumers externos
grep -rn "ThreadHeaderBar" src/app
# Esperado: solo conversations/[postSlug]/page.tsx + comentarios.

# 5. Baseline tests verde
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
# Si algo está rojo PRE-cambio → ABORTAR.
```

**Cambio:**
En `src/features/discussions/public.ts`, línea 123:

```diff
- export { ThreadHeaderBar } from './ui/thread-header-bar'
+ export { ThreadHeaderBar } from './threads/public'
```

**Verificación post-cambio:**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
```

**Smoke manual obligatorio (preview deploy):**

- `/conversations/<post-baseline>` — header bar con back button pinta inmediato. Sin warnings en console.
- Post propio dentro de ventana edit (60s) — kebab admin renderiza en rightSlot.

**Commit:**

```
refactor(discussions): re-wire public.ts ThreadHeaderBar a sub-slice threads/ (B.3.1)
```

**Rollback:** `git revert <hash>`.

**Frozen files (NO tocar):** ver § 5 de la auditoría. Especialmente: `server/actions/load-more.ts`, `server/queries.ts`, `__tests__/{posts,comments}-actions.test.ts`.

---

### Brief Agente B.3.2 — Re-wire `public.server.ts` (`PostList`)

**Contexto obligatorio:**

- `docs/plans/2026-05-09-threads-subslice-migration.md` § 0.2, § 0.3, § B.3.2 (líneas 299-355).
- Audit § 4, § 5.

**Objetivo:** cambiar 1 línea en `src/features/discussions/public.server.ts:78` para que `PostList` se exporte desde el sub-slice.

**Pre-flight:**

```bash
git status
git checkout -b refactor/b32-rewire-public-server-ts main

# Diff completo del set
for f in post-list featured-thread-card thread-row empty-threads \
         thread-filter-pills threads-section-header load-more-posts; do
  echo "===== $f ====="
  diff src/features/discussions/ui/$f.tsx src/features/discussions/threads/ui/$f.tsx
done
# Esperado: solo paths.

grep -n "PostList" src/features/discussions/threads/public.ts
# Esperado: línea 11.

grep -rn "from '@/features/discussions/public.server'" src/app | grep "PostList"
# Esperado: solo conversations/page.tsx.

# Baseline bundle
ANALYZE=true pnpm build 2>&1 | tee /tmp/build-baseline-b32.log
# Anotar tamaño /conversations en log.
```

**Cambio:**
En `src/features/discussions/public.server.ts`, línea 78:

```diff
- export { PostList } from './ui/post-list'
+ export { PostList } from './threads/public'
```

**Verificación post-cambio:**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
ANALYZE=true pnpm build 2>&1 | tee /tmp/build-post-b32.log
# Comparar tamaño /conversations: aceptar Δ ≤+5 kB. Si >+5 kB → revert obligatorio.
```

**Smoke manual obligatorio (preview deploy):**

1. `/conversations` (memberA en E2E_PLACES.palermo): SSR pinta lista, filter pills, empty states, featured + rows, LoadMorePosts en page 2, PostUnreadDot, ReaderStack visible.
2. `/library/[categorySlug]`: visualmente IDÉNTICO a pre-B.3 (no usa PostList).
3. DevTools: First Load JS `/conversations` ≤295 kB.

**Commit:**

```
refactor(discussions): re-wire public.server.ts PostList a sub-slice threads/ (B.3.2)
```

**Rollback:** `git revert <hash>`.

**Frozen:** ver § 5.

**NOTA paralelización:** B.3.1 y B.3.2 se ejecutan en agentes simultáneos. Cada uno tiene su branch. Mergear ambos a main en orden cualquiera (no importa). El bundle ANALYZE post-merge se hace UNA VEZ con ambos en main.

---

### Brief Agente B.3.3 — Borrar test legacy + thread-header-bar legacy

**Contexto obligatorio:**

- Plan § B.3.3 (líneas 358-411).
- Audit § 4 (pre-flight gate B.3.1 mergeado).

**Pre-flight:**

```bash
git fetch origin
git log origin/main --oneline -10 | grep "B.3.1"
# Esperado: commit B.3.1 visible. Si NO → ABORTAR.

git checkout main && git pull
git checkout -b refactor/b33-delete-thread-header-bar-and-test-legacy main

# Verificar wire actual
grep -n "ThreadHeaderBar" src/features/discussions/public.ts
# Esperado: 'export { ThreadHeaderBar } from './threads/public''.
# Si aparece './ui/thread-header-bar' → B.3.1 no fue mergeado correctamente. ABORTAR.

# Pre-flight grep
grep -rn "ui/thread-header-bar['\"]" src tests | grep -v "discussions/threads/"
# Esperado: 0 hits.

grep -rn "thread-filter-pills.test" src tests | grep -v "discussions/threads/"
# Esperado: solo el archivo a borrar.

# CRÍTICO: NO borrar threads-section-header en esta fase
grep -n "threads-section-header" src/features/discussions/ui/post-list.tsx
# Esperado: línea 3 (import). Confirmar que post-list.tsx legacy todavía existe → mantener threads-section-header.tsx para B.3.4.
```

**Cambio:**

```bash
git rm src/features/discussions/__tests__/thread-filter-pills.test.tsx
git rm src/features/discussions/ui/thread-header-bar.tsx
```

**Verificación:**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
pnpm tsx scripts/lint/check-slice-size.ts
# Esperado: discussions raíz 6202 - 41 = 6161 LOC.
```

**Commit:**

```
refactor(discussions): borrar thread-header-bar legacy + test filter-pills duplicado (B.3.3)
```

**Smoke:** N/A (los archivos no se importan post-B.3.1).

**Frozen:** ver § 5.

---

### Brief Agente B.3.4 — Borrar 7 archivos legacy thread

**Contexto obligatorio:**

- Plan § B.3.4 (líneas 414-495).
- Audit § 4 (pre-flight gate B.3.2 mergeado).

**Pre-flight:**

```bash
git fetch origin
git log origin/main --oneline -10 | grep "B.3.2"
# Si NO → ABORTAR.

git checkout main && git pull
git checkout -b refactor/b34-delete-7-legacy-thread-files main

# GATE B.3.2 mergeado
grep -n "PostList" src/features/discussions/public.server.ts
# Esperado: '.threads/public'. Si './ui/post-list' → ABORTAR.

# Pre-flight grep
for f in post-list load-more-posts threads-section-header thread-filter-pills \
         empty-threads featured-thread-card thread-row; do
  echo "===== $f ====="
  grep -rn "ui/$f['\"]" src tests | grep -v "discussions/threads/"
done
# Esperado para cada uno: solo refs INTERNAS al set. Comentarios textuales = OK; imports externos = ABORTAR.

# Re-correr diff (paranoia drift último minuto)
for f in post-list load-more-posts threads-section-header thread-filter-pills \
         empty-threads featured-thread-card thread-row; do
  diff src/features/discussions/ui/$f.tsx src/features/discussions/threads/ui/$f.tsx
done
# Esperado: solo paths. Si lógica drift → ABORTAR.
```

**Cambio (orden importa):**

```bash
git rm src/features/discussions/ui/post-list.tsx
git rm src/features/discussions/ui/load-more-posts.tsx
git rm src/features/discussions/ui/threads-section-header.tsx
git rm src/features/discussions/ui/thread-filter-pills.tsx
git rm src/features/discussions/ui/empty-threads.tsx
git rm src/features/discussions/ui/featured-thread-card.tsx
git rm src/features/discussions/ui/thread-row.tsx
```

**Verificación:**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
ANALYZE=true pnpm build 2>&1 | tee /tmp/build-post-b34.log
pnpm tsx scripts/lint/check-slice-size.ts
# Esperado: discussions raíz 6161 - 472 = 5689 LOC.
```

**Smoke manual obligatorio (preview deploy):**

1. `/conversations` (memberA palermo): set completo de B.3.2 re-validado.
2. `/conversations?filter=unanswered`, `?filter=participating`.
3. `/conversations/<post>`: BackButton funciona, `?from=conversations` preservado.
4. `/library/[categorySlug]`: idéntico a baseline.
5. First Load JS `/conversations` ≤295 kB.

**Commit:**

```
refactor(discussions): borrar 7 archivos legacy thread-related (B.3.4)
```

**Frozen:** ver § 5.

---

### Brief Agente B.3.5 — Cleanup oportunista

**Contexto obligatorio:**

- Plan § B.3.5 (líneas 499-540).
- Audit § 4 (pre-flight gate B.3.4 mergeado).

**Pre-flight:**

```bash
git fetch origin
git log origin/main --oneline -10 | grep "B.3.4"
# Si NO → ABORTAR.

git checkout main && git pull
git checkout -b refactor/b35-cleanup-reader-stack-post-unread-dot main

# Pre-flight grep
grep -rn "from '\\./reader-stack'\|from '\\./post-unread-dot'" src tests | grep -v "presence/"
# Esperado: 0 hits (los callers — featured/thread-row legacy — fueron borrados en B.3.4).
# Si ≥1 hit → revertir intent, flag owner.
```

**Cambio:**

```bash
git rm src/features/discussions/ui/reader-stack.tsx
git rm src/features/discussions/ui/post-unread-dot.tsx
```

**Verificación:**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm test --run tests/boundaries.test.ts
pnpm tsx scripts/lint/check-slice-size.ts
# Esperado: discussions raíz 5689 - 87 = 5602 LOC.
```

**Commit:**

```
refactor(discussions): cleanup oportunista reader-stack + post-unread-dot legacy (B.3.5)
```

**Smoke:** N/A.

**Frozen:** ver § 5.

---

### Brief Agente C — Documentación

**Contexto obligatorio:**

- Plan § C (líneas 544-584).
- Audit § 6 (Gap 1: LOC accounting actualizado).

**Pre-flight:**

```bash
git fetch origin
git log origin/main --oneline -10 | grep "B.3.5"

git checkout main && git pull
git checkout -b docs/c-threads-subslice-migration-close main
```

**5 superficies:**

**C.1 — `docs/decisions/2026-04-20-discussions-size-exception.md`**

- Sumar entry "Update 2026-05-09 (B.3 cerrado): sub-slice threads consolidado".
- Actualizar tabla LOC: raíz **6202 → 5602** (post-B.3 final).
- Marcar en checklist: `[x] threads/ — pendiente B.3 (-600 LOC esperados)` → `[x] threads/ — cerrado, raíz baja a 5602.`
- Confirmar que cap 1500 NO es alcanzable; dejar pendiente decisión "excepción permanente con cap mayor".

**C.2 — `docs/plans/2026-05-09-presence-subslice-migration.md` § 7.8**

- Marcar `B.3 cerrado` con fecha + commit hashes (B.3.1, B.3.2, B.3.3, B.3.4, B.3.5, C).
- Mantener referencias a B.4/B.5 como CANCELADOS (ya documentado en ADR de cierre).

**C.3 — `src/features/discussions/threads/README.md` (NUEVO)**

- Replicar pattern de `src/features/discussions/presence/README.md`.
- ≤50 LOC. Documentar: componentes, public surface, dependencias cross-sub-slice (`presence/`, `discussions/ui/utils.ts`, `discussions/server/actions/load-more.ts`), origen del plan B.3.

**C.4 — `src/app/[placeSlug]/settings/members/components/member-search-bar.tsx:13`**

- Actualizar comentario: `discussions/ui/thread-filter-pills.tsx` → `discussions/threads/ui/thread-filter-pills.tsx`.

**C.5 — `docs/gotchas/public-server-split.md`**

- Verificar y dejar como está. NO requiere cambios (B.3 mantiene patrón).

**C.6 (NUEVO):** marcar este audit doc como APLICADO al plan padre, sumando "Sección 11 — Lecciones del audit ejecutadas" si surgen learnings durante la ejecución.

**Verificación:**

```bash
pnpm typecheck
pnpm lint
pnpm test --run tests/boundaries.test.ts
```

**Commit:**

```
docs(threads): cerrar B.3 sub-slice migration plan + cross-refs
```

---

## Sección 8 — Riesgos integrales reescritos (foco parallel-delegation + drift)

| #   | Riesgo                                                                                                                                   | Probabilidad | Impacto | Mitigación                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Agente B.3.1 ∥ B.3.2: ambos mergean simultáneamente y un conflict de bundle aparece solo cuando ambos están en main                      | media        | medio   | UN solo `ANALYZE=true pnpm build` POST-MERGE de ambos como gate común antes de B.3.3. Si bundle infla, revertir B.3.2 (mayor riesgo) primero.        |
| 2   | Agente B.3.3 inicia sin verificar B.3.1 mergeado en main                                                                                 | alta         | alto    | Pre-flight gate explícito: `git log origin/main                                                                                                      | grep B.3.1` ABORTA si missing. Documentado en brief. |
| 3   | Agente B.3.4 borra `post-list.tsx` legacy con `public.server.ts` todavía apuntando a él                                                  | alta         | crítico | Pre-flight gate: `grep -n "PostList" src/features/discussions/public.server.ts` debe retornar `'.threads/public'`. ABORTAR si no.                    |
| 4   | Agente B.3.X "restaura" sin querer un archivo borrado por commits G.3 (`875b14b`)                                                        | baja         | crítico | Lista frozen explícita en § 5. NUNCA recrear `discussions/posts/`, `discussions/comments/`, `discussions/moderation/`, ni `server/queries/index.ts`. |
| 5   | Agente toca tests `posts-actions.test.ts` o `comments-actions.test.ts` por error y rompe mocks G.3                                       | baja         | alto    | Frozen explícito § 5. Si necesita modificar mocks, flagear al owner — el commit `dd42afc` los actualizó deliberadamente.                             |
| 6   | Agente regresa `actor.isAdmin` en `load-more.ts` por confusión con la versión sub-slice (cuando no la hay)                               | baja         | crítico | Frozen explícito § 5. Si el plan B.3 NO menciona `load-more.ts` como modificado, NO tocarlo.                                                         |
| 7   | Drift entre auditoría y ejecución: alguien edita thread UI legacy mientras el plan B.3 está en limbo                                     | media        | medio   | Re-correr diff de Sección 1.1 al inicio de cada sub-fase. Si cualquier diff cambió a "lógica drift", ABORTAR.                                        |
| 8   | Bundle `/conversations` infla acumulado entre B.3.2 y B.3.4 sin que ningún sub-fase pase el threshold individual                         | media        | medio   | Comparar acumulado vs baseline pre-B.3, no solo individual. Si acumulado >+5 kB → revert ambos (B.3.2 + B.3.4).                                      |
| 9   | E2E `post-crud.spec.ts` + `zone-swipe.spec.ts` rompen post-B.3.2 silenciosamente en CI                                                   | baja         | medio   | Correr ambos PRE-merge en cada sub-fase, no solo post-merge. Sumar a verificación post-B.3.2 y post-B.3.4.                                           |
| 10  | Agente B.3.5 cleanup omite verificar el grep cross-references textuales y borra archivo todavía referenciado en doc                      | baja         | bajo    | Grep `from '\\./reader-stack'` (con `from`) — solo imports, NO comentarios. Documentado en pre-flight § 4.                                           |
| 11  | Decisión owner pendiente sobre WHITELIST de `check-slice-size.ts` bloquea CI durante B.3                                                 | media        | medio   | Owner clarification PRE-EJECUCIÓN (Gap 6 § 6). Resolver antes de B.3.1.                                                                              |
| 12  | Agente C cita LOC desactualizado (5576 en vez de 5602) en ADR addendum                                                                   | alta         | bajo    | Brief C explícito: 6202 → 5602. Audit Gap 1 documenta el error del plan original.                                                                    |
| 13  | Agente B.3.4 borra `featured-thread-card.tsx` legacy pero `presence/ui/post-readers-block.tsx` lo referencia en JSDoc, ESLint puede flag | baja         | nulo    | El ESLint solo enforces `no-restricted-paths` en imports, NO en comentarios. Cleanup posterior (no scope B.3).                                       |
| 14  | Smoke manual de B.3.2 omite `/library/[categorySlug]` (paranoia: no usa PostList pero comparte barrel)                                   | media        | medio   | Checklist § 4.3 ítem 2 explícito.                                                                                                                    |
| 15  | Agente paralelo B.3.1 / B.3.2 ambos llamados Maxi en el commit, conflict en `git log` legibility                                         | nula         | nula    | Cosmético. Distinguir por hash + título de commit.                                                                                                   |

---

## Sección 9 — Cronograma con agentes en paralelo

### Modelo secuencial original (plan B.3 § 7)

| Fase                             | Tiempo | Acumulado |
| -------------------------------- | ------ | --------- |
| Pre-flight                       | 20 min | 20        |
| B.3.1 + smoke                    | 15 min | 35        |
| B.3.2 + smoke + ANALYZE          | 30 min | 65        |
| Push + preview B.3.1 + B.3.2     | 15 min | 80        |
| B.3.3                            | 10 min | 90        |
| B.3.4 + smoke + ANALYZE          | 35 min | 125       |
| B.3.5                            | 10 min | 135       |
| Push + preview B.3.3+B.3.4+B.3.5 | 15 min | 150       |
| C                                | 25 min | 175       |
| Push + final preview             | 10 min | 185       |
| **Total**                        |        | **~3h**   |

### Modelo paralelo (PAR 1: B.3.1 + B.3.2 simultáneo)

| Fase                                 | Wall clock              | Notas                                                                                                                                         |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-flight                           | 20 min                  | Único — captura baseline ANALYZE compartido.                                                                                                  |
| **PAR 1: B.3.1 + B.3.2** (2 agentes) | 30 min                  | Branch separadas. Smoke por separado. Mergea quien termina antes; el segundo merge resuelve conflicts (no debería haber, archivos distintos). |
| Push + preview combined              | 15 min                  | UN preview con ambos + ANALYZE comparison post-merge.                                                                                         |
| B.3.3                                | 10 min                  |                                                                                                                                               |
| B.3.4 + smoke + ANALYZE              | 35 min                  |                                                                                                                                               |
| B.3.5                                | 10 min                  |                                                                                                                                               |
| Push + preview B.3.3+B.3.4+B.3.5     | 15 min                  |                                                                                                                                               |
| C                                    | 25 min                  |                                                                                                                                               |
| Push + final preview                 | 10 min                  |                                                                                                                                               |
| **Total**                            | **170 min** = **~2h45** |

**Ahorro:** 15 min (~8% de la duración). Pequeño en absoluto pero significativo si el owner no puede dedicar bloques largos.

**¿Vale la pena paralelizar?** Marginal. Recomendación honesta: **mantener secuencial**. El ahorro de 15 min se come en coordinar 2 agentes + revisar conflicts + decidir orden de merge. Si el owner está cómodo con 1 sesión de 3 horas, el secuencial es más limpio.

**Si SÍ se paraleliza:**

1. Owner crea las 2 branches: `refactor/b31-rewire-public-ts` y `refactor/b32-rewire-public-server-ts`.
2. Lanza 2 agentes en paralelo, cada uno con su brief de § 7.
3. Espera ambos cierren su PR + smoke verde.
4. Mergea ambos a main.
5. Corre `ANALYZE=true pnpm build` UNA SOLA VEZ con ambos en main, compara con baseline.
6. Si bundle OK, continúa con B.3.3 (un solo agente).

---

## Sección 10 — Verdict de production-readiness

### ¿El plan es production-ready post-audit?

**Sí, con caveats.** El plan B.3 está bien estructurado, las premisas están empíricamente verificadas (sub-slice byte-equivalente al legacy salvo paths), el split en 5 sub-fases es defensivo y reversible, y el smoke check cubre la home gated del place adecuadamente.

### Bloqueantes pre-ejecución (deben resolverse antes de iniciar)

1. **OWNER: actualizar LOC accounting del plan a 6202 → 5602** (Gap 1 § 6). 5 minutos de edit.
2. **OWNER: decidir WHITELIST del slice-size script** (Gap 6 § 6). ¿CI bloquea por slice-size? Si sí, re-poblar con `discussions` antes de B.3 o aceptar CI rojo durante el sprint.
3. **OWNER: confirmar que NO hay sesiones paralelas tocando thread UI legacy** entre el inicio de B.3 y el cierre de B.3.5. Si hay alta probabilidad de drift, considerar postponer.

### Caveats no-bloqueantes (se aceptan honestamente como riesgo residual)

1. **No hay test de integración SSR del PostList.** Cobertura descansa en smoke manual + E2E `post-crud.spec.ts`. Aceptable para MVP; sumar test es deuda separada (Gap 7).
2. **Bundle Δ acumulado entre sub-fases** debe medirse contra baseline pre-B.3, no solo per-fase. Sumar a la verificación de B.3.4 (Gap 4).
3. **Cap 1500 del slice raíz NO se cierra** — sigue ~3.7× sobre cap. Excepción permanente con cap mayor pendiente de definir formalmente. Documentado en ADR `2026-04-20-discussions-size-exception.md`.
4. **`loadMorePostsAction` y `friendlyErrorMessage` cross-sub-slice por path absoluto** — patrón canónico, pero es deuda explícita. NO se resuelve en B.3 (B.4/B.5 cancelados, no hay sucesor).
5. **Paralelización marginal** (15 min de ahorro). Recomiendo secuencial para limpieza operativa.

### Items de owner clarification (decisiones no-agente)

1. **¿Ejecutar B.3 o cerrarlo análogo a posts/comments?** ADR de cierre del experimento (`2026-05-09-discussions-subslice-experiment-closed.md` línea 75-77) deja explícitamente esta decisión "pendiente". El audit confirma que **threads SÍ es viable** (no hay drift bidireccional como pasó con posts/comments). **Recomendación honesta:** ejecutar B.3 — cierra deuda real con riesgo controlado. La alternativa (borrar el sub-slice) pierde ~531 LOC de trabajo previo y deja el patrón de "sub-slice orphan" como aceptable, lo que va contra la lección del cierre de experimento.
2. **¿Crear `threads/README.md` (C.3)?** Plan dice "opcional pero recomendado". Recomendación: **sí**, paridad con `presence/README.md`.
3. **¿Aceptar marginal paralelización de B.3.1 + B.3.2 o ir secuencial?** Recomendación: secuencial.
4. **¿Sumar test SSR del PostList como follow-up?** Recomendación: **sí, como deuda explícita**, no scope B.3.

### Conclusión

El plan B.3 es ejecutable y producción-ready si el owner:

- Acepta los 4 caveats arriba.
- Resuelve los 3 bloqueantes pre-ejecución (~10 min de trabajo).
- Decide los 4 items de clarification.

**Total trabajo de owner antes de iniciar:** ~30 min (LOC update + WHITELIST decision + 4 clarifications + comunicación a equipo sobre no-tocar thread UI durante el sprint).

**Total trabajo de agentes:** ~3h secuencial (recomendado) o ~2h45 paralelo (marginal).

**Riesgo residual aceptado:** drift de bundle Next 15 splitter post-B.3.2 y post-B.3.4 (~5 kB de tolerancia). Cubierto por revert plan commit-by-commit.

---

## Apéndice — Comandos de auditoría empírica usados

Todos los comandos abajo se pueden re-correr para reproducir esta auditoría:

```bash
# 1. Drift check sub-slice vs legacy
for f in empty-threads featured-thread-card load-more-posts post-list \
         thread-filter-pills thread-header-bar thread-row threads-section-header; do
  echo "===== $f ====="
  diff src/features/discussions/ui/$f.tsx \
       src/features/discussions/threads/ui/$f.tsx
done

# 2. Test legacy vs sub-slice
diff src/features/discussions/__tests__/thread-filter-pills.test.tsx \
     src/features/discussions/threads/__tests__/thread-filter-pills.test.tsx

# 3. LOC actual del slice
pnpm tsx scripts/lint/check-slice-size.ts | head -10

# 4. Consumers externos del barrel discussions
grep -rn "@/features/discussions" src/app src/features tests \
  | grep -v "src/features/discussions/" \
  | grep -E "discussions/(public|threads|presence|reactions|composers|moderation|posts|comments)" \
  | sort -u

# 5. Consumers de los 7 nombres del threads/public
grep -rn "PostList\b\|ThreadHeaderBar\b\|FeaturedThreadCard\|EmptyThreads\|ThreadFilterPills\|ThreadRow\b\|LoadMorePosts\|ThreadsSectionHeader" src tests \
  | grep -v "node_modules" | sort -u

# 6. Frozen files: G.3 wiring intacto
grep -n "hasPermission" src/features/discussions/server/actions/load-more.ts
grep -n "groupMembershipFindMany\|groupMembership.findMany" \
  src/features/discussions/__tests__/posts-actions.test.ts \
  src/features/discussions/__tests__/comments-actions.test.ts

# 7. Confirmar que sub-slices borrados NO existen
ls src/features/discussions/posts src/features/discussions/comments src/features/discussions/moderation 2>&1
# Esperado: cada uno: "No such file or directory"

# 8. Recent commits relevantes
git log --oneline -20
git log --since="2026-05-08" --pretty=format:"%h %ad %s" --date=short -- \
  "src/features/discussions/ui/*" "src/features/discussions/threads/*"

# 9. Repo limpio + 18 commits ahead origin
git status
git log --oneline origin/main..HEAD | wc -l
```

---

### Critical Files for Implementation

- `/Users/maxi/claude-workspace/place/src/features/discussions/public.ts` (B.3.1: línea 123)
- `/Users/maxi/claude-workspace/place/src/features/discussions/public.server.ts` (B.3.2: línea 78)
- `/Users/maxi/claude-workspace/place/src/features/discussions/threads/public.ts` (read-only: superficie del sub-slice)
- `/Users/maxi/claude-workspace/place/docs/plans/2026-05-09-threads-subslice-migration.md` (gap fixes: § 0.1, § 2, § C.1)
- `/Users/maxi/claude-workspace/place/docs/decisions/2026-04-20-discussions-size-exception.md` (C.1: addendum post-B.3)
