# 0012 — Creación de place vía función `SECURITY DEFINER`; INSERT denegado por RLS

- **Fecha:** 2026-05-17
- **Estado:** Aceptada
- **Alcance:** auth (fundamento), multi-tenancy (RLS), modelo de datos, saga de creación (ADR-0005/0008), seguridad
- **Supersede:** ADR-0010 §1, la parte "`place`/`membership`/`place_ownership` — INSERT: cualquier usuario autenticado + `WITH CHECK` self-only". **Refina:** ADR-0005 §2 paso 3 (la tx de `public` pasa a ser una función atómica). **Reusa sin cambios:** ADR-0011 (función de identidad), ADR-0008 (dos modos), el resto de ADR-0010 (SELECT/UPDATE/DELETE owner-only, invitación token-link).

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

Al implementar S2 (RLS por-operación — el punto crítico: "si falla, nada sirve") se verificó empíricamente sobre el branch `test` con el rol real `app_system` (`NOBYPASSRLS`):

1. **Recursión RLS.** El predicado owner literal de ADR-0010/`multi-tenancy.md` (`EXISTS (SELECT 1 FROM place_ownership po …)`), aplicado a la policy de `place_ownership` **sobre sí misma**, produce `ERROR: infinite recursion detected in policy for relation` (Postgres aplica RLS a las tablas referenciadas dentro de una policy; una policy auto-referencial recursa). Probado y reproducido 2026-05-17.

2. **`WITH CHECK` self-only no puede enforcear "ni en place ajeno".** ADR-0010 §1 pedía un `WITH CHECK` que garantice insertarse "solo a sí mismo … ni en place ajeno". El "a sí mismo" es expresable (self-only vía `app_user`). El "ni en place ajeno" **no** lo es con pura-RLS:
   - Al crear un place no existe aún la fila de ownership (chicken-egg): una regla "tenés que ser owner del place" rechazaría también la creación legítima.
   - La única regla que sobrevive a la creación legítima es self-only (`user_id` de la fila = tu `app_user`). Pero esa misma regla deja pasar a un usuario autenticado B que inserte `place_ownership(user_id = B, place_id = place de A)` — B se autoasigna **co-owner de un place ajeno existente**. Es **escalación de ownership** (y, de ahí, CRUD completo sobre el place ajeno vía las policies owner-only de SELECT/UPDATE/DELETE, que **sí** están enforceadas).
   - Distinguir "A creando su place" de "B agarrando el de A" requiere saber si el place ya tiene **algún** owner — dato que RLS le **oculta** a B (las filas de ownership ajenas no le son visibles). Verlo requiere **bypassear RLS**, lo que con pura-RLS es imposible.

La conclusión: el cierre correcto de "ni en place ajeno" **no** es un predicado RLS más astuto; es **no permitir el INSERT directo** y canalizar la creación por una **función de confianza** privilegiada — el mismo patrón que ADR-0010 §2 ya usa para aceptar invitaciones y que ADR-0011 usa para la identidad.

## Decisión

### 1. INSERT directo de creación denegado por RLS

`place`, `place_ownership` y `membership` **no tienen policy de INSERT** para `app_system` → el INSERT directo queda **denegado por construcción**. Defense-in-depth: además se `REVOKE INSERT` de esas tres tablas a `app_system` (RLS ya lo niega; el revoke lo hace explícito y robusto). `app_system` conserva SELECT/UPDATE/DELETE (sujetos a las policies owner-only) sobre ellas.

`app_user` (self-only `FOR ALL`), `invitation` (owner-only `FOR ALL`) y `place_domain` (owner-only `FOR ALL`) **sí** conservan INSERT por RLS: ahí no hay chicken-egg ni agujero (al insertar un `app_user` su `auth_user_id` debe ser el claim del caller; al insertar una `invitation`/`place_domain` el place y su ownership ya existen → el predicado owner-only se evalúa bien).

### 2. RLS owner-only recursion-safe (cierra el hallazgo 1)

El predicado owner-only de SELECT/UPDATE/DELETE se mantiene como ADR-0010, con una precisión obligatoria de fraseo para evitar la recursión:

- **`place_ownership` — SELECT/UPDATE/DELETE:** "esta fila de ownership es mía", **referenciando `app_user`, nunca `place_ownership`**:
  ```sql
  EXISTS (SELECT 1 FROM app_user au
          WHERE au.id = place_ownership.user_id
            AND au.auth_user_id = (select app.current_user_id()))
  ```
  Es la única forma recursion-safe y es semánticamente idéntica al intent (el owner ve/gestiona su propia fila de ownership).
- **`place` / `membership` / `invitation` / `place_domain` — SELECT/UPDATE/DELETE:** owner-only vía `place_ownership` (predicado de ADR-0010). El sub-`SELECT` sobre `place_ownership` aplica la policy no-recursiva de arriba → termina (vía `app_user`, cuya policy no tiene sub-query). Verificado: aislamiento real entre places, sin recursión.
- **`app_user` — `FOR ALL`:** `(select app.current_user_id()) = auth_user_id` (USING + WITH CHECK). Sin cambios.
- **`place_domain` entra al conjunto owner-only `FOR ALL`** (cierra una omisión de enumeración de `multi-tenancy.md`/ADR-0010, que no lo listaba; dejarlo sin RLS expondría los custom domains de cualquier place a todo `app_system`).

### 3. Creación de place vía `app.create_place(...)` (`SECURITY DEFINER`)

Función propia, versionada en la migración (como `app.current_user_id()`), **dueño = `neondb_owner`** (rol privilegiado de migraciones, `BYPASSRLS`), **`EXECUTE` solo a `app_system`** (`REVOKE EXECUTE … FROM PUBLIC`):

```sql
CREATE OR REPLACE FUNCTION app.create_place(
  p_slug text, p_name text, p_description text,
  p_theme_config jsonb, p_opening_hours jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp        -- anti-hijack, obligatorio en DEFINER
AS $$
DECLARE
  v_auth text := app.current_user_id();  -- identidad del caller, NO parámetro
  v_uid  text;
  v_pid  text;
BEGIN
  IF v_auth IS NULL THEN
    RAISE EXCEPTION 'no autenticado' USING errcode = '28000';
  END IF;
  SELECT id INTO v_uid FROM app_user WHERE auth_user_id = v_auth;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'app_user inexistente para el caller' USING errcode = 'P0002';
  END IF;
  INSERT INTO place (slug, name, description, theme_config, opening_hours,
                     billing_mode, subscription_status, trial_ends_at, enabled_features)
  VALUES (p_slug, p_name, p_description, p_theme_config, p_opening_hours,
          'OWNER_PAYS', 'ACTIVE', now() + interval '30 days', '[]'::jsonb)
  RETURNING id INTO v_pid;                -- place_id lo GENERA la DB, no se acepta de afuera
  INSERT INTO place_ownership (user_id, place_id) VALUES (v_uid, v_pid);
  INSERT INTO membership      (user_id, place_id) VALUES (v_uid, v_pid);
  RETURN v_pid;
END;
$$;
```

Propiedades de cierre (por construcción, no por predicado):

- **No acepta `place_id` de afuera** → la función genera uno nuevo (`gen_random_uuid()` default). B no puede apuntar ownership a un place ajeno: la única vía de INSERT siempre crea un place fresco.
- **Caller desde `app.current_user_id()`, no parámetro** → B no puede crear a nombre de otro.
- **Billing/trial deterministas** (`OWNER_PAYS`/`ACTIVE`/`now()+30d`/`enabled_features=[]`, ADR-0005 §3) fijados dentro → el caller no los puede falsear.
- **`SECURITY DEFINER` + `SET search_path` fijo** (anti-hijack) + dueño `neondb_owner` (BYPASSRLS, hace los 3 INSERT pese a que `app_system` no tiene policy de INSERT) + `EXECUTE` solo `app_system`.
- **Atómica**: corre en la tx del caller; falla parcial → rollback de los 3 inserts (estrictamente más robusto que la tx de 3 inserts separados de ADR-0005 §2 — sin orfanatos dentro de `public`).
- **Slug único**: lo enforcea el `UNIQUE` de S1; la violación propaga y la maneja el Server Action (S5) como "slug ocupado". `reserved-slugs` sigue siendo validación de app (lista estática/UX, no frontera de seguridad).
- **No idempotente per se** (cada llamada crea un place): la idempotencia del submit y el estado "cuenta sin place" (ADR-0005 §4, ADR-0008 §4) se manejan en el Server Action (S5), sin cambios.

### 4. La saga (ADR-0005 §2 / ADR-0008) — refinada, no eliminada

La saga sigue siendo un Server Action con los **dos modos** de ADR-0008 (place-first y authed) — sin cambios de UX ni de modos. Lo que cambia: el **paso 3 (tx de `public`: place+ownership+membership)** deja de ser tres INSERT en una tx Drizzle y pasa a ser **una llamada `SELECT app.create_place(...)`**. El Server Action mantiene: Zod del payload, slug-format + `reserved-slugs`, guardrail de contraste server-side, `opening_hours` default 09–20 en tz del owner, `signUp` (modo place-first) / `ensureAppUser` (ambos modos), mapeo de slug-dup, estado "cuenta sin place". `signUp` (Neon Auth) y `ensureAppUser` siguen fuera de la función (identidad en `neon_auth`, cross-system — ADR-0005 §2 sigue válido en eso).

## Alternativas rechazadas

- **`WITH CHECK` self-only literal (ADR-0010 §1 tal cual).** Deja la escalación de ownership descripta en Contexto §2. Rechazada: agujero de seguridad real en la sesión crítica; choca con el estándar production-grade/no-gaps.
- **Helper `SECURITY DEFINER` (`place_has_owner`) dentro del `WITH CHECK`, manteniendo el INSERT directo (opción "A/C" evaluada en sesión).** Cierra el agujero y es más liviana, pero deja el INSERT como superficie directa y reparte la lógica de creación entre RLS y app. La función única (D) cierra **por construcción** (superficie de INSERT directo = cero), unifica el modelo con la aceptación de invitación (ADR-0010 §2, también `SECURITY DEFINER`) y centraliza/auditea la creación. Se eligió D por robustez production-grade (decisión explícita del owner, 2026-05-17).
- **Predicado RLS auto-referencial literal.** Recursión infinita (verificado). Rechazada; fraseo recursion-safe de §2.
- **Habilitar Neon RLS/Authorize o mover la lógica a la app sin RLS.** Ya rechazado en ADR-0011/ADR-0006; no se reabre.

## Consecuencias

- **`docs/multi-tenancy.md` § RLS:** reescribir el bullet de INSERT (denegado; creación vía `app.create_place`); agregar fraseo recursion-safe de `place_ownership`; sumar `place_domain` al conjunto owner-only; documentar la función.
- **`docs/features/onboarding/plan-sesiones.md`:** re-plan para D (S2 = RLS owner-only + INSERT-deny; S3 = función `create_place`; saga cableada a la función; renumeración). Análisis de gaps incluido.
- **`docs/features/onboarding/tests.md`:** § Casos críticos — los bullets de "INSERT por-operación / WITH CHECK self-only" se reemplazan por "INSERT directo denegado; `create_place` asigna al caller un place fresco; B no puede crear en place ajeno"; el bloque de saga apunta a la función.
- **`docs/data-model.md`:** nota: las escrituras de `place`/`place_ownership`/`membership(creador)` solo por `app.create_place`; `place_domain` es owner-only RLS.
- **Source-of-truth de funciones DB:** `app.create_place` y `app.current_user_id()` se escriben a mano en la migración (Drizzle no modela funciones `SECURITY DEFINER`); `src/db/schema/` modela tablas + policies (`pgPolicy`/`pgRole('app_system').existing()`). drizzle-kit no gestiona funciones → sin drift.
- ADR-0010 sigue válido salvo §1-INSERT (superseded acá). ADR-0005 §2 paso 3 se lee con este refinamiento. ADR-0006/0008/0011 sin cambios.

## Detalle operativo canónico

- RLS recursion-safe + función de creación + rol/JWT: `docs/multi-tenancy.md` § RLS.
- Plan de implementación y gaps: `docs/features/onboarding/plan-sesiones.md`.
- Modelo RLS/invitación previo: ADR-0006, ADR-0010. Identidad: ADR-0011. Saga/modos: ADR-0005, ADR-0008.
