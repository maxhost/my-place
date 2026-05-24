# 0035 — `place_ownership` multi-owner V1: WORM-via-DEFINER + founder no-delete + transferencia 1:1

- **Fecha:** 2026-05-24
- **Estado:** Aceptada
- **Alcance:** modelo de datos (ALTER `place`, refactor RLS `place_ownership`), multi-tenancy (RLS por-operación), saga de creación (refina ADR-0012 §3), lifecycle de cuenta (refina ADR-0003 §1 exención owner)
- **Refina:** ADR-0002 §1 (roles owner/miembro — multi-owner como invariante explícita), ADR-0003 §1 (exención owner = "≥1 place activo" interpretada literal post-multi-owner), ADR-0012 §2 (RLS `place_ownership` SELF reescrita en términos de "owner del place" vía helper `SECURITY DEFINER` no-recursivo) y §3 (`app.create_place` setea `place.founder_user_id`).
- **Supersede:** la asunción implícita "un place = un owner" que el schema previo permitía aunque nunca documentaba explícitamente.

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

Auditoría de cobertura RLS post-hardening de `place_domain` (2026-05-23, baseline `aaf238b`) detectó tres asimetrías estructurales del modelo `place_ownership` actual:

1. **Policies SELF, no OWNER-OF-PLACE.** Las policies `po_sel`/`po_upd`/`po_del` declaradas en `src/db/schema/index.ts:208-225` filtran "esta fila es mía" (`au.id = place_ownership.user_id AND au.auth_user_id = current_user_id`), no "soy owner del place de esta fila". Consecuencia: un owner NO puede ver, modificar ni eliminar la fila de ownership de OTRO owner del mismo place — la expulsión cross-owner es estructuralmente imposible con la policy actual.

2. **`po_upd` sin `WITH CHECK`.** La policy de UPDATE define `USING` pero omite `WITH CHECK`. Postgres deja pasar mutaciones que alteren el predicado de identidad: un `UPDATE` owner-A podría orfanizar la propia fila (cambiar `user_id` a un valor inválido) sin que la policy rechace el post-image. Asimétrico contra `place_domain_all` (`FOR ALL` con `USING == WITH CHECK`, hardening del 2026-05-23).

3. **No hay enforcement DB del invariante "mínimo 1 owner por place activo".** El invariante está documentado en `data-model.md:199` pero el motor no lo enforcea — un `DELETE` puede dejar el place huérfano si la app omite el chequeo. La defensa actual es 100% app-side (sin gates de hecho), ergo bypaseable si alguna ruta futura (admin script, migration, job) llega a SQL directo.

Además, el modelo conceptual sufre tres extensiones que las decisiones previas (ADR-0002/0003/0012) no abordaron explícitamente:

- **Multi-owner desde V1.** Un place puede tener N owners simultáneos (founder + co-owners invitados). Operacionalmente todos tienen los mismos permisos sobre el place (settings, billing, miembros, dominios). La distinción es de origen + asimetría de remoción.
- **Founder no-delete.** El creador del place ocupa un slot único (`place.founder_user_id`) que ningún otro owner puede revocar. La única vía de cambio es **transferencia 1:1**: el founder cede su slot a un owner pre-existente, queda como ex-owner (membership preservada), y el target asume el slot de founder.
- **Remoción de owner ≠ expulsión del place.** Cuando un owner es revocado (por otro owner que no sea él mismo), su fila `place_ownership` se elimina pero su `membership` se preserva: queda como miembro activo del place. Salida del place es operación separada (`membership.left_at`).

El user validó (2026-05-23) la opción más production-grade entre 3 alternativas para enforcear el invariante: **WORM-via-DEFINER** (Write-Once-Read-Many vía `SECURITY DEFINER`) — `REVOKE` direct INSERT/UPDATE/DELETE sobre `place_ownership` + canalizar toda mutación por funciones DEFINER que validan invariantes en el cuerpo. Mismo patrón que `app.create_place` (ADR-0012 §3) y `app.consume_sso_jti` (ADR-0032 §6).

## Decisión

### 1. Multi-owner como invariante estructural

Un place tiene **N owners simultáneos** (N≥1), representados como N filas en `place_ownership` con el mismo `place_id`. Todos los owners comparten el mismo poder operativo sobre el place (CRUD owner-only vía las policies de `place`/`membership`/`invitation`/`place_domain` que ya existen y no cambian). La asimetría se limita a **dos campos**:

- **Origen temporal** (`place_ownership.granted_at`, ya existe — ordering del slot).
- **Founder slot** (nueva columna `place.founder_user_id`): el `user_id` del owner que NO puede ser revocado por otro owner. Único per place.

Refina ADR-0002 §1 (que asumía implícitamente single-owner). El rol owner sigue siendo derivado (no se almacena en `membership`); la novedad es que N filas de `place_ownership` con el mismo `place_id` son válidas y deseadas.

### 2. Founder no-delete + transferencia 1:1

`place.founder_user_id` (nueva columna, `TEXT NOT NULL` post back-fill):

- Apunta a `app_user.id` (referencia lógica, sin FK hard — mismo criterio que `app_user.auth_user_id → neon_auth.user.id`, ADR-0006).
- Inmutable salvo por la función `app.transfer_founder_ownership(p_to_user_id, p_place_id)` (`SECURITY DEFINER`, §4).
- Back-fill (migration 0012): set inicial = `user_id` de la fila más antigua de `place_ownership` per place (criterio: `MIN(granted_at)`). Determinístico y aligned al spec (el creador es el owner inicial — invariante histórico).

Operaciones permitidas sobre `place_ownership` (vía 4 funciones DEFINER, §4):

- `app.create_place(...)` — ya existente (ADR-0012 §3); se refina en S5 para setear `place.founder_user_id := <caller user_id>` en el INSERT.
- `app.elevate_to_owner(p_to_user_id, p_place_id)` — caller debe ser owner del place; target debe ser miembro activo (`membership.left_at IS NULL`) del mismo place; INSERT fila en `place_ownership`.
- `app.revoke_ownership(p_target_user_id, p_place_id)` — caller debe ser owner del place; target NO puede ser `place.founder_user_id`; caller NO puede ser el mismo target (auto-revoke bloqueado — para "renunciar a owner sin transferir" el camino es `transfer_founder_ownership` si founder, o un futuro `step_down_as_owner` que no entra en V1); la `membership` del target NO se toca.
- `app.transfer_founder_ownership(p_to_user_id, p_place_id)` — caller debe ser el `founder_user_id` actual; target debe ser owner actual (NO el caller); en una sola transacción: `place.founder_user_id := target` + DELETE de la fila `place_ownership` del caller. Resultado: caller pierde ownership (queda como miembro), target asume founder slot.

Las 4 funciones validan invariantes en cuerpo y `RAISE EXCEPTION` estructural al caller — el wrapper TS futuro las mapeará a errores de dominio (`ElevateError`/`RevokeError`/`TransferError`). V1 no incluye wrappers TS ni UI — la primitive vive en el motor; los consumers se construyen en V1.1+.

### 3. RLS `place_ownership` reescrita en términos de "owner del place"

Reescribir las policies SELF a "owner del place" naïvely generaría el ciclo de recursión verificado y descartado en ADR-0012 §Contexto (Postgres aplica RLS al sub-SELECT sobre la propia tabla). La solución correcta es **helper `SECURITY DEFINER` no-recursivo** que bypassa la propia RLS por construcción:

```sql
CREATE OR REPLACE FUNCTION app.current_user_owns_place(p_place_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM place_ownership po
    JOIN app_user au ON au.id = po.user_id
    WHERE po.place_id = p_place_id
      AND au.auth_user_id = (select app.current_user_id())
  );
$$;
REVOKE EXECUTE ON FUNCTION app.current_user_owns_place(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION app.current_user_owns_place(text) TO "app_system";
```

El helper consulta `place_ownership` con privilegios del DEFINER (`neondb_owner` `BYPASSRLS`) → no aplica RLS al sub-SELECT → no hay recursión. Devuelve booleano puro; cero leak de filas concretas al caller.

Policies de `place_ownership` post-refactor:

- **SELECT (`po_sel`):** `app.current_user_owns_place(place_id)` — cualquier owner del place ve TODAS las filas de ownership de ese place (necesario para el UI futuro "miembros con permiso de gestión" del settings + para que la función `revoke_ownership` pueda validar pre-condiciones leyendo la lista de owners actuales sin DEFINER adicional).
- **INSERT/UPDATE/DELETE:** **NO HAY POLICY**. Toda mutación está denegada por construcción. Defense-in-depth: `REVOKE INSERT, UPDATE, DELETE ON place_ownership FROM "app_system"` (mismo patrón que `place`/`membership` en ADR-0012 §1). Las mutaciones van EXCLUSIVAMENTE por las 4 funciones DEFINER del §2.

### 4. Enforcement "mínimo 1 owner" vía WORM-via-DEFINER

El invariante "un place activo nunca queda sin owner" se enforcea en el cuerpo de las funciones DEFINER, no en RLS ni en triggers:

- **`revoke_ownership`** — `RAISE EXCEPTION` si `p_target_user_id = place.founder_user_id` (el founder no-delete bloquea por construcción el caso patológico "remover al último owner que también es founder"). Defense-in-depth adicional: el DELETE corre sólo si `(SELECT count(*) FROM place_ownership WHERE place_id = p_place_id) > 1` — segunda capa que aborta si el target es el único owner restante (caso `revoke_ownership` mal-llamado contra single-owner; no debería ocurrir post-founder-check pero se valida explícito para resistir cambios futuros del modelo).
- **`transfer_founder_ownership`** — flujo atómico (UPDATE founder + DELETE caller-ownership en la misma tx del DEFINER). Pre-condición estricta: el target es owner actual (es decir, hay ≥2 owners antes del transfer). Si N=1 (founder solo), el transfer es semánticamente "renunciar a founder sin sucesor" → bloqueado con error explícito ("transfer requiere target owner pre-existente; elevar primero con `app.elevate_to_owner`").

Razones del approach WORM-via-DEFINER vs alternativas:

- **App-only checks** son bypaseables (admin scripts, migrations, jobs).
- **Triggers DB-level** (`BEFORE DELETE`) se evaluarían TAMBIÉN durante operaciones admin/migration/restore, complicando backup-restore y seeding (falsos positivos sin escape hatch).
- **WORM-via-DEFINER** mueve la regla al borde correcto: la única superficie de mutación = las funciones; los invariantes son parte del contrato de cada función; admin con role `neondb_owner` puede bypasear (sin policy) sin que los invariantes interfieran. Es el patrón ya canónico del proyecto (`create_place`, `consume_sso_jti`).

### 5. Founder/co-owner exentos de inactividad mientras el place esté activo

Refina ADR-0003 §1 (exención owner): el wording original "owner de ≥1 place activo" se interpreta literal post-multi-owner — **cualquier** owner (founder o co-owner) extiende la exención mientras el place esté `subscription_status IN ('ACTIVE','PAYMENT_PENDING','INACTIVATION_PROCESS')` (es decir: no `INACTIVE` ni purga física). La revocación de ownership re-evalúa la condición: si el ex-owner deja de ser owner de ≥1 place activo y no tiene pago activo, la cuenta entra a la escala de inactividad la próxima vez que el job 6m/12m corra. Sin cambio de schema; el wording de `data-model.md` § "Invariantes del dominio" se actualiza en S0 para reflejarlo.

## Alternativas rechazadas

- **App-only enforcement del mínimo 1 owner.** Rechazada: bypaseable si una ruta futura llega directo a SQL (admin scripts, migrations, jobs). Choca con el principio "production-grade, no quick fix" — la defensa de un invariante crítico vive en el motor, no en el caller.
- **Trigger DB-level (`BEFORE DELETE`) que cuente owners restantes.** Rechazada: el trigger se evaluaría TAMBIÉN durante operaciones admin/migration/restore, complicando backup-restore y seeding. WORM-via-DEFINER no tiene este problema (admin sigue siendo bypaseable a nivel rol, sin recurso a triggers que sortear).
- **Mantener policies SELF en `place_ownership` + delegar expulsión a un endpoint app-only.** Rechazada: la asimetría "cualquier owner gestiona el place pero NO ve los demás owners" es semánticamente quebrada (el UI necesita listar co-owners para que el founder elija a quién revocar/transferir). Necesitamos SELECT cross-owner; el predicado "owner del place" lo da limpio sin filtraciones.
- **`is_founder boolean` en `place_ownership` (en vez de `place.founder_user_id`).** Rechazada: permite multi-founder accidental + no expresa el invariante "uno y solo uno" sin un constraint exotic (`UNIQUE (place_id) WHERE is_founder = true`). La columna scalar en `place` es la representación natural del invariante; cero ambigüedad y FK lógica limpia.
- **Permitir transfer si el founder es el único owner ("renunciar a founder sin sucesor").** Rechazada: el flujo de transferencia es semánticamente "ceder mi slot a alguien que ya ocupa rol de owner", no "elegir un nuevo founder de la nada". Si el founder está solo, primero debe `elevate_to_owner` a alguien, después `transfer_founder_ownership`. Dos pasos atómicos en lugar de uno con N+1 invariants implícitos.
- **`app.add_owner` que también auto-crea membership si el target no es miembro.** Rechazada: confunde concerns ("invitar a un place" y "elevar a owner" son operaciones distintas con UX, gating de email, y auditoría distintas). `elevate_to_owner` valida pre-condición `EXISTS membership activa` y `RAISE` error sino — el caller debe primero invitar/aceptar (flow de invitación existente, ADR-0010 §2).
- **Auto-revoke (un owner se quita a sí mismo de ownership directamente).** Rechazada V1: introduce un cuarto path (`step_down_as_owner`) que NO es founder + NO es co-owner-revoke. Diferido a V1.1+ — el caller que quiere renunciar a owner sin transferir puede coordinar con otro owner que lo revoque. Documentado como gap consciente en el spec (S0).

## Consecuencias

- **Schema (`src/db/schema/index.ts`):** `place.founderUserId` text (NULL durante back-fill, NOT NULL post-migration); refactor de policies `po_sel/upd/del` → única `po_sel` vía `app.current_user_owns_place(place_id)`; DROP de `po_upd`/`po_del` (sin reemplazo — `REVOKE` ya cubre).
- **Migration 0012 (S1):** `ALTER TABLE place ADD COLUMN founder_user_id text` (nullable) → back-fill `UPDATE place p SET founder_user_id = (SELECT po.user_id FROM place_ownership po WHERE po.place_id = p.id ORDER BY po.granted_at ASC LIMIT 1)` → `ALTER COLUMN founder_user_id SET NOT NULL` → `REVOKE INSERT, UPDATE, DELETE ON place_ownership FROM "app_system"` → `DROP POLICY po_upd, po_del ON place_ownership` → `DROP POLICY po_sel ON place_ownership` → `CREATE POLICY po_sel … USING (app.current_user_owns_place(place_id))` → `CREATE FUNCTION app.current_user_owns_place(text)` `SECURITY DEFINER` + `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO "app_system"`.
- **Migration 0013/0014/0015 (S2/S3/S4):** `app.elevate_to_owner` / `app.revoke_ownership` / `app.transfer_founder_ownership` `SECURITY DEFINER` + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO "app_system"`. Cada una con validación de invariantes en cuerpo + `SET search_path = public, pg_temp` anti-hijack.
- **Migration 0016 (S5):** `CREATE OR REPLACE FUNCTION app.create_place(...)` actualizada para incluir `INSERT INTO place (..., founder_user_id) VALUES (..., v_uid)` — el creador es el founder automático.
- **`docs/data-model.md`:** schema base agrega `founder_user_id` a `place`; invariantes refinan "mínimo 1 owner" (enforce DB-side vía DEFINER, no app-only) + nuevo invariante "founder slot único por place, no-delete por otro owner" + "transferencia founder requiere target owner pre-existente"; sección RLS de `place_ownership` refleja el refactor a single-policy vía helper; sección "Auth y SSO" no cambia.
- **`docs/multi-tenancy.md` § RLS:** bullet `place_ownership` reescrito — SELECT vía helper DEFINER, INSERT/UPDATE/DELETE denegadas + canalizadas por 4 funciones DEFINER.
- **`docs/decisions/0002-roles-gamificacion-handle.md`:** banner top "Refinada por ADR-0035 — multi-owner desde V1 + founder slot inmutable + transferencia 1:1 + cuerpo histórico intacto" (no se edita el cuerpo).
- **`docs/decisions/0003-lifecycle-cuenta-place-tombstone.md`:** banner top "Refinada por ADR-0035 — la exención owner se interpreta literal post-multi-owner: cualquier owner (founder o co-owner) extiende la exención mientras el place esté activo".
- **`docs/decisions/README.md`:** entry 0035 + notas de refinamiento junto a 0002/0003/0012.
- **`docs/gotchas/place-ownership-defining-functions-only.md`** (nuevo, S6): "no insertar/actualizar/borrar `place_ownership` desde código de feature — pasa por las 4 funciones DEFINER; síntoma de drift = `ERROR: permission denied for table place_ownership`".
- **Sin cambio UI V1.** Feature D V1 = DB + RLS + docs. La UI de "invitar co-owner" / "revocar owner" / "transferir founder" queda diferida (V1.1+): las funciones DEFINER son la primitive sobre la cual el UI futuro construye sin re-arquitectura.
- **Sin migración manual de places existentes (mecánica):** el back-fill de `founder_user_id` es idempotente y determinístico (criterio `MIN(granted_at)`); cualquier place pre-existente queda con su creador como founder automáticamente.

## Detalle operativo canónico

- Spec del slice: `docs/features/place-ownership/spec.md` (S0).
- Plan de implementación 6 sesiones (S1-S6): `docs/features/place-ownership/plan-sesiones.md` (S0).
- TDD checklist: `docs/features/place-ownership/tests.md` (S0).
- Patrón WORM-via-DEFINER: ADR-0012 §3 (`app.create_place`), ADR-0032 §6 (`app.consume_sso_jti`), esta ADR §4 (las 3 funciones de ownership).
- Patrón helper `SECURITY DEFINER` anti-recursión: esta ADR §3 (`app.current_user_owns_place`), precede ADR-0031 §5 (`app.lookup_place_by_domain` anonymous-safe lookup).
- RLS recursion-safe canónica: ADR-0012 §2.
- Rol/JWT + `app.current_user_id()`: ADR-0011 + `multi-tenancy.md` § RLS.
