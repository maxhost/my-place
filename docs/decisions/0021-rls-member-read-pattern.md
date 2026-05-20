# 0021 — Patrón canónico para member-read: extender `_sel` con `OR exists(membership activa)`

- **Fecha:** 2026-05-19
- **Estado:** Aceptada
- **Alcance:** arquitectura (RLS por-operación), data-model (policies de `place` y `membership`), backend (todas las features que necesiten "miembro puede leer entidad del place")
- **Refina:** ADR-0010 §1 — cierra el TBD "el acceso de miembros se agrega por-feature, encima, después" eligiendo el cómo de forma canónica

Las ADR son registro histórico: no se editan, se reemplazan con una nueva ADR que la supersede.

## Contexto

ADR-0010 §1 (RLS por-operación) declaró que `place`, `membership`, `place_ownership`, `invitation`, `place_domain` tienen policies de SELECT/UPDATE/DELETE **owner-only** (predicado vía `place_ownership`). Y explicitó: *"El acceso de miembros NO está en la base (deliberado): se agrega por-feature, encima, después."* No eligió el cómo — dejó la decisión para cuando la primera feature lo necesitara.

La spec del **Hub** (`docs/features/inbox/`, V1) es esa primera feature: la vista "Tus lugares" del usuario autenticado lista places donde es **owner O miembro activo**. Sin un patrón para el member-read, cada feature futura inventaría el suyo (SECURITY DEFINER ad-hoc por endpoint, view distinto por shape, bypass de RLS server-side, etc.) — riesgo de inconsistencia y duplicación.

Esta ADR fija el patrón canónico **para todas las features futuras** que necesiten "miembro puede leer una entidad ligada a un place donde tiene membresía activa".

## Decisión

1. **Member-read se implementa extendiendo la policy `_sel` de la tabla** con un segundo `EXISTS` que valida membresía activa del user actual al `place_id` de la fila. Patrón:

   ```sql
   CREATE POLICY "<tabla>_sel" ON <tabla> FOR SELECT TO app_system USING (
     -- Owner (predicado existente, no cambia)
     EXISTS (SELECT 1 FROM place_ownership po
             JOIN app_user au ON au.id = po.user_id
             WHERE po.place_id = <tabla>.place_id
               AND au.auth_user_id = (select app.current_user_id()))
     OR
     -- Member activo (nuevo)
     EXISTS (SELECT 1 FROM membership m
             JOIN app_user au ON au.id = m.user_id
             WHERE m.place_id = <tabla>.place_id
               AND m.left_at IS NULL
               AND au.auth_user_id = (select app.current_user_id()))
   );
   ```

2. **Para `membership` específicamente**, el predicado de member-read es **self** (cada user ve sus propias rows), no "miembro del place" — sino tendríamos recursión semántica y filtraría rows que el user no debería poder leer (las membresías de los OTROS miembros sólo las ve el owner del place). Patrón concreto para `membership_sel`:

   ```sql
   CREATE POLICY "membership_sel" ON membership FOR SELECT TO app_system USING (
     -- Owner del place ve TODAS las membresías de su place
     EXISTS (SELECT 1 FROM place_ownership po
             JOIN app_user au ON au.id = po.user_id
             WHERE po.place_id = membership.place_id
               AND au.auth_user_id = (select app.current_user_id()))
     OR
     -- Cualquier user ve SUS propias membresías (self)
     EXISTS (SELECT 1 FROM app_user au
             WHERE au.id = membership.user_id
               AND au.auth_user_id = (select app.current_user_id()))
   );
   ```

3. **INSERT, UPDATE, DELETE siguen owner-only** (sin cambios). Miembros sólo ganan SELECT. Mutaciones de un miembro (e.g. "salir del place", "editar mi membership") entran cuando esas features se construyan, vía función `SECURITY DEFINER` específica (mismo patrón que `app.accept_invitation`).

4. **El primer caso de uso** es `place_sel` + `membership_sel` (extendidos por la migration de la sesión 1 del hub, `0004_member_read.sql`). Toda feature futura que necesite member-read extiende la `_sel` de la entidad correspondiente con el mismo OR (e.g. cuando la feature "biblioteca" requiera que miembros vean recursos, se agrega `OR exists(membership activa)` a `resource_sel`).

5. **`app.current_user_id()` sigue como función canónica de identidad** (ADR-0011, sin cambios).

## Alternativas rechazadas

- **Función `SECURITY DEFINER` por feature** (e.g. `app.get_place_by_slug_for_member()`). Encapsula la lógica pero: (a) no escala — se agregaría una función por cada vista/query distinta de miembro; (b) duplica la regla de acceso en función vs RLS; (c) menos auditable (la regla "quién puede leer place" se reparte entre función y policy). Rechazada por falta de escalabilidad arquitectónica.

- **Bypass de RLS server-side** (rol privilegiado en queries específicas). Rompe la frontera "RLS como ground truth"; expone superficie nueva (¿qué Server Action puede bypassar?); contradice ADR-0006/0010 (RLS-first). Rechazada por seguridad.

- **VIEW SQL con SECURITY DEFINER** que filtra por user. Mezcla concerns (vista de presentación vs regla de acceso); las VIEWs son más difíciles de evolutionizar sin breaking changes. Rechazada por mantenibilidad.

- **Materializada/cache de "places del user"** actualizada vía triggers. Optimización prematura — el OR + índice `(user_id, left_at, place_id)` da <30ms p50 según target del spec del hub. Si en el futuro la performance no alcanza, se evalúa entonces.

## Consecuencias

- **Migration `0004_member_read.sql`** (sesión 1 del hub) implementa el patrón por primera vez para `place_sel` y `membership_sel`. Incluye índice `idx_membership_user_active(user_id, left_at, place_id)` para soportar el filtro principal del nuevo `EXISTS`.

- **Tests RLS** (`src/db/__tests__/rls.test.ts`) ganan 3 casos nuevos: miembro activo VE place; miembro con `left_at NOT NULL` NO VE place; miembro VE su row de membership pero NO la de otros. La suite existente cubre la regresión (owner sigue viendo todo).

- **Sin breaking changes en el resto del repo**: la extensión sólo **agrega** filas visibles para usuarios que antes no veían nada en `place`/`membership` (los miembros no-owner). Ningún Server Action existente asume "sólo owners ven X" en código (verificable: hoy no hay SELECT a `place` desde features que sean ejecutadas por miembros — el único SELECT a `place` por slug es placeholder de la spec de "place miembro UI", futuro).

- **Performance**: el `OR` duplica el predicado. Con índices `place_ownership(user_id, place_id)` (UNIQUE, existente) e `idx_membership_user_active`, el plan de query debería usar index scan en ambos `EXISTS`. Verificar con `EXPLAIN ANALYZE` durante implementación si surge regresión.

- **No hay recursión RLS**: el `EXISTS (SELECT 1 FROM membership m WHERE ...)` dentro de `place_sel` invoca `membership_sel`. La nueva `membership_sel` chequea `place_ownership` (owner-only, no recursivo) **o** self (no recursivo). Cierre: ningún predicado se auto-referencia. Verificado por los tests existentes "sin recursión" (`rls.test.ts:48`).

- **Esta ADR queda como referencia canónica** para futuras features. Cualquier feature que necesite "miembro puede leer X del place" extiende `X_sel` con el OR del patrón. Si surge un caso que el patrón no cubre (e.g. permisos más finos que "miembro vs no-miembro"), se registra una nueva ADR que refine este.

## Detalle operativo canónico

- SQL canónico de la migration: `src/db/migrations/0004_member_read.sql`.
- Función de identidad: `app.current_user_id()` (ADR-0011, sin cambios).
- Filtro de actividad de membresía: `left_at IS NULL` (membresía activa). Una membresía con `left_at` setteado representa al user que salió o fue removido del place — pierde el acceso de lectura inmediatamente al setearse.
- Para tablas que no tienen `place_id` directamente pero están "dentro" de un place (e.g. `comment` dentro de `discussion` dentro de `place`): el patrón aplica al join transitivo, no a la entidad directa. La feature lo resuelve agregando join en su predicado de RLS.
