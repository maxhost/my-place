# 0038 — Member peer-read sobre `app_user`: extender ADR-0021 al 3er sujeto del trio

- **Fecha:** 2026-05-25
- **Estado:** Aceptada
- **Alcance:** modelo de datos (RLS de `app_user`), feature `members` (slice V1, Feature E), patrón canónico de lectura cross-user
- **Refina:** ADR-0021 (extiende el patrón "owner OR member-self" al 3er sujeto del trio `place`/`membership`/`app_user`)
- **Cierra:** gap operacional detectado en Feature E S6 (loadMembers/loadPendingInvitations imposibles sin policy peer-read sobre `app_user`)

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

Feature E S6 (foundation del slice `members`, 2026-05-25) introdujo los 2 primeros queries directos del proyecto que requieren **lectura cross-user de `app_user`**: `loadMembers` necesita los `display_name`/`handle`/`avatar_url` de OTROS miembros del place (no sólo el propio), y `loadPendingInvitations` necesita el `display_name` del owner que creó cada invitación pending (que puede ser otro owner del place, no necesariamente el caller).

El intento inicial — JOIN directo a `app_user` desde estos queries — fracasó al ejecutar los tests TDD: alice (founder+owner del place) sólo recibía 1 fila (la suya), no las 3 esperadas. Diagnóstico:

- La policy `au_self` (`src/db/schema/index.ts:79-85`) declara `FOR ALL` con `(select app.current_user_id()) = ${t.authUserId}` — `app_user` es **self-only puro** para SELECT/INSERT/UPDATE/DELETE.
- ADR-0021 (`src/db/migrations/0004_member_read.sql`) extendió `place_sel` y `membership_sel` con el patrón "owner OR member-self", pero **NO tocó `app_user`** — porque el primer caso de uso (Hub `inbox`) no necesitaba cross-user app_user reads (sólo self-data via `app.get_inbox_payload()` SECURITY INVOKER).
- Los precedentes que JOIN-ean `app_user` (e.g. `loadPlaceBySlug`, `app.current_user_owns_place`, las DEFINER de Feature D/E) lo usan **siempre dentro de un EXISTS** que valida la identidad propia del caller (`au.auth_user_id = current_user_id`) — trivialmente compatible con `au_self`. Feature E es el primer flujo que necesita **leer atributos** de filas no-self.

La lógica de producto sí asume member peer-read: la ontologia (`docs/ontologia/miembros.md`) separa identidad universal (cross-place, en `app_user`) de identidad contextual (per-place, en `membership.headline` post ADR-0036), y deliberadamente no duplica `display_name`/`handle`/`avatar_url` en `membership` (single source of truth — un cambio de nombre se refleja en todos los places). La lista de miembros en `/settings/members` (CU canónico Feature E V1) presupone que el owner ve los nombres reales de los otros miembros, no IDs opacos. El gap entre la lógica de producto y la RLS quedó oculto hasta que la primera query no-DEFINER lo expuso.

## Decisión

**Extender el patrón canónico de ADR-0021 al 3er sujeto del trio `place`/`membership`/`app_user`.** Agregar una segunda policy `au_peer_member_read` (SELECT-only) sobre `app_user` que permite al caller leer las filas de otros usuarios con los que comparte una membership activa en algún place. Mantener `au_self` (FOR ALL) intacta para INSERT/UPDATE/DELETE de la propia fila — Postgres OR-ea automáticamente policies múltiples para la misma operación.

Predicado canónico de la nueva policy:

```sql
CREATE POLICY "au_peer_member_read" ON "app_user" AS PERMISSIVE FOR SELECT TO "app_system" USING (
  EXISTS (
    SELECT 1
      FROM membership my_m
      JOIN app_user my_au ON my_au.id = my_m.user_id
      JOIN membership other_m ON other_m.user_id = "app_user"."id"
                              AND other_m.place_id = my_m.place_id
     WHERE my_au.auth_user_id = (select app.current_user_id())
       AND my_m.left_at IS NULL
       AND other_m.left_at IS NULL
  )
);
```

Reglas de lectura derivadas (todas verificadas por tests estructurales en S6):

1. **Caller puede leer su propia fila** (por `au_self`).
2. **Caller puede leer la fila de otro user X** si existe un place P donde ambos tienen membership activa (predicado de la nueva policy).
3. **Caller NO puede leer la fila de un user X** sin membership compartida activa (sin place común, o ex-miembro de algún lado).
4. **Caller sin membership en ningún place** sólo lee su propia fila (degenera a comportamiento pre-ADR-0038).
5. **Owner del place P puede leer las filas de todos los miembros activos de P** — por invariante ADR-0035 §2 los owners son miembros (siempre tienen membership row), entonces la regla 2 los cubre naturalmente.
6. **INSERT/UPDATE/DELETE sobre `app_user`** siguen self-only (la policy `au_peer_member_read` es FOR SELECT — Postgres no la considera para otras operaciones).

## Alternativas rechazadas

- **`app.load_members(p_place_id) SECURITY DEFINER` + `app.load_pending_invitations(p_place_id) SECURITY DEFINER`.** Encapsula cada query consolidada en una DEFINER que bypasa la RLS de `app_user`. Funciona pero (a) duplica el patrón establecido por ADR-0021 con una variante incompatible (RLS vs DEFINER) sólo para Feature E; (b) cada feature futura que necesite cross-user reads tendría que armar su propia DEFINER en lugar de heredar; (c) el set de funciones DEFINER del proyecto crece linealmente con las queries en vez de mantenerse acotado a mutaciones críticas + consolidaciones cross-place (los 7 DEFINER actuales son todos mutadores o consolidaciones cross-place: `create_place`, `accept_invitation`, `get_inbox_payload`, `consume_sso_jti`, `elevate/revoke/transfer_ownership`, `create/revoke_invitation`, `remove_member`, `update_my_headline`). Rechazada por divergencia arquitectónica.

- **Extender `au_self` directo con el OR peer-read en la misma policy.** Más compacto sintácticamente, pero acopla self-mutation con cross-read en una sola regla — un futuro cambio sobre la regla de SELECT requeriría revisar también la lógica de INSERT/UPDATE/DELETE. Dos policies separadas (una FOR ALL self-only, otra FOR SELECT peer-read) son más auditables y separan concerns (mutación de identidad propia vs lectura de identidad de pares). Rechazada por claridad/mantenibilidad.

- **Re-scope S6 a "types-only", postergar queries a S6.5 (schema) + S6.6 (queries).** Estricto al plan-sesiones original que lockeaba migrations en S6, pero triplica el overhead operacional por algo que es un schema delta lineal con el resto del slice. Rechazada por costo/beneficio.

- **Materializar `display_name`/`handle`/`avatar_url` en `membership` (denormalización).** Evitaría el JOIN cross-user pero rompe single-source-of-truth (un cambio de nombre requeriría UPDATE en N tablas), introduce drift potencial entre `app_user.display_name` y `membership.cached_display_name`, y duplica storage. Rechazada por consistencia.

- **VIEW SECURITY DEFINER que pre-agrega los JOINs.** Mezcla concerns (vista de presentación vs regla de acceso) — mismo problema que ADR-0021 rechazó para `place_sel`. Rechazada por consistencia con el patrón canon.

## Consecuencias

- **Migration `0021_rls_app_user_peer_member_read.sql`** (Feature E S6) implementa el patrón:
  - CREATE POLICY `au_peer_member_read` ON `app_user` FOR SELECT con el predicado del §"Decisión".
  - Sin DROP de `au_self` — Postgres OR-ea las dos para SELECT y aplica sólo `au_self` para mutaciones.

- **Sin breaking changes en code existente.** La extensión sólo agrega filas visibles para usuarios que antes no veían nada en `app_user` cross-user. Verificable: hoy ningún Server Action asume "el caller sólo lee su propia fila de `app_user`" — todos los SELECT a `app_user` desde código existente son via JOIN con `auth_user_id = current_user_id` (self-implicit). El nuevo path peer-read se desbloquea sólo para queries que JOIN a `app_user.id = <otra>.user_id` cross-user (loadMembers/loadPendingInvitations son los primeros).

- **Schema `src/db/schema/index.ts`** se actualiza para reflejar la nueva policy (SoT TypeScript de las policies — drizzle-kit la verifica contra el schema cuando regenera).

- **Tests estructurales** (`src/db/__tests__/au-peer-member-read.test.ts`, ~6 tests) cubren las 6 reglas del §"Decisión":
  - T1: caller en place P lee app_user de otro miembro de P (happy).
  - T2: caller cross-place NO lee app_user de user en place sin overlap (isolation).
  - T3: caller NO lee app_user de ex-miembro (`left_at NOT NULL` filter).
  - T4: caller sin membership en ningún place lee sólo su propia fila (degenera a self-only).
  - T5: owner sigue leyendo app_user de todos los miembros (regla 2 lo cubre por invariante ADR-0035 §2).
  - T6: au_self sigue gating INSERT/UPDATE/DELETE self-only (la nueva policy NO los afecta).

- **Tests TDD del slice members** (`src/features/members/queries/__tests__/load-members.test.ts` T7) se ajustan en una expectativa: pre-ADR-0038 esperaba que carol (miembro no-owner) recibiera `[]`; post-ADR-0038 recibe su propia membership row (porque `membership_sel` ADR-0021 ya permitía self-read + ahora `app_user` se desbloquea para la JOIN). Comportamiento correcto y consistente con el patrón canon — el page consumer (`/settings/members`, S11) sigue siendo owner-only por su propia decisión de producto.

- **Performance**: la nueva policy agrega un EXISTS con 3-table JOIN (`membership × app_user × membership`). Para una operación frecuente (cada JOIN a `app_user` en una query con caller no-self dispara el EXISTS), conviene cubrir el index path:
  - `idx_membership_user_active(user_id, left_at, place_id)` ya existe (migration 0004) — cubre `my_m WHERE my_au.id = my_m.user_id AND my_m.left_at IS NULL`.
  - JOIN `other_m WHERE other_m.user_id = X AND other_m.place_id = my_m.place_id AND other_m.left_at IS NULL` se beneficia del mismo índice si Postgres pickea `user_id` como entry — verificar con `EXPLAIN ANALYZE` durante implementación. Si surge regresión, agregar `idx_membership_place_user_active(place_id, user_id, left_at)` (no presente hoy).

- **No hay recursión RLS**: el EXISTS de `au_peer_member_read` invoca `membership_sel` que es "owner-OR-self" (ambos no-recursivos sobre `app_user`). El otro EXISTS interno también lee `app_user` — Postgres aplica la policy `au_self` para esa lectura (la propia fila del caller para resolver `my_au.auth_user_id = current_user_id`), trivialmente OK.

- **Esta ADR queda como referencia canónica** del 3er sujeto del trio. El patrón ADR-0021 + ADR-0038 cubre el caso "user X comparte place activo con el caller". Cualquier extensión futura (e.g. permisos basados en grupos dentro del place, peer-read sólo dentro de zonas específicas) se registra en una ADR que refine ésta. Si surge un caso donde el predicado natural sea "share archived place" o "share past membership", se evalúa allí.

## Detalle operativo canónico

- SQL canónico de la migration: `src/db/migrations/0021_rls_app_user_peer_member_read.sql`.
- Schema TypeScript: `src/db/schema/index.ts` (policy adjunta a `appUser` table junto a `au_self`).
- Tests estructurales del policy: `src/db/__tests__/au-peer-member-read.test.ts`.
- Queries que dependen del patrón: `src/features/members/queries/load-members.ts`, `src/features/members/queries/load-pending-invitations.ts` (Feature E S6).
- Función de identidad: `app.current_user_id()` (ADR-0011, sin cambios).
- Filtro de actividad: `left_at IS NULL` en ambos `membership` lados (consistente con ADR-0021).
- Cross-zona: la policy no depende del path apex/custom-domain — `app.current_user_id()` lee el claim `sub` inyectado por `getAuthenticatedDbForRequest` (ADR-0034), que es zone-aware. El peer-read funciona transparentemente en ambas zonas.
