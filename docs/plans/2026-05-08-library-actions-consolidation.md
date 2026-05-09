# Plan — Library Actions Consolidation (SET A → SET B)

## Context

Hoy el slice `library/` carga **dos copias paralelas** de las server actions de gestión de categorías (y, por arrastre, dos UIs admin):

- **SET A** (legacy expuesto): `src/features/library/server/actions/{create,update,archive,reorder}-category.ts`, `{invite,remove}-contributor.ts`. Gate `actor.isAdmin`. Sin advisory locks. Sin transacción para multi-row writes (reorder usa `prisma.$transaction([…updates])` array, no callback). Acompaña a la UI vieja `library/ui/admin/{category-list-admin, category-form-dialog, contributors-dialog, archive-category-button}.tsx` que el barrel `library/public.ts:109-117` re-exporta y la página `/settings/library/page.tsx` consume.
- **SET B** (nuevo, no expuesto): `src/features/library/admin/server/actions/{create,update,archive,reorder}-category.ts` + `_with-category-set-lock.ts`. Gate `hasPermission(actorId, placeId, 'library:moderate-categories')` con scope a `categoryId` cuando aplica. Todo dentro de `prisma.$transaction(async tx => …)` que abre con `acquireCategorySetLock(tx, placeId)` (advisory lock `pg_advisory_xact_lock` namespace `1`). Acompaña a la UI nueva `library/admin/ui/{category-list-admin, archive-category-confirm}.tsx` + `library/wizard/ui/category-form-sheet.tsx` (wizard 4-step) + `library/contributors/ui/{contributors-sheet, groups-scope-sheet}.tsx`. SET B persiste `LibraryCategory.kind` (G.5+6.b) — SET A lo ignora.
- **SET C** (paralelo, ya cableado): `src/features/library/contributors/server/actions/{invite,remove,set-designated-contributors,set-category-group-scope}.ts`. Misma estética que SET B: `hasPermission` + scope. Re-exportado desde el barrel raíz para `setLibraryCategoryDesignatedContributorsAction` y `setLibraryCategoryGroupScopeAction`. Para `inviteContributorAction`/`removeContributorAction` el barrel raíz hoy re-exporta SET A, no SET C.

Indicios de divergencia confirmados:

1. La sesión actual fixeó SET A `revalidateLibraryCategoryPaths(slug, slug, placeId)` — SET B ya tenía el fix correcto. Confirma que SET B es la fuente de verdad.
2. `tests/e2e/flows/library-admin-categories.spec.ts:124-128` usa selectores que SOLO existen en `library/admin/ui/category-list-admin.tsx:216` (NUEVO). El test fue escrito esperando el switch que nunca terminó.
3. SET A no tiene tests de unit en `library/__tests__/`. SET B tiene 1.4K LOC de tests (`library/admin/__tests__/{create,update,archive,reorder}-category.test.ts` + `with-category-set-lock.test.ts`).
4. El sub-slice `library/admin/` y la UI nueva existen y están listos; sólo falta re-cablear el barrel y la página.

Costos del status quo:

- **Drift de invariantes**: cualquier mejora a SET B hay que portarla manualmente a SET A — ya falló con el bug del `revalidateTag`.
- **Slice obeso** (~15.9K LOC, cap 1.5K). El sub-split en sesión `tidy-stargazing-summit` justifica vía ADR la excepción transitoria, pero el dead code consume ~1.2K LOC sin valor.
- **TOCTOU race en reorder/create/archive concurrentes**: SET A no protege `findMany → updates` con lock. La race era el rationale original para introducir SET B + `_with-category-set-lock.ts`.
- **Auth gate divergente**: hoy ambos cubren mismo set de actors (porque el preset Administradores tiene `PERMISSIONS_ALL`). Mañana, si se crea un grupo no-preset con scope a categoría, SET B respeta el scope, SET A no.

Decisión cerrada (input del task): **el switch del barrel + retiro de SET A + retiro de UI vieja son la dirección**. No reabrir alternativas.

## Scope cerrado

### Entra

- Re-apuntar el barrel raíz `library/public.ts` (líneas 74-83 actions; 109-117 UI admin) a SET B + UI nueva.
- Re-apuntar `src/app/[placeSlug]/settings/library/page.tsx` para que consuma el `CategoryListAdmin` nuevo (`library/admin/public`) — incluye agregar las nuevas queries (`groups`, `tiers`, `readScopesByCategory`).
- Re-apuntar `inviteContributorAction` / `removeContributorAction` del barrel raíz a SET C (`library/contributors/server/actions/`).
- Eliminar SET A completo: `library/server/actions/{create,update,archive,reorder}-category.ts`, `{invite,remove}-contributor.ts`. Mantener `shared.ts`.
- Eliminar la UI vieja: `library/ui/admin/{archive-category-button, category-form-dialog, category-list-admin, contributors-dialog, errors}.tsx` + `contribution-policy-label.tsx`.
- Cerrar bug paralelo en SET C: `inviteContributorAction:100,117`, `removeContributorAction:67`, `setLibraryCategoryDesignatedContributorsAction:132` y `setLibraryCategoryGroupScopeAction` no pasan `placeId` a `revalidateLibraryCategoryPaths`. El barrel switch hereda este bug si no lo arreglamos en el mismo go.
- Mover `friendlyLibraryErrorMessage` desde `library/ui/admin/errors.ts` a `library/admin/ui/errors.ts` (ver Decisión #6).
- Migrar / portar tests de cobertura desde SET A si existen (no hay, según `library/__tests__/`).
- Añadir tests focalizados de unit que falten en SET C que no estén ya cubiertos.
- Actualizar `tests/boundaries.test.ts` solo si el switch introduce un import que el regex no cubre (no debería).

### Fuera

- No tocar SET C interno (signatures, advisory locks, transacciones) salvo el bug del `revalidateTag`.
- No tocar `library/items/server/actions/*` (CRUD de items) — son ortogonales.
- No tocar `library/access/*`, `library/courses/*`, `library/wizard/*` salvo ajustes mínimos.
- No tocar `tests/rls/library-category.test.ts` — el switch no cambia el comportamiento RLS.
- No tocar `mention-search.ts` ni el split `public.ts` / `public.server.ts` (foundation perf-1/perf-2).
- No revertir nada de Fase 1 perf (commits `bb2d369..e69ef18`).
- No introducir nueva surface en `public.ts` salvo lo estrictamente requerido.
- No refactorear el wizard. Sólo cambia la fuente de las actions vía el barrel.

## Decisiones cerradas

1. **El barrel raíz `library/public.ts` re-exporta SET B + SET C, NUNCA SET A**. Mantener un único set lookup desde el barrel — el sub-slice `library/admin/public.ts` también re-exporta los mismos identifiers desde el mismo origen interno, pero el barrel raíz es la "puerta autorizada" para el resto del repo.

2. **`library/admin/public.ts` queda como "atajo legible" interno y opcional para callers dentro de `library/`**. Coherente con ADR `2026-05-08-sub-slice-cross-public.md`.

3. **`actor.isAdmin` (SET A) y `hasPermission(uid, pid, 'library:moderate-categories')` (SET B) cubren el mismo conjunto de actors hoy**. El preset Administradores se crea con `PERMISSIONS_ALL`. Owner siempre pasa por bypass en `hasPermission`. **Diferencia operativa potencial**: si se crea un grupo no-preset con scope a categoría que tiene `library:moderate-categories`, SET B respeta el scope, SET A no. El switch a SET B amplía correctamente la auth a la semántica granular del sistema permission-groups.

4. **Eliminar SET A en la MISMA fase del switch, no en una fase separada**. Dejar el código muerto reabre el riesgo de drift. La cuenta es cómoda: SET B + tests están listos y cobertura es ≥ que SET A.

5. **Arreglar el bug `revalidateTag` faltante en SET C en la misma fase del switch**. Hacer el switch sin arreglar SET C replica exactamente el mismo patrón con un actor distinto.

6. **`friendlyLibraryErrorMessage` se mueve de `library/ui/admin/errors.ts` a `library/admin/ui/errors.ts` y se re-exporta desde `library/admin/public`**. El helper es 100% UI/i18n; pertenece al sub-slice admin que es donde vive la UI consumidora dominante.

7. **El switch incluye re-cablear `/settings/library/page.tsx` para usar `CategoryListAdmin` del sub-slice admin con sus props nuevas**. El listado nuevo necesita `placeId`, `groups`, `tiers`, `readScopesByCategory` además de `categories` y `members`. La página sigue el patrón actual (no aplica streaming agresivo del shell — es page de settings, no de detalle).

8. **El test E2E `library-admin-categories.spec.ts` queda verde naturalmente cuando el page apunta al `CategoryListAdmin` nuevo**. Si los selectores no matchean el wizard, son ajustes de E2E (no del plan) — registrar como risk para L-7.

9. **El plan NO introduce un mapper de error compat entre SET A y SET B**. Las dos versiones lanzan los mismos tipos. El UI consumer reusa `friendlyLibraryErrorMessage`. Cero shim.

10. **La eliminación de `shared.ts` se difiere**. `shared.ts` exporta `revalidateLibraryCategoryPaths`, `revalidateLibraryItemPaths`, `safeStringify`. Se mantiene como módulo interno.

## Sub-fases

| Sub-id | Tema                                                                                                                                                                                                                                                                                                                                                                                             | Sesiones | Deliverable                                                                                                                                                  | Owner |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| L-1    | Pre-flight: verificación de invariantes auth                                                                                                                                                                                                                                                                                                                                                     | 0.25     | Reporte de checks (ver Verificación L-1). No hay edits.                                                                                                      | Max   |
| L-2    | Re-cablear `/settings/library/page.tsx` para consumir `CategoryListAdmin` del sub-slice admin con sus props nuevas. Introducir queries de `groups`, `tiers`, `readScopesByCategory`.                                                                                                                                                                                                             | 1        | Page actualizada + smoke local en dev contra `the-company` + tests E2E `library-admin-categories.spec.ts` corriendo verdes. SET A intacto. UI vieja intacta. | Max   |
| L-3    | Mover `friendlyLibraryErrorMessage` de `library/ui/admin/errors.ts` a `library/admin/ui/errors.ts`. Actualizar imports en `wizard/ui/category-form-sheet.tsx`, `contributors/ui/groups-scope-sheet.tsx`. Re-export desde `library/admin/public`.                                                                                                                                                 | 0.5      | Helper movido, imports verdes, sin duplicación.                                                                                                              | Max   |
| L-4    | Switch del barrel raíz `library/public.ts` líneas 74-83 (actions) hacia SET B + SET C. Re-points: `archiveLibraryCategoryAction`, `createLibraryCategoryAction`, `reorderLibraryCategoriesAction`, `updateLibraryCategoryAction` → `./admin/server/actions/*`. `inviteContributorAction`, `removeContributorAction` → `./contributors/server/actions/*`. SET A queda en disco pero unreferenced. | 0.25     | Barrel actualizado. `pnpm typecheck` + `pnpm test` verdes. SET A es huérfano.                                                                                | Max   |
| L-5    | Fix paralelo: SET C pasa `actor.placeId` a `revalidateLibraryCategoryPaths` en `inviteContributorAction:100,117`, `removeContributorAction:67`, `setLibraryCategoryDesignatedContributorsAction:132`, `setLibraryCategoryGroupScopeAction:final`.                                                                                                                                                | 0.5      | SET C actions revalidan tag `place:<pid>:library-categories`. Tests de SET C actualizados si mockean firma.                                                  | Max   |
| L-6    | Eliminar SET A: `library/server/actions/{create,update,archive,reorder}-category.ts`, `{invite,remove}-contributor.ts`. NO eliminar `shared.ts` ni `mention-search.ts`. Eliminar UI vieja: `library/ui/admin/{archive-category-button, category-form-dialog, category-list-admin, contributors-dialog, errors, contribution-policy-label}.tsx`. Quitar exports muertos del barrel raíz.          | 0.5      | LOC del slice baja ~1.2K. `pnpm typecheck`, `pnpm test`, `tests/boundaries.test.ts`, E2E verdes.                                                             | Max   |
| L-7    | Verificación final + audit de cobertura: corroborar que SET B + SET C cubren cada caso que SET A cubría. Donde haya hueco, portar el caso al test del lado nuevo.                                                                                                                                                                                                                                | 0.5      | Audit doc en `docs/plans/2026-05-08-library-actions-consolidation-coverage-audit.md`.                                                                        | Max   |

Total estimado: 3.5 sesiones cortas. Cada sub-fase es atómica (commit + tests verdes) y reversible.

## Critical files

**L-2 (re-cablear page):**

- `src/app/[placeSlug]/settings/library/page.tsx` — switch import + nuevas queries.
- `src/features/library/admin/ui/category-list-admin.tsx` — props consumer (lectura).
- `src/features/groups/public.server.ts` — `listGroupsByPlace` (lectura).
- `src/features/tiers/public.server.ts` — `listTiersByPlace` (lectura).
- `src/features/library/access/public.server.ts` — `findReadScope` (lectura).

**L-3 (mover helper):**

- `src/features/library/ui/admin/errors.ts` (origen, se elimina al final de L-6).
- `src/features/library/admin/ui/errors.ts` (destino, nuevo archivo).
- `src/features/library/admin/public.ts` — re-export.
- `src/features/library/public.ts` — re-export desde el sub-slice.

**L-4 (switch barrel):**

- `src/features/library/public.ts` (líneas 74-83 actions, 109-117 UI admin).

**L-5 (fix SET C revalidateTag):**

- `src/features/library/contributors/server/actions/invite-contributor.ts:100,117`
- `src/features/library/contributors/server/actions/remove-contributor.ts:67`
- `src/features/library/contributors/server/actions/set-designated-contributors.ts:132`
- `src/features/library/contributors/server/actions/set-category-group-scope.ts` (revisar el sitio del revalidate)
- `src/features/library/contributors/__tests__/*.test.ts` — actualizar mocks si verifican firma exacta.

**L-6 (eliminar):**

- `src/features/library/server/actions/{create,update,archive,reorder}-category.ts` — DELETE.
- `src/features/library/server/actions/{invite,remove}-contributor.ts` — DELETE.
- `src/features/library/ui/admin/{archive-category-button, category-form-dialog, category-list-admin, contributors-dialog, contribution-policy-label, errors}.tsx` — DELETE.
- `src/features/library/public.ts` — limpiar exports huérfanos (líneas 109-117).

**L-7 (audit):**

- `docs/plans/2026-05-08-library-actions-consolidation-coverage-audit.md` — NEW (output del audit).

## Riesgos + mitigaciones

| Riesgo                                                                                                                                            | Probabilidad | Impacto              | Mitigación                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hasPermission('library:moderate-categories')` rechaza un actor que `actor.isAdmin` aceptaba                                                      | Baja         | Alto                 | L-1 corre query SQL contra prod cloud para listar places sin preset Administradores y placeships sin GroupMembership al preset. Si conteo > 0, backfill ANTES. |
| El advisory lock `pg_advisory_xact_lock(1, hashtext(placeId))` colisiona con otro lock en otro slice usando namespace `1`                         | Muy baja     | Medio                | Búsqueda global confirma que SOLO `library/admin/server/actions/_with-category-set-lock.ts` usa namespace `1`.                                                 |
| El page settings nuevo carga `findReadScope` por cada categoría DESIGNATED/SELECTED_GROUPS y rompe el budget                                      | Media        | Medio                | L-2 incluye batch query: una sola Prisma call. Cap MAX_CATEGORIES_PER_PLACE=30 limita el peor caso.                                                            |
| Test E2E `library-admin-categories.spec.ts` falla porque selectores no matchean el wizard                                                         | Alta         | Medio                | Ajuste de E2E queda fuera del switch — agregar a sub-fase L-7. Confirmar con dry-run de Playwright local.                                                      |
| El delete de `library/ui/admin/errors.ts` huérfana imports en archivos que ni el grep encontró                                                    | Baja         | Bajo                 | L-6 corre `pnpm typecheck` antes del commit + `grep -r 'friendlyLibraryErrorMessage' src/`.                                                                    |
| El bug del `revalidateTag` en SET C estaba latente pero ahora afecta al wizard cuando crea/edita una categoría DESIGNATED + invita contribuidores | Media        | Bajo (ya existe hoy) | L-5 lo arregla en el mismo go. No mergear L-4 sin L-5.                                                                                                         |
| Boundaries test rechaza un nuevo cross-slice no previsto                                                                                          | Muy baja     | Bajo                 | El cross-slice sub-slice de `library/admin/public` y `library/wizard/public` ya está en uso.                                                                   |
| Tests SET B fallan porque mockean `groupMembership.findMany` y la query del nuevo `hasPermission` en algún edge case                              | Baja         | Medio                | Los tests SET B ya están escritos asumiendo el wiring `hasPermission`. L-1 confirma vía `pnpm test` ANTES del switch.                                          |
| Quitar SET A rompe algún "test fixture" (e2e o RLS) que importe SET A directo                                                                     | Baja         | Medio                | L-1 hace `grep -r 'features/library/server/actions/' tests/`.                                                                                                  |

## Verificación

### Por sub-fase

**L-1 (pre-flight):**

- Query SQL en cloud: `SELECT COUNT(*) FROM "Place" p WHERE NOT EXISTS (SELECT 1 FROM "PermissionGroup" g WHERE g."placeId" = p.id AND g."isPreset" = true);` → debe ser 0. Si > 0, backfill ANTES.
- Query SQL en cloud: `SELECT COUNT(*) FROM "PlaceOwnership" o WHERE NOT EXISTS (SELECT 1 FROM "GroupMembership" gm JOIN "PermissionGroup" g ON gm."groupId" = g.id WHERE gm."userId" = o."userId" AND gm."placeId" = o."placeId" AND g."isPreset" = true);` → owners deberían también estar en el preset; si > 0 documentar.
- `pnpm test src/features/library/admin/__tests__/ src/features/library/contributors/__tests__/ --run` → todos verdes.
- `pnpm test src/features/places/__tests__/create-place.test.ts --run` → confirma que el preset se crea en cada `createPlaceAction`.

**L-2:**

- `pnpm typecheck && pnpm test --run` (focalizado en library + boundaries).
- Smoke manual: `pnpm dev`, abrir `the-company.lvh.me:3000/settings/library`, ver listado nuevo, abrir wizard "Nueva categoría", crear una test → aparece. Editar via dropdown "Opciones para …" → menuitem Editar → wizard abre con valores. Archivar → desaparece.
- `pnpm test:e2e tests/e2e/flows/library-admin-categories.spec.ts` → verde.

**L-3:**

- `pnpm typecheck`.
- `grep -r 'friendlyLibraryErrorMessage' src/` cubre los 4 imports conocidos + barrel.

**L-4:**

- `pnpm typecheck && pnpm test --run`.
- `tests/boundaries.test.ts` verde.
- `tests/e2e/flows/library-admin-categories.spec.ts` verde.

**L-5:**

- Tests de `library/contributors/__tests__/` verdes.
- Smoke manual: en dev, modificar un contributor de una categoría DESIGNATED → comprobar que `/library/<slug>` se refresca al instante.

**L-6:**

- `pnpm typecheck` falla si hay imports al SET A eliminado.
- `pnpm test --run && pnpm lint` verdes.
- LOC del slice: `find src/features/library -type f | xargs wc -l | tail -1` → bajada ~1.2K LOC.

**L-7:**

- Audit doc nueva enumera cada caso de SET A vs caso equivalente en SET B/SET C. Cualquier hueco se cierra portando el test ANTES del audit cerrar.

### Final (post-L-7)

- `pnpm typecheck && pnpm test --run` → verde global.
- `pnpm test:e2e` (suite completa) → verde.
- `pnpm test:rls` → verde.
- `pnpm lint` → verde.
- Audit de LOC del slice: 14.7K → confirmar bajada.
- Branch local pasa por GH Actions CI con e2e job (Supabase branch efímera) verde antes de mergear.

## Salvaguardas anti-regresión

1. **Cada sub-fase es un commit aislado**. No hay "L-2 + L-3 juntos".
2. **`tests/boundaries.test.ts` corre en cada sub-fase**.
3. **`pnpm test:e2e tests/e2e/flows/library-admin-categories.spec.ts` corre en L-2, L-4, L-6**.
4. **L-1 (pre-flight) NO se salta**.
5. **LOC monitor**: después de L-6, si bajó <500 LOC, alguien dejó código muerto sin querer; revisar.
6. **Performance budget**: L-2 puede aumentar la latencia del page `/settings/library`. Tolerancia: +50ms p50 sin observación; +100ms p50 requiere refactor.
7. **No mergear L-4 sin L-5 en la misma PR** (o PRs back-to-back en menos de 1h).
8. **No mergear L-6 sin L-4 + L-5 confirmados verdes en main**.
9. **Antes de mergear cada sub-fase, releer este plan completo + el ADR `2026-05-08-sub-slice-cross-public.md`**.

## Plan de eliminación de SET A

Timeline:

- **L-6 (esta misma sesión / mismo PR del switch)**: SET A se elimina. No hay "deprecation period".

Criterios de eliminación (todos cumplidos antes de borrar):

1. ☐ Barrel raíz `library/public.ts` no re-exporta nada de SET A (post-L-4).
2. ☐ `grep -r "library/server/actions/create-category|...|library/server/actions/remove-contributor" src/ tests/` → cero matches fuera del propio archivo.
3. ☐ `grep -r "ArchiveCategoryButton|CategoryFormDialog|ContributorsDialog" src/ | grep -v 'library/ui/admin'` → cero matches (post-L-2).
4. ☐ Tests SET B + SET C verdes con cobertura confirmada en L-7.
5. ☐ Smoke manual + E2E `library-admin-categories.spec.ts` verde sobre `the-company` y `palermo`.

`shared.ts` NO se elimina — sigue siendo el dueño de `revalidateLibraryCategoryPaths`.

## Alineación con CLAUDE.md y architecture.md

- ☑ **"Una sesión = una cosa"**: cada sub-fase es atómica.
- ☑ **"Diagnosticar antes de implementar"**: el plan ya hizo la diagnosis.
- ☑ **"Cajitas ordenadas, puertitas pequeñas"**: el switch refuerza esto.
- ☑ **"Cada feature ≤1500 LOC"**: el plan baja ~1.2K LOC, acercando la línea de meta.
- ☑ **"Server-first"**: el cambio NO mueve lógica al cliente.
- ☑ **"Tipos estrictos"**: cero `any`.
- ☑ **"Validación con Zod"**: schemas sin cambio.
- ☑ **"Boundary cross-slice"**: respeta ADR `2026-05-08-sub-slice-cross-public.md`.
- ☑ **"Sin libertad para decisiones arquitectónicas"**: la decisión de switch venía del task.
- ☑ **"Cada sesión se auto-verifica"**: L-1 + L-7 son explícitamente verificación.
- ☑ **Streaming agresivo del shell**: `/settings/library` no es page de detalle.
- ☑ **Idioma**: comentarios y commit messages en español; identifiers en inglés.

## Próximo paso

L-1 (pre-flight, ~15 min):

1. Conectarse al cloud `place-prod` (Ohio) y correr las dos queries SQL de invariantes.
2. Correr `pnpm test src/features/library/admin/__tests__/ src/features/library/contributors/__tests__/ --run` localmente y confirmar verde.
3. Reportar resultados + dar luz verde a L-2.
