# Inventario de costo de salir de Prisma ORM

> Investigación READ-ONLY (2026-05-15). Base para la decisión de stack:
> migrar el acceso a datos de Prisma 5.22 + `@prisma/adapter-pg` a
> **Supabase-client (PostgREST) + funciones Postgres/RPC**.
>
> Criterio de clasificación de cada `$transaction`:
>
> - **TRIVIAL**: inserts/updates sin lógica de decisión entre statements.
>   PostgREST directo o RPC plpgsql lineal de 1 párrafo.
> - **MEDIA**: lógica condicional entre statements y/o varias tablas, pero
>   sin lock pesimista ni invariante crítico de dominio.
> - **COMPLEJA**: lock pesimista (`FOR UPDATE`), lee-decide-escribe atómico,
>   invariante de dominio (mín-1-owner, cap 150), o cotransacción cross-slice.
>   SIEMPRE requiere función plpgsql con lógica + manejo de error tipado.

## 1. Tabla por operación transaccional

| #   | archivo:línea                                                                          | Qué hace                                                                                                                                                                                                                                         | Clase        | Se porta a                                                                                      | Esfuerzo                       |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `src/features/places/server/actions.ts:288` (`performTransferTx`)                      | Transfer ownership: `SELECT ... FOR UPDATE` sobre `PlaceOwnership`, valida membership activa del target, upsert ownership target, opcional delete ownership actor + `leftAt` membership, `assertMinOneOwner(count)`.                             | **COMPLEJA** | RPC plpgsql (lock + invariante mín-1-owner + errores tipados)                                   | **L**                          |
| 2   | `src/features/members/server/actions/leave.ts:65` (`performMembershipLeaveTx`)         | Leave place: `FOR UPDATE` sobre `PlaceOwnership`, lee ownerships, si es único owner → `InvariantViolation`, si owner borra ownership, update `leftAt` membership.                                                                                | **COMPLEJA** | RPC plpgsql (lock + invariante último-owner)                                                    | **L**                          |
| 3   | `src/features/members/profile/server/actions/leave.ts:72` (`performMembershipLeaveTx`) | **Duplicado exacto** de #2 (otro slice/subslice). Mismo lock + invariante.                                                                                                                                                                       | **COMPLEJA** | Misma RPC que #2 (reusar)                                                                       | **S** (si comparte RPC con #2) |
| 4   | `src/features/events/server/actions/create.ts:66`                                      | Cotransacción cross-slice: crea Event + `createPostFromSystemHelper` (thread, slug único con retry P2002) + update `event.postId`. Atómico event↔post.                                                                                           | **COMPLEJA** | RPC plpgsql (event + post + slug uniqueness loop + backlink)                                    | **L**                          |
| 5   | `src/features/library/server/actions/create-item.ts:116`                               | Cotransacción cross-slice: `createPostFromSystemHelper` (post + slug retry) + `LibraryItem.create`; mapea P2003 (categoría archivada en carrera) a `ConflictError`.                                                                              | **COMPLEJA** | RPC plpgsql (reusa lógica de post-from-system de #4)                                            | **M-L**                        |
| 6   | `src/features/library/server/actions/update-item.ts:101`                               | Optimistic lock: `updateMany Post WHERE id+version` → si count 0 `ConflictError`; luego `LibraryItem.update`.                                                                                                                                    | **COMPLEJA** | RPC plpgsql (CAS de versión + error tipado)                                                     | **M**                          |
| 7   | `src/features/discussions/server/actions/comments/create.ts:126`                       | Crea Comment + `updateMany Post.lastActivityAt`. Sin lógica condicional.                                                                                                                                                                         | **TRIVIAL**  | RPC plpgsql lineal (2 stmts) o 2 PostgREST si se acepta no-atómico                              | **S**                          |
| 8   | `src/features/discussions/server/hard-delete.ts:18`                                    | Hard delete post: lee comment ids, `deleteMany Reaction`, `deleteMany Flag` (polimórficos, sin FK), `delete Post` (cascade Comment/PostRead).                                                                                                    | **MEDIA**    | RPC plpgsql (limpieza polimórfica)                                                              | **M**                          |
| 9   | `src/features/flags/server/actions/review.ts:135` (`reviewFlagTx`)                     | `updateMany Flag WHERE status OPEN` (claim) → si 0 error; switch sobre targetType (EVENT→cancel, POST→hide, COMMENT→delete + lookup parent slug).                                                                                                | **COMPLEJA** | RPC plpgsql (claim atómico + ramas condicionales cross-target)                                  | **M-L**                        |
| 10  | `src/features/flags/server/actions.ts:238` (`reviewFlagTx`)                            | Variante de #9 (sin rama EVENT): claim flag + rama POST/COMMENT.                                                                                                                                                                                 | **COMPLEJA** | RPC plpgsql (parametrizable con #9)                                                             | **M**                          |
| 11  | `src/features/members/server/actions/accept.ts:107` (`acceptInvitationTx`)             | Accept invitación: chequea membership existente (idempotente), `count` activos + `assertPlaceHasCapacity` (cap 150), crea Membership, si admin agrega a preset group, marca invitation aceptada. P2002→Conflict.                                 | **COMPLEJA** | RPC plpgsql (invariante cap 150 + idempotencia + grupo preset)                                  | **L**                          |
| 12  | `src/features/members/invitations/server/accept-core.ts:126` (`acceptInvitationTx`)    | Variante de #11 con `asOwner`: además crea `PlaceOwnership` y exige preset; error tipado si falta preset.                                                                                                                                        | **COMPLEJA** | RPC plpgsql (superset de #11)                                                                   | **L**                          |
| 13  | `src/features/places/server/actions.ts:42` (`createPlaceTx`)                           | Crea Place + PlaceOwnership + Membership + PermissionGroup preset + GroupMembership (5 inserts encadenados, sin condicional). P2002→Conflict afuera.                                                                                             | **MEDIA**    | RPC plpgsql lineal (5 inserts) o PostgREST secuencial sin atomicidad (riesgoso)                 | **M**                          |
| 14  | `src/features/members/server/erasure/run-erasure.ts:130` (`processOneMembership`)      | Erasure GDPR: lee posts/comments/events del user, arma snapshot, crea `ErasureAuditLog`, 3× `$executeRaw UPDATE ... jsonb_set` anonimizando, `deleteMany EventRSVP`, update membership `erasureAppliedAt`. Dry-run via excepción que rollbackea. | **COMPLEJA** | RPC plpgsql (ya es SQL crudo + dry-run/rollback + audit)                                        | **L**                          |
| 15  | `src/features/members/erasure/server/run-erasure.ts:135` (`processOneMembership`)      | Superset de #14: además LibraryItem y Flag(reporter). Mismo patrón snapshot + jsonb_set + audit + dry-run rollback.                                                                                                                              | **COMPLEJA** | RPC plpgsql (la más grande; reemplaza/extiende #14)                                             | **L**                          |
| 16  | `src/features/library/access/server/actions/set-read-scope.ts:148`                     | Override de read-scope: update discriminator + `deleteMany` en 3 tablas scope + `createMany` sólo en la tabla del kind. Pre-validación de ids fuera de tx.                                                                                       | **MEDIA**    | RPC plpgsql (delete-all + insert por kind)                                                      | **M**                          |
| 17  | `src/features/library/contribution/server/actions/set-write-scope.ts:151`              | Idéntico a #16 para write-scope (3 tablas write).                                                                                                                                                                                                | **MEDIA**    | Misma forma de RPC que #16 (parametrizable)                                                     | **S-M**                        |
| 18  | `src/features/library/server/actions/reorder-categories.ts:63`                         | Batch array `$transaction([...updates])`: N `update position` (validación de set completo fuera de tx). Sin lógica entre stmts.                                                                                                                  | **TRIVIAL**  | RPC plpgsql (`unnest` + update) o PostgREST upsert batch                                        | **S**                          |
| 19  | `src/features/flags/server/queries.ts:213` (`fetchFlagTargetsBatch`)                   | Batch read-only: hasta 3 `findMany` (post/comment/event) en una tx por snapshot isolation. Sin escritura.                                                                                                                                        | **TRIVIAL**  | 3 reads PostgREST directos (se pierde snapshot isolation; aceptable, ya tolera filas faltantes) | **S**                          |

### Optimistic locking fuera de `$transaction` (mismo costo conceptual)

Estos NO usan `$transaction` pero son CAS atómico de una sola sentencia
(`updateMany WHERE id + version` → si count 0, `ConflictError`). PostgREST
NO puede devolver el "0 filas → error tipado" con la semántica de versión;
cada uno → RPC plpgsql pequeña (o función genérica parametrizada).

| archivo:línea                                                        | Entidad                | Patrón                           |
| -------------------------------------------------------------------- | ---------------------- | -------------------------------- |
| `src/features/discussions/server/actions/posts/edit.ts:212`          | Post                   | CAS version edit                 |
| `src/features/discussions/server/actions/comments/edit.ts:205`       | Comment                | CAS version edit                 |
| `src/features/discussions/server/actions/posts/delete.ts:52` + `:74` | Post                   | check version + soft delete      |
| `src/features/discussions/server/actions/comments/delete.ts:119`     | Comment                | CAS version soft delete          |
| `src/features/discussions/server/actions/posts/moderate.ts:62`       | Post                   | CAS version hide/unhide          |
| `src/features/library/server/actions/update-item.ts:103`             | Post (vía LibraryItem) | CAS version (ya contado como #6) |

## 2. Conteos

- **Total `prisma.$transaction`** (no-test): **19** sitios.
  - TRIVIAL: 3 (#7, #18, #19)
  - MEDIA: 4 (#8, #13, #16, #17)
  - COMPLEJA: 12 (#1–#6, #9–#12, #14, #15)
- **Total `SELECT ... FOR UPDATE`** (lock pesimista): **3** sitios de código
  (`places/server/actions.ts:289`, `members/server/actions/leave.ts:69`,
  `members/profile/server/actions/leave.ts:76`) — todos sobre `PlaceOwnership`
  para el invariante mín-1-owner. Son **2 lógicas distintas** (transfer vs
  leave); leave está duplicado en 2 slices.
- **Entidades con optimistic locking** (`version`): **3 entidades** —
  **Post**, **Comment**, **LibraryItem** (vía `Post.version`). Distribuido en
  **6 acciones**: posts edit/delete/moderate, comments edit/delete, library
  update-item.
- **Cotransacciones cross-slice**: **2** + 1 helper compartido.
  - `events.createEventAction` → `discussions.createPostFromSystemHelper` (#4)
  - `library.createItemAction` → `discussions.createPostFromSystemHelper` (#5)
  - Helper transaccional reutilizado: `createPostFromSystemHelper`
    (`discussions/server/actions/posts/create-from-system.ts`), recibe `tx`,
    - `resolveUniqueSlug(client)` parametrizado por cliente. Lógica de slug
      único con retry P2002. Lo consumen **2 slices** bajo SUS tx.
- **Helpers transaccionales reutilizados**: 2.
  - `createPostFromSystemHelper` (cross-slice, el más caro de portar).
  - `performMembershipLeaveTx` duplicado en 2 archivos (mismo lock+invariante).
- **Reads CRUD simples** (proporción): el grueso del acceso es CRUD directo.
  Conteo de llamadas no-test: `findUnique` 85, `findMany` 71, `findFirst` 28,
  `count` 10, `groupBy` 7 → ~**201 reads** mayormente filtrables/joins anidados
  que **migran directo a PostgREST**. Escrituras simples: `update` 35,
  `create` 32, `delete` 9 — gran parte fuera de tx, migran a PostgREST.
  Solo **~19 tx + 6 CAS = ~25 operaciones** (≈10–12% del total de
  call-sites) requieren RPC plpgsql.

## 3. Veredicto cuantificado

**Funciones plpgsql/RPC a escribir: ~14–17**, de las cuales **~10 son
COMPLEJAS** (lock pesimista, invariante de dominio, cross-slice o
lee-decide-escribe con error tipado). Desglose realista con consolidación:

- 1 RPC `transfer_ownership` (lock + mín-1-owner) — #1
- 1 RPC `leave_place` (lock + último-owner) — cubre #2 y #3
- 1 RPC `create_post_from_system` (slug único + retry) — base de #4 y #5
- 1 RPC `create_event_with_thread` (usa la anterior) — #4
- 1 RPC `create_library_item` (usa la de post) — #5
- 1 RPC genérica `cas_update_versioned` (Post/Comment/LibraryItem) — #6 + 6 CAS
- 1 RPC `review_flag` parametrizable — #9 + #10
- 1 RPC `accept_invitation` con flags admin/owner — #11 + #12
- 1 RPC `create_place_bootstrap` (5 inserts) — #13
- 1–2 RPC `run_erasure` (la más grande, con dry-run rollback + audit) — #14/#15
- 1 RPC `hard_delete_post` (limpieza polimórfica) — #8
- 1 RPC `set_category_scope` parametrizable read/write — #16 + #17
- (TRIVIAL #18, #19, #7 pueden quedar como PostgREST/RPC mínima)

**Juicio honesto: MEDIO, con riesgo de escalar a CARO.**

No es barato: 10 funciones COMPLEJAS concentran la lógica de invariantes
_críticos del dominio Place_ — el cap de 150 (`accept`), el mín-1-owner
(`transfer`/`leave` con lock pesimista real), la atomicidad event↔thread y
library-item↔thread (cross-slice), y el erasure GDPR con rollback de
dry-run. Estas no son traducción mecánica: encierran reglas de negocio que
hoy viven en TypeScript tipado + tests y habría que reespecificarlas en
plpgsql con manejo de error que el cliente pueda discriminar
(`ConflictError` vs `InvariantViolation` vs `NotFoundError`).

No es caro-catastrófico porque: (a) ~88–90% del acceso es CRUD/reads que
migran a PostgREST casi sin esfuerzo y se benefician directo de RLS nativa;
(b) hay consolidación real (leave duplicado, flag-review duplicado, CAS
genérico, post-from-system compartido) que baja ~25 sitios a ~14–17 RPCs;
(c) los 3 `FOR UPDATE` son la misma tabla y 2 lógicas.

Estimación de esfuerzo: las 10 COMPLEJAS son el pozo — cada una S/M/L del
orden de 0.5–2 días incluyendo re-test, las 3 L de erasure/accept/transfer
hacia el extremo alto. Orden de magnitud: **3–5 semanas de trabajo
concentrado y de alto riesgo** para la capa transaccional, sobre un fondo
de migración CRUD ancha pero mecánica. No es un pozo de meses _si_ se
respeta la consolidación; se vuelve pozo de meses si cada sitio se porta
1:1 sin unificar y sin paridad de tests.

### Las 3 operaciones más caras de portar

1. **Erasure GDPR** (`members/erasure/server/run-erasure.ts:135`, superset
   de `members/server/erasure/run-erasure.ts:130`): lee 5 tipos de entidad,
   arma snapshot de auditoría, 3+ `UPDATE jsonb_set`, `deleteMany`, y un
   patrón de **dry-run que fuerza rollback vía excepción**. En plpgsql el
   dry-run requiere savepoint/exception handling explícito y devolver
   counts; perder el tipado del snapshot y la cobertura de tests es el
   mayor riesgo de correctitud (es legalmente sensible).
2. **Accept invitación** (`members/invitations/server/accept-core.ts:126`
   y `members/server/actions/accept.ts:107`): invariante **cap 150** +
   idempotencia (race entre tabs) + creación condicional de membership /
   grupo preset / ownership según `asAdmin`/`asOwner`, con 3 errores
   tipados distintos que el frontend discrimina.
3. **Transfer/leave ownership** (`places/server/actions.ts:288` +
   `members/.../leave.ts`): único uso de `SELECT ... FOR UPDATE` real;
   serializa concurrencia de owners y enforce mín-1-owner. La semántica de
   lock pesimista y la diferenciación `InvariantViolation` vs `Conflict`
   debe replicarse exacta o se rompe el invariante de dominio "mínimo 1
   owner siempre" bajo concurrencia.

## 4. Riesgos específicos de portar a plpgsql

- **Testabilidad**: hoy cada tx tiene tests TS (TDD obligatorio en el core).
  plpgsql requiere pgTAP o tests de integración contra Postgres real;
  perder la suite TS de unidad sobre la lógica de invariantes es una
  regresión de cobertura difícil de recuperar 1:1.
- **Versionado/migraciones de funciones**: cada cambio de lógica = nueva
  migración SQL + `CREATE OR REPLACE FUNCTION`. Sin diff de tipo, sin
  refactor asistido por compilador. Drift entre función deployada y código
  esperado por el cliente es silencioso (gotcha clásico — sumar a
  `docs/gotchas/`).
- **Pérdida de type-safety end-to-end**: hoy `tx.post.create(...)` valida
  shape en compile-time. Vía RPC, el contrato es JSON; hay que mantener a
  mano tipos TS ↔ firma SQL ↔ Zod del payload. Los `authorSnapshot`
  validados con Zod antes de insertar (patrón en comments/create) hay que
  reproducirlos del lado plpgsql o confiar en el cliente.
- **Debugging**: stack traces de plpgsql son crípticos vs el logger
  estructurado actual (`logger.info({ event: ... })`). Observabilidad de
  errores de invariante se degrada salvo que se instrumente `RAISE` con
  códigos SQLSTATE custom que el cliente mapee a `domain-error`.
- **Mapeo de errores tipados**: el código depende fuerte de discriminar
  `ConflictError` / `InvariantViolation` / `NotFoundError` / `ValidationError`
  (la UI ramifica por ellos). En plpgsql hay que codificarlos como
  `SQLSTATE` custom y mantener una tabla de traducción cliente — superficie
  nueva de bugs.
- **P2002/P2003 → SQLSTATE**: hoy se atrapan códigos Prisma (`P2002`
  unique, `P2003` FK) para mapear a copy de usuario. Pasa a depender de
  `23505`/`23503` de Postgres; semánticamente equivalente pero hay que
  reauditar cada catch.
- **Slug uniqueness con retry**: `createPostFromSystemHelper` reintenta una
  vez ante colisión de slug. Replicar el loop de retry dentro de plpgsql es
  factible pero es lógica no trivial que hoy está testeada en TS.
