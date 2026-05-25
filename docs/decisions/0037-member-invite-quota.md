# 0037 — Cupo configurable de invitaciones por miembro (V1 schema-only)

- **Fecha:** 2026-05-24
- **Estado:** Aceptada
- **Alcance:** modelo de datos (nueva columna `place.member_invite_quota`), Feature E (members slice V1), invitation flow futuro (V2+)
- **Refina:** ADR-0010 §2 ("Invitación por token-link, owner crea, expirable") — la canónica original asumía implícitamente "sólo owner invita" como propiedad estática del modelo. ADR-0037 introduce **cupo configurable per-member** como mecanismo opt-in para que el owner habilite a miembros específicos a invitar, sin remover el invariante "owner siempre puede invitar". V1 ships sólo el schema; V2+ agrega UI + gate en `app.create_invitation`.
- **Supersede:** nada.

Las ADR son registro histórico: no se editan, se reemplazan/cierran con una nueva ADR.

## Contexto

Durante la planning de Feature E (members slice) el 2026-05-24, el user pidió que el modelo de invitaciones soporte que "miembros también puedan invitar" — no sólo el owner — pero gateado por un cupo configurable que el owner controla. Citas literales del user durante la sesión:

> "checquea si es owner salta la restriccion"

> "si la invitacion no fue aceptada el miembro podra eliminarla o cancelarla y volver a usarla para invitar a alguien mas"

> "Estoy de acuerdo con vos que solo owner invita en este momento, pero quiero que documentemos las decisiones por que de lo contrario quedaran abiertas a interpretacion"

La tensión que cierra esta ADR: ADR-0010 §2 canonizó "owner crea invitación" como propiedad estática del modelo. Esto era correcto para V1 (single-owner, comunidad chica, MVP) pero no escala al caso real "comunidad establecida donde el owner quiere delegar growth a miembros confiables sin renunciar a control sobre el ritmo de incorporación". El cupo configurable resuelve la tensión sin tocar el invariante "owner siempre puede invitar" — el owner queda exento del cupo y conserva la capacidad ilimitada de invitar; el cupo es la palanca que abre opcionalmente el grifo a los miembros no-owner.

La decisión de **ship V1 schema-only** (sólo la columna, sin UI, sin gate logic, sin counter) es deliberada: la UI + gate function son trabajo de V2+; el schema (1 columna en `place`) es suficientemente simple para shipear con Feature E sin scope creep. Esto es **forward-compat consciente**: si V2 nunca llega, la columna queda dormida sin costo runtime (DEFAULT 0, comportamiento idéntico al ADR-0010 original — sólo owner invita). Si V2 llega, el schema ya está y no se requiere migration de columna nueva en `place` (sólo migration del counter en `membership` + refactor de `app.create_invitation`).

## Decisión

### 1. Cupo place-wide configurable (V1 schema-only)

Nueva columna en `place`:

```sql
ALTER TABLE place
  ADD COLUMN member_invite_quota INT NOT NULL DEFAULT 0
  CHECK (member_invite_quota >= 0);
```

Semántica: cantidad máxima de invitaciones que cada miembro no-owner del place puede crear. Aplica uniformemente a todos los miembros no-owner (un solo número, no override per-member en V1). Editable runtime por el owner via UI futura (V2+); en V1 sólo se puede modificar via SQL directo, lo que es aceptable porque el comportamiento V1 no consulta la columna todavía.

### 2. Owner exento del cupo

El cupo aplica **sólo** a callers que NO son owners del place. Si `app.current_user_owns_place(p_place_id) = true` (helper canónico ADR-0035 §3), `app.create_invitation` bypasea el chequeo de cupo en V2+ y siempre permite crear la invitación. Esto preserva el invariante "owner siempre puede invitar" sin requerir setear `member_invite_quota = ∞`, sin case-especiales en el callsite, y sin que el owner se vea afectado por cambios runtime del valor del cupo (el owner podría setear `member_invite_quota = 0` y aun así seguir invitando — el cupo es palanca para miembros, no auto-limitación).

Multi-owner (ADR-0035 §1): cualquiera de los N owners del place está exento. La exención es por rol (owner del place), no por slot (founder vs co-owner) — el helper `app.current_user_owns_place` ya retorna `true` para cualquier owner del place.

### 3. Default seguro = 0 (opt-in del owner)

Al crear un place (`app.create_place`, ADR-0012 §3 + Feature D S5/migration 0016), `member_invite_quota = 0` por DEFAULT de la columna. Esto significa: places nuevos arrancan en el modo histórico (sólo owner invita), idéntico al comportamiento pre-ADR-0037. El owner decide explícitamente, post-creación, cuándo subir el cupo y abrir la delegación a miembros.

Razón del default conservador: prevenir flood de invitaciones en places recién creados donde el owner todavía no decidió la política de membership. Modelo de seguridad opt-in (owner activa) es estructuralmente más seguro que opt-out (owner desactiva tras el daño hecho).

### 4. V1 ship schema-only

En V1 (Feature E):

- **Schema deltas:** la columna `place.member_invite_quota` existe, `NOT NULL DEFAULT 0`, con `CHECK (member_invite_quota >= 0)`. Se agrega en migration 0017 (Feature E S1) junto con `membership.headline` (ADR-0036) en una sola migration.
- **`app.create_invitation`** (Feature E S2, migration 0018): gate **hardcoded** = caller debe ser owner del place. Cuerpo: `IF NOT app.current_user_owns_place(p_place_id) THEN RAISE EXCEPTION 'caller is not an owner of this place'; END IF;`. **NO** consulta `member_invite_quota` todavía. El comportamiento runtime V1 es idéntico a ADR-0010 §2 — sólo owner invita.
- **UI:** el bloque "Cupo de invitaciones por miembro" en `/settings/members` **NO** se construye en V1. La columna queda dormida.
- **Counter `membership.invitations_used`:** **NO** se agrega en V1. Sin gate function que lo consulte, el counter es dead weight (ver §Alternativas rechazadas). Se agrega en V2+ junto con el gate.
- **Tests V1** cubren la columna estructural (NOT NULL, DEFAULT 0, CHECK >= 0, editabilidad via UPDATE); **NO** cubren gate por cupo (es V2+).

### 5. Cancelación libera cupo (decisión V2+ documentada upfront)

Cuando V2 agregue el gate por cupo, la lógica de cancelación de invitación NO aceptada decrementará el counter de la invitación liberada. El mecanismo concreto se cierra en la ADR V2 (probablemente: `app.revoke_invitation` resta 1 a `membership.invitations_used` del `invitation.invited_by`, sólo si la invitación está en estado `pending` — si ya fue aceptada, el counter NO se libera porque la membership creada es el "consumo" definitivo del slot).

El user pidió documentar esta semántica **upfront en V1** (no diferirla al ADR V2) para que el modelo conceptual quede cerrado y no abierto a interpretación cuando V2 se implemente. Cita literal del user: "si la invitacion no fue aceptada el miembro podra eliminarla o cancelarla y volver a usarla para invitar a alguien mas".

Implicaciones del diseño "cancelación libera":

- Las invitaciones expiradas también liberan el slot (el counter refleja "invitaciones activas/aceptadas", no "invitaciones jamás creadas"). Detalle exacto del cleanup (job batch vs lazy on-read) queda V2+.
- Un miembro con cupo 5 puede crear-cancelar-crear-cancelar indefinidamente, siempre que en cualquier momento dado tenga ≤5 invitaciones pending + accepted. NO es un cap histórico ("creaste 5 alguna vez, fin"); es un cap concurrente.

### 6. Sin per-member override en V1

El cupo V1 es **place-wide**: un solo número en `place.member_invite_quota` que aplica uniformemente a todos los miembros no-owner. Override per-member (ej. "Lucía tiene cupo 50 porque es coordinadora informal de comunidad, el resto cupo 5") queda para V2+ si la UX lo demanda.

Razón: empezar simple. Per-member override añade complejidad de UI (lista de miembros con campo editable + fallback al default place-wide) y de schema (columna nullable en `membership` + `COALESCE` en el gate) sin que el caso de uso esté validado. V2+ puede agregarlo sin breaking change al ADR-0037 (la columna `place.member_invite_quota` sigue siendo el default fallback; `membership.invite_quota_override INT NULL` sería el override).

## Alternativas rechazadas

- **Implementar V1 completo: schema + UI + gate + counter en una sola sesión Feature E.** Rechazada: el user explícitamente delimitó V1 a "schema-only" durante la planning ("ok V2." en respuesta al gap de UI/gate). Scope discipline previene scope creep en Feature E (que ya cubre el slice members baseline); V2 puede arrancar sin schema migration nueva en `place`. Forward-compat sin coste runtime.
- **Default `member_invite_quota = ∞` o un valor alto (delegación by-default).** Rechazada: invierte el modelo de seguridad. Places nuevos arrancarían con todos los miembros pudiendo invitar — recipe para flood y abuso en MVP, especialmente en places que se popularizan rápido. Opt-in explícito por el owner es la postura segura por default; el owner activa la delegación cuando confía en la base de miembros.
- **Cupo global (un solo número compartido entre TODOS los miembros del place — "el place tiene 10 invitaciones para repartir").** Rechazada: confunde el grain. "El place tiene 10 invitaciones disponibles" es semánticamente distinto a "cada miembro puede crear hasta 10" — el segundo es lo que el user pidió y modela mejor delegación distribuida. El global cap es trivialmente expresable post-V2 via business logic (sumar `invitations_used` cross-membership y comparar contra un cap), pero el primitivo correcto en el schema es per-member.
- **Per-member override en `membership.invite_quota_override INT NULL` desde V1.** Rechazada: agrega columna + lógica de fallback (`COALESCE(membership.override, place.default)`) sin que el caso de uso esté validado por UX real. Postergable a V2+ sin breaking change — el schema V1 (`place.member_invite_quota` como default place-wide) sigue siendo el fallback natural.
- **Counter de invitaciones usadas (`membership.invitations_used`) en V1.** Rechazada: sin gate function que lo consulte (V1 es schema-only del cupo, no del gate), el counter es dead weight runtime — se actualizaría por nadie y se leería por nadie. Se agrega en V2 cuando entra el gate, sin daño por la espera (V1 no crea invitaciones de miembros no-owner — el gate hardcoded las bloquea, por lo tanto no hay nada que contar). Mantiene el principio "no añadir abstracciones por hipotéticos futuros" (CLAUDE.md § Reglas de vibecoding).
- **Quota expresada en `invitation` table (`invitation.quota_consumed boolean`).** Rechazada: confunde concerns. La quota es propiedad del INVITER (cuánto puede invitar antes de chocar contra el cap), no de la INVITATION (que es un evento ya creado). Mezclar ambos lleva a queries innecesariamente complejas en el gate ("contá las invitations donde inviter = X y quota_consumed = true" vs "leé `membership.invitations_used` del inviter").
- **Hardcoded en código TS (no DB column), ej. `const MEMBER_INVITE_QUOTA = 5` en un módulo de config.** Rechazada: el cupo debe ser editable runtime por el owner (V2+ feature explícito del user). Hardcode bloquea la editabilidad estructural y obligaría a redeploy para cambiarlo per-place — incompatible con el modelo multi-tenant del producto (cada place define su propia política).
- **Trigger DB-level (`BEFORE INSERT ON invitation`) que valide el cupo.** Rechazada: misma razón que en ADR-0035 §4 (alternativa "Trigger DB-level"). El trigger se evaluaría TAMBIÉN durante operaciones admin/migration/restore/seeding, complicando backup-restore (falsos positivos sin escape hatch). El patrón canónico del proyecto es WORM-via-DEFINER (ADR-0012 §3, ADR-0035 §4) — los invariantes viven en el cuerpo de las funciones DEFINER, no en triggers. V2+ agregará el gate en el cuerpo de `app.create_invitation`.

## Consecuencias

- **Schema delta (`docs/data-model.md` § "Schema base" → `place`):** nueva columna `member_invite_quota INT NOT NULL DEFAULT 0 CHECK (member_invite_quota >= 0)`. Documentar tipo, default, check y semántica ("cupo máximo de invitaciones concurrentes por miembro no-owner; owner exento; V1 schema-only").
- **Invariante nuevo (`docs/data-model.md` § "Invariantes del dominio"):** `place.member_invite_quota >= 0`; owner exento del cupo via `app.current_user_owns_place`; V1 sólo owner invita (gate hardcoded en `app.create_invitation`), V2+ agregará validación por cupo + counter en `membership.invitations_used` + liberación del slot en cancelación de invitación no aceptada.
- **Migration 0017 (Feature E S1):** `ALTER TABLE place ADD COLUMN member_invite_quota INT NOT NULL DEFAULT 0 CHECK (member_invite_quota >= 0)` — agregada junto con `membership.headline` (ADR-0036) en una sola migration para minimizar overhead de versionado.
- **`app.create_invitation`** (Feature E S2, migration 0018): gate V1 = caller debe ser owner del place via `app.current_user_owns_place(p_place_id)`; **NO** consulta `member_invite_quota` todavía. La columna queda dormida en V1 — leída por nadie, escribible sólo via SQL directo (UI V2+).
- **`app.create_place`** (ADR-0012 §3 + Feature D S5/migration 0016): **NO** cambia. El default de la columna (`DEFAULT 0`) cubre el caso — places nuevos arrancan con cupo 0 sin INSERT explícito. Sin refactor de la función.
- **UI:** bloque "Cupo de invitaciones por miembro" en `/settings/members` queda **diferido a V2+**. El user pidió V1 schema-only; la UI requiere también el counter + gate + UX de "miembro alcanzó su cupo" — todo trabajo V2+.
- **Tests V1 (Feature E, parte del set de tests del slice members):**
  - Test "place recién creado tiene `member_invite_quota = 0`" (verifica el DEFAULT).
  - Test "`INSERT INTO place` sin `member_invite_quota` aplica DEFAULT 0" (estructura).
  - Test "`UPDATE place SET member_invite_quota = -1` falla con CHECK violation" (constraint).
  - Test "`UPDATE place SET member_invite_quota = 5` succeeds" (placeholder de la editabilidad V2+; valida que la columna acepta valores >= 0).
  - Tests **NO** incluidos en V1: gate por cupo (no existe la function); counter increment/decrement (no existe la columna); UI editor (no existe).
- **Forward path V2+ (documentado, NO decidido en V1):**
  - UI editor en `/settings/members` (slider o input numérico, validación client-side >= 0).
  - Migration nueva: `ALTER TABLE membership ADD COLUMN invitations_used INT NOT NULL DEFAULT 0 CHECK (invitations_used >= 0)`.
  - Refactor de `app.create_invitation`: gate por `(app.current_user_owns_place(p_place_id)) OR (membership.invitations_used < place.member_invite_quota)`; en path miembro-no-owner exitoso, `UPDATE membership SET invitations_used = invitations_used + 1`.
  - `app.revoke_invitation` (nueva o refactor): decrementa el counter `membership.invitations_used` del `invitation.invited_by` cuando cancela una invitación en estado `pending` (no aceptada). Cita literal del user: "si la invitacion no fue aceptada el miembro podra eliminarla o cancelarla y volver a usarla para invitar a alguien mas".
  - Expiración de invitaciones libera slot (cleanup batch o lazy on-read; detalle V2+).
  - Posible per-member override (`membership.invite_quota_override INT NULL` con `COALESCE`) si UX lo demanda.
  - V2 ADR cerrará los detalles concretos cuando UX entre.
- **Sin breaking change al ADR-0010:** la canónica original sigue válida ("invitación por token-link, owner crea, expirable") — V1 sigue ese flow exacto (gate hardcoded = owner-only). ADR-0037 sólo introduce el SCHEMA del cupo (columna dormida) + la promesa de V2+ que abre el modelo a miembros bajo gate.
- **`docs/decisions/README.md`** (actualizado por agente paralelo): entry 0037 + nota de refinamiento junto a 0010.
- **`docs/decisions/0010-rls-por-operacion-invitacion-token-link.md`:** **NO se edita** (ADRs son inmutables). El refinement se nota únicamente vía esta ADR-0037 + el banner que README.md menciona.
- **Sin gotcha nuevo:** la columna NOT NULL + DEFAULT 0 garantiza que no hay path donde un place existente quede sin valor de cupo (back-fill implícito por el default). El comportamiento V1 (sólo owner invita) es idéntico al pre-ADR-0037 — cero superficie de drift runtime.

## Detalle operativo canónico

- Schema delta: `docs/data-model.md` § "Schema base" → `place` + § "Invariantes del dominio" (S0 Feature E actualiza ambos).
- Migration: `src/db/migrations/0017_*.sql` (Feature E S1) — agrega `place.member_invite_quota` junto con `membership.headline` (ADR-0036) en una sola migration.
- ADR previa de invitaciones (refinada acá): `docs/decisions/0010-rls-por-operacion-invitacion-token-link.md` §2.
- Spec del slice: `docs/features/members/spec.md` (S0 Feature E) — incluye CU "Crear invitación (V1 owner-only, V2+ owner OR miembro-con-cupo-disponible)".
- Función DEFINER que enforcea V1: `app.create_invitation` (Feature E S2, migration 0018) — gate hardcoded `app.current_user_owns_place`, sin consulta de cupo todavía.
- Patrón WORM-via-DEFINER (precedente): ADR-0012 §3 (`app.create_place`) + ADR-0035 §4 (`app.revoke_ownership`).
- Helper canónico de owner-check (usado por el gate V1 y por el gate V2+): `app.current_user_owns_place(text)` — ADR-0035 §3.
