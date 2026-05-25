# Members slice V1 — Spec

> _Spec creado 2026-05-24 (S0 de Feature E — members). Status: planificación. Decisiones canónicas: [ADR-0035](../../decisions/0035-place-ownership-multi-owner-v1.md) (multi-owner + WORM-via-DEFINER — Feature D ya cerrada), [ADR-0036](../../decisions/0036-member-bio-contextual.md) (`headline` per place), [ADR-0037](../../decisions/0037-member-invite-quota.md) (`member_invite_quota` V1 schema-only). Plan operativo en [`./plan-sesiones.md`](./plan-sesiones.md). Tests TDD checklist en [`./tests.md`](./tests.md). Baseline pre-implementación: `baseline/pre-feature-e` = `ff1d18c`._

## Contexto

Feature D (`place-ownership` multi-owner V1) cerró end-to-end el 2026-05-24 con las 4 funciones `SECURITY DEFINER` (`app.current_user_owns_place`/`elevate_to_owner`/`revoke_ownership`/`transfer_founder_ownership`) + WORM-via-DEFINER sobre `place_ownership` + founder slot inmutable. Eso completó el modelo DB de **gobierno** del place. Feature E (members slice V1) construye sobre esa primitive el **slice consumer**: la página `/settings/members` que el owner usa día a día — listar miembros activos, ver invitaciones pendientes, invitar gente nueva, remover miembros, gestionar co-owners (elevar/revocar/transferir founder).

V1 cubre la **superficie operativa del owner sobre los miembros del place** + un complemento personal del miembro (editar su propio `headline`, ADR-0036). Cierra dos extensiones conceptuales que las decisiones previas no abordaban: bio contextual opcional (ADR-0036) y cupo configurable de invitaciones (ADR-0037, schema-only V1 con UI diferida a V2+).

Feature E es **producto consumer** sobre primitives ya estables; no introduce ningún nuevo invariante de gobierno (los 4 invariantes críticos viven en Feature D). Lo nuevo es: 3 funciones DEFINER consumer-grade (`create_invitation`/`revoke_invitation`/`remove_member`), 1 migration de schema (0017 — `headline` + `member_invite_quota`), 3 wrappers TS sobre las DEFINER de Feature D, 7 Server Actions, 3 componentes shared/ui extraídos, 5 componentes nuevos del slice, 1 page nueva, sidebar wiring + i18n ×6 locales.

## Modelo conceptual

Los 3 conceptos canónicos que Feature E representa en código:

**Member (miembro activo del place).** Una fila en `membership` con `left_at IS NULL` (membership activa, no salida). La identidad universal viene de `app_user` (display_name, handle, avatar_url); la identidad contextual del place viene de `membership` (joined_at, headline, leftAt — null si activa) + derivación de rol vía `place_ownership` (owner si hay fila para ese place_id, miembro si sólo hay membership). Sin columna `role` en `membership` (canónico ADR-0002 §1 refinado por ADR-0035 §1).

**Invitation (capability token).** Una fila en `invitation` con `(place_id, email, invited_by, expires_at, token, accepted_at)`. ADR-0010 §2 canoniza: capability-based, no email lookup (el `email` es para mostrar en UI del owner, NO para gating; el `token` es la capability que da acceso a aceptar). Estados derivados: `pending` (`accepted_at IS NULL AND expires_at > now()`), `accepted` (`accepted_at IS NOT NULL`), `expired` (`accepted_at IS NULL AND expires_at <= now()`). V1 NO modela cancellation como columna — la cancelación es DELETE físico de la fila (la capability deja de existir).

**Co-owner (subset estructural de members).** Cualquier owner del place — founder o co-owner — tiene fila en `place_ownership` para ese `place_id`. ADR-0035 §1 canoniza N owners simultáneos por place; ADR-0035 §2 canoniza founder slot único + no-delete por otro owner + transferencia 1:1. Feature E no agrega invariantes nuevos sobre co-owners; consume las 4 funciones DEFINER de Feature D (ya cerradas) vía wrappers TS + UI nueva.

## Casos de uso V1

V1 expone **7 casos de uso** distribuidos en 3 capas (DEFINER nueva, wrapper TS sobre DEFINER de Feature D, action simple sobre tabla). Cada CU lista capa, precondición, postcondición y errores estructurales que el componente RAISEs/devuelve.

### CU1 — Editar headline propio

Server Action `updateMyHeadlineAction(p_place_id text, p_new_headline text | null)`. UPDATE directo sobre `membership` (no requiere DEFINER — no es invariante cross-owner).

- **Precondición**: caller autenticado; existe fila `membership (user_id = caller.user_id, place_id = p_place_id, left_at IS NULL)`; nuevo headline ≤280 chars (zod) + CHECK constraint (DB defense-in-depth).
- **Postcondición**: `membership.headline = p_new_headline` (puede ser NULL para limpiar el slot).
- **Errores estructurales**: `HeadlineError.unauthorized` (caller sin sesión); `HeadlineError.not_member` (no existe membership activa); `HeadlineError.too_long` (zod o CHECK).
- **Notes**: ADR-0036 §3 — sólo el propio miembro edita; el owner NO edita el headline de otros. La RLS owner-only del `membership` no se viola porque el WHERE acota `user_id = caller`.

### CU2 — Crear invitación (V1 owner-only)

Función `app.create_invitation(p_place_id text, p_email text, p_expires_at timestamptz) RETURNS json` (SECURITY DEFINER). Retorna `{ invitation_id, token }` para que el caller arme el link.

- **Precondición**: caller autenticado; caller es owner del place (`app.current_user_owns_place(p_place_id) = true` — gate V1 hardcoded, ADR-0037 §4); `p_expires_at > now()`; email tiene formato válido (validado app-side por zod ANTES de llamar; la función NO re-valida formato — defense-in-depth se delega a zod).
- **Postcondición**: nueva fila `invitation (place_id, email, invited_by = caller.user_id, expires_at, token = random base64url 32 bytes, accepted_at = NULL)`. Token único global (`invitation.token UNIQUE`). El caller arma el link `https://<custom_domain_o_apex>/invite/<token>`.
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 caller is not an owner of this place` (V1); `P0001 expires_at must be in the future`; `23505 duplicate token` (improbable — random 32 bytes; si ocurre, retry desde el caller).
- **V2+**: gate se abre a miembro-no-owner si `membership.invitations_used < place.member_invite_quota` (ADR-0037 §4 — defer). V1 mantiene hardcoded owner-only.

### CU3 — Revocar invitación pending

Función `app.revoke_invitation(p_invitation_id text) RETURNS void` (SECURITY DEFINER). DELETE físico de la fila (la capability deja de existir; el token queda inválido inmediatamente).

- **Precondición**: caller autenticado; caller es owner del place al que pertenece la invitación; invitación no ha sido aceptada (`accepted_at IS NULL`).
- **Postcondición**: DELETE de la fila `invitation`. Cualquier intento futuro de aceptar el token retornará `not_found`.
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 invitation not found`; `P0001 caller is not an owner of this place`; `P0001 cannot revoke already-accepted invitation` (acceptedAt IS NOT NULL — la membership ya existe; usar `remove_member` en su lugar).

### CU4 — Remover miembro

Función `app.remove_member(p_target_user_id text, p_place_id text) RETURNS void` (SECURITY DEFINER). UPDATE `membership SET left_at = now()` (soft delete via lifecycle column, NO DELETE físico — preserva FKs de contenido del miembro).

- **Precondición**: caller autenticado; caller es owner del place; target tiene `membership` activa (`left_at IS NULL`); target NO es owner del place (los owners se remueven vía `app.revoke_ownership` de Feature D, que adicionalmente NO toca membership — patrón canónico ADR-0035 §"Remoción de owner ≠ expulsión del place"); target NO es el caller (auto-remove bloqueado V1 — para "salirse del place" será un endpoint futuro `app.leave_place`, gap consciente).
- **Postcondición**: `membership.left_at = now()`. El contenido del ex-miembro queda en el place atribuido a su nombre (canónico ontologia §"Cuatro — Derecho al olvido estructurado"). Su presencia y rastro personal se borran del place inmediatamente vía mecanismos posteriores (no parte de V1).
- **Errores estructurales**: `28000` si caller sin sesión; `P0001 caller is not an owner of this place`; `P0001 target is not an active member`; `P0001 target is an owner; revoke ownership first` (refuerzo de separación de concerns con `app.revoke_ownership`); `P0001 cannot self-remove; use leave_place (V1.1+)`.

### CU5 — Elevar miembro a co-owner (wrapper sobre Feature D)

Server Action `elevateToOwnerAction(p_target_user_id text, p_place_id text)`. Wrapper TS sobre `app.elevate_to_owner` (Feature D S2, migration 0014 — ADR-0035 §Decisión 2). V1 introduce el wrapper + UI consumer; la función DEFINER ya existe.

- **Precondición / postcondición / errores**: idénticos a `app.elevate_to_owner` (Feature D `spec.md` §CU2). El wrapper TS maps `P0001` MESSAGE → `ElevateError` discriminated union.
- **Notes**: el wrapper es ~30 LOC (parse zod input + invoke DEFINER + try/catch + map error). Sin lógica nueva.

### CU6 — Revocar co-owner (wrapper sobre Feature D)

Server Action `revokeOwnershipAction(p_target_user_id text, p_place_id text)`. Wrapper TS sobre `app.revoke_ownership` (Feature D S3, migration 0015 — ADR-0035 §Decisión 2).

- **Precondición / postcondición / errores**: idénticos a Feature D `spec.md` §CU3. Wrapper maps a `RevokeError` discriminated union (founder/self/not-owner/last-owner cases).

### CU7 — Transferir founder (wrapper sobre Feature D)

Server Action `transferFounderOwnershipAction(p_target_user_id text, p_place_id text)`. Wrapper TS sobre `app.transfer_founder_ownership` (Feature D S4, migration 0016).

- **Precondición / postcondición / errores**: idénticos a Feature D `spec.md` §CU4. Wrapper maps a `TransferError` discriminated union.

Los 4 wrappers TS (elevate / revoke / transfer + el wrapper de remove_member que no es de Feature D pero comparte patrón) viven en `src/features/members/actions/`. Cada uno ≤60 LOC.

## Schema delta

**Migration 0017 (S1 de Feature E) — single migration que agrega 2 columnas a 2 tablas:**

```sql
ALTER TABLE membership
  ADD COLUMN headline text NULL;

ALTER TABLE membership
  ADD CONSTRAINT membership_headline_length_chk
  CHECK (headline IS NULL OR length(headline) <= 280);

ALTER TABLE place
  ADD COLUMN member_invite_quota int NOT NULL DEFAULT 0;

ALTER TABLE place
  ADD CONSTRAINT place_member_invite_quota_nonneg_chk
  CHECK (member_invite_quota >= 0);
```

Idempotente sobre filas existentes:
- `membership.headline` se agrega NULL — todas las filas pre-existentes quedan NULL (sin valor a back-fillear).
- `place.member_invite_quota` se agrega NOT NULL DEFAULT 0 — todas las filas pre-existentes reciben 0 por DEFAULT (mismo comportamiento histórico, ADR-0010 §2).

Sin nuevas tablas. Sin refactor de RLS sobre `membership`/`place` (las policies owner-only existentes cubren ambas columnas — el owner ve/admin todo lo de su place, el `updateMyHeadlineAction` acota WHERE app-side a `user_id = caller`).

## Funciones DEFINER nuevas

V1 agrega **3 funciones SECURITY DEFINER** que canalizan toda mutación crítica (invitation lifecycle + member removal). Mismo patrón canónico que las 4 de Feature D: `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp` (anti-hijack), `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO "app_system"`. Cuerpo valida invariantes y emite `RAISE EXCEPTION` con `ERRCODE = 'P0001'` + `MESSAGE` discriminable. Sin `WITH CHECK` policies adicionales — la denial direct INSERT/UPDATE/DELETE sobre `membership` ya está cubierta por defense-in-depth del schema base (REVOKE de `app_system` documentado en ADR-0012 §1).

```sql
-- S2 (migration 0018) — Capability-based invitation creation.
CREATE OR REPLACE FUNCTION app.create_invitation(
  p_place_id text, p_email text, p_expires_at timestamptz
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller authenticated; caller owns place;
-- expires_at > now(). V1: gate hardcoded owner-only (ADR-0037 §4); V2+ opens
-- gate to member-with-quota-available.

-- S3 (migration 0019) — Revoke pending invitation.
CREATE OR REPLACE FUNCTION app.revoke_invitation(p_invitation_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller authenticated; invitation exists;
-- caller owns the invitation's place; invitation not yet accepted.

-- S4 (migration 0020) — Soft-remove member (UPDATE membership.left_at).
CREATE OR REPLACE FUNCTION app.remove_member(p_target_user_id text, p_place_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
-- pre-conditions in body: caller authenticated; caller owns place; target has
-- active membership; target is NOT owner (separation of concerns w/ revoke_ownership);
-- target != caller (no self-remove V1 — use leave_place V1.1+).
```

**Códigos de error canónicos emitidos** (cruzados con tests S2-S4):

| Code | Trigger | Función |
|---|---|---|
| `28000` (`invalid_authorization_specification`) | `app.current_user_id() IS NULL` | las 3 |
| `P0001` (`raise_exception`) | invariante violado por el caller | las 3 |
| `23505` (`unique_violation`) | colisión `invitation.token` (extremadamente improbable random 32 bytes) | `create_invitation` |

El wrapper TS de cada Server Action discrimina por el `MESSAGE` del `P0001` (string match) y maps a la `discriminated union` correspondiente (`InviteError`/`RevokeInviteError`/`RemoveMemberError`).

## Shared UI extraídos (S5)

Tres componentes inline en código existente se extraen a `src/shared/ui/` para reuso explícito en Feature E + futuras features. Tarea de S5 ejecutada por **3 agentes paralelos** (archivos ortogonales — ninguno toca el mismo archivo):

- **`shared/ui/confirm-dialog.tsx`** — extraído del inline en `src/features/custom-domain/ui/domain-section-archive.tsx:109-165` (ConfirmDialog modal de "¿confirmás archivar dominio?"). Props: `{ open, onClose, onConfirm, title, description, confirmLabel, destructive: boolean }`. Reusado en Feature E para confirm de revoke-invitation, remove-member, revoke-ownership, transfer-founder.
- **`shared/ui/context-menu.tsx`** — extraído del inline en `src/shared/ui/app-shell/app-shell-account-menu.tsx:80-115` (ContextMenu con items). Props: `{ trigger: ReactNode, items: { label, icon, destructive?, onClick }[] }`. Reusado en Feature E para el menú de acciones por fila de miembro (ContextMenu de "hacer co-owner / revocar / remover / transferir founder").
- **`shared/ui/badge.tsx`** — nuevo componente (no extraído — no hay inline existente que justifique). Props: `{ variant: 'owner' | 'founder' | 'pending' | 'expired', children }`. Reusado en Feature E para tags "Owner" / "Founder" / "Pending" / "Expired" en la lista de miembros y de invitaciones.

Cada componente tiene su test RTL adyacente (`*.test.tsx`). LOC budget por componente: ≤120 LOC (cap shared/ui ≤800 total respetado).

Patrón AppShell (ADR-0023 + 0025) se reusa intacto — el page `/settings/members` consume `<AppShell>` con `sidebarGroups` ya cableados (item "members" existe disabled en `src/features/nav-place/ui/nav-place-items.tsx:120`, se habilita en S11).

## Server Actions (S7 + S8)

Distribuidas en 2 sesiones (S7 invitations + S8 member management) para mantener cada sesión ≤5 archivos tocados (regla CLAUDE.md §"Un prompt = una responsabilidad").

**S7 — invitations** (3 actions + 1 query):
- `createInvitationAction(formData)` — zod `{ email: z.string().email(), expiresInDays: z.number().int().min(1).max(90) }`; computa `expires_at = now() + days`; invoca `app.create_invitation`; retorna `{ ok, invitationId, link }` (link = base URL + `/invite/<token>`); revalida path `/settings/members`.
- `revokeInvitationAction(formData)` — zod `{ invitationId }`; invoca `app.revoke_invitation`; revalida path.
- `loadPendingInvitations(placeId)` — query (no action) — SELECT activas (`accepted_at IS NULL AND expires_at > now()`) con metadata para UI.
- `updateMyHeadlineAction(formData)` — zod `{ placeId, headline: z.string().max(280).nullable() }`; UPDATE `membership SET headline WHERE user_id = caller AND place_id`; revalida path.

**S8 — member management + ownership wrappers** (3 actions wrappers + 1 action + 1 query):
- `removeMemberAction(formData)` — zod `{ targetUserId, placeId }`; invoca `app.remove_member`; revalida path.
- `elevateToOwnerAction(formData)` — wrapper sobre `app.elevate_to_owner` (Feature D); zod `{ targetUserId, placeId }`; maps errors.
- `revokeOwnershipAction(formData)` — wrapper sobre `app.revoke_ownership`; zod `{ targetUserId, placeId }`; maps errors.
- `transferFounderOwnershipAction(formData)` — wrapper sobre `app.transfer_founder_ownership`; zod `{ targetUserId, placeId }`; maps errors.
- `loadMembers(placeId)` — query (no action) — SELECT memberships activas con metadata (display_name, handle, avatar_url, headline, joined_at, is_owner, is_founder) — JOIN `app_user` + LEFT JOIN `place_ownership` + comparación con `place.founder_user_id`.

Todas las Server Actions usan el patrón canónico ADR-0034: `getAuthenticatedDbForRequest(fn)` — el helper zone-aware que decide entre cookie apex y signed-ticket de custom domain transparentemente. NO instanciar `getAuthenticatedDb` ni `getAuthenticatedDbWithVerifier` directo (gotcha `docs/gotchas/zone-aware-db-cookie-source.md`).

## UI screens (S9 + S10 + S11)

**S9 — Invite modal + pending tab** (~6 archivos):
- `<InviteMemberModal />` — abre desde el botón "Invitar miembro" en la page; form email + expiresInDays; submit invoca `createInvitationAction`; UI post-success muestra el link copiable (`navigator.clipboard.writeText`) con CTA "Copiar link" + toast confirmación; UI explica explícitamente que el link es capability-based ("cualquiera con este link puede unirse — compartilo solo con la persona invitada").
- `<PendingInvitationsTab />` — lista de invitaciones pending (consume `loadPendingInvitations`); cada fila muestra email + caducidad relativa + botón "Revocar" (abre `<ConfirmDialog />` shared/ui); revoke invoca `revokeInvitationAction`.

**S10 — Members list + actions menu** (~5 archivos):
- `<MembersList />` — tabla/lista de memberships activas (consume `loadMembers`); cada fila muestra avatar + display_name + handle + headline (si NOT NULL — render condicional ADR-0036 §1) + badges (`<Badge variant="owner|founder|...">` shared/ui).
- `<MemberRowActionsMenu />` — context menu por fila (consume `<ContextMenu />` shared/ui). Items condicionales según rol del row vs rol del caller:
  - Si caller es founder, row no-owner: "Hacer co-owner" → `elevateToOwnerAction`.
  - Si caller es owner, row no-owner: "Remover miembro" → confirm + `removeMemberAction`.
  - Si caller es owner (no founder), row es co-owner (no founder): "Revocar co-owner" → confirm + `revokeOwnershipAction`.
  - Si caller es founder, row es co-owner: "Revocar co-owner" + "Transferir founder" → confirm + action correspondiente.
  - Si caller es founder, row es founder mismo: sin acciones destructivas (founder no-delete por sí mismo — V1 sin auto-revoke, gap consciente).
- `<HeadlineEditor />` — inline editor en perfil contextual (no en /settings/members — V1 puede shipear el editor en el modal de "ver mi perfil" que aparece tappeando el propio handle/avatar — UX simple); consume `updateMyHeadlineAction`.

**S11 — Page + sidebar wiring + i18n ×6** (~8 archivos):
- `src/app/[placeSlug]/(place)/settings/members/page.tsx` — RSC que carga `loadMembers` + `loadPendingInvitations` server-side; renderiza `<AppShell>` con header "Miembros" + tabs "Activos / Pendientes" + `<MembersList />` + `<PendingInvitationsTab />` + `<InviteMemberModal />` trigger.
- `src/features/nav-place/ui/nav-place-items.tsx` — flip `disabled: true → false` para el item "members" (línea 120).
- `i18n/messages/{es,en,fr,pt,de,ca}.json` — agrega bloque `placeMembers.*` con keys: `pageTitle`, `tabActive`, `tabPending`, `inviteButton`, `inviteModal.title/email/expires/copyLink/successCopied`, `pendingRow.expiresIn/revokeButton`, `actionsMenu.elevate/revoke/remove/transferFounder`, `confirmRemove.title/description/confirmLabel`, `headline.placeholder/saveButton/empty/error.tooLong`, `badge.owner/founder/pending/expired`. Estimado ~40 keys × 6 locales = 240 entradas. Verificado por `scripts/check-translations.mjs` (parity check informativo, ADR-0024).

## Gaps conscientes V1

V1 acota deliberadamente para shipear el slice consumer sólido sobre la primitive ya estable de Feature D. Cada gap difiere a V1.1+/V2+ con razón explícita:

- **UI editor de `place.member_invite_quota`.** V1 = schema-only por ADR-0037 §4. V2+ agrega el slider/input en `/settings/members`. Sin UI, la columna existe pero queda dormida runtime (comportamiento idéntico al pre-ADR-0037: gate hardcoded owner-only).
- **Counter `membership.invitations_used` + gate por cupo en `app.create_invitation`.** V2+ junto con el UI editor del quota. ADR-0037 §4-§5 documenta el plan upfront.
- **Cancelación libera cupo (mecánica concreta).** V2+ — `app.revoke_invitation` decrementa el counter. ADR-0037 §5 documenta la decisión conceptual upfront. V1 NO necesita la mecánica porque no hay counter.
- **Per-member override del cupo.** V2+ — ADR-0037 §6 documenta el diferimiento.
- **Bloqueo temporal de miembro** (un owner suspende a un miembro por X horas sin removerlo). V1 NO lo modela. V2+ con tabla `membership_block (membership_id, blocked_until, reason)` si UX lo pide.
- **Auto-revoke** (un co-owner se quita a sí mismo de ownership sin transferir). V1 mantiene el bloqueo explícito de Feature D (ADR-0035 §Alternativas rechazadas). V1.1+ podría agregar `app.step_down_as_owner` si caso aparece.
- **`app.leave_place`** (un miembro se sale del place por su cuenta). V1 sólo tiene `app.remove_member` (owner remueve a otro). V1.1+ agrega self-removal para miembros no-owner con UPDATE `membership.left_at = now()`. Para owners, el path es `transfer_founder_ownership` (si founder) o `revoke_ownership` (si co-owner, coordinado con otro owner).
- **Notificaciones** (ex-miembro removido / ex-owner revocado / invitación enviada por email). V1 NO notifica vía email (el owner copia el link y lo manda manualmente — ADR-0010 §2 capability-based, no email lookup); V1 NO notifica al ex-miembro removido (el cliente lo descubre al volver y ver que perdió acceso). V1.1+ con canal de notifs.
- **Búsqueda/filtrado/ordenamiento de la lista de miembros.** V1 muestra la lista cruda ordenada por `joined_at DESC`. V1.1+ agrega search box + filter "sólo owners" + sort "más recientes / más antiguos / alfabético".
- **Pagination.** V1 carga todos los miembros en una sola query (cap del modelo: 150 miembros por place, invariante de `data-model.md`). 150 filas no requiere pagination. Si V2+ levanta el cap (no hay plan), agregar pagination entonces.
- **Auditoría/historial de cambios de membership.** V1 no logea (eventos de elevación/revocación/remoción no quedan en tabla — sólo el estado actual). V1.1+ con `membership_event_log` si compliance lo pide.
- **Self-edit de perfil universal** (display_name/avatar_url desde /settings/members). V1 NO incluye — eso vive en el account-menu cross-place, no en place-settings. Out of scope explícito.

Cada gap explícito acá para que sesiones post-V1 sepan qué encontrar y qué NO encontrar.

## Decisión operativa

**`updateMyHeadlineAction` no requiere `SECURITY DEFINER`.** El UPDATE acotado a `WHERE user_id = caller AND place_id = p_place_id` ya respeta la RLS owner-only de `membership` por construcción (cuando el caller es owner del place, la policy `membership_upd` lo deja pasar; cuando es miembro no-owner editando su PROPIO headline, la policy `membership_upd` lo DENIEGA pero el caller no debería poder editar sin ser owner...). **Revisión crítica del approach**: la policy actual `membership_upd` con `ownerOnly(t.placeId)` BLOQUEA al miembro no-owner editando su propio headline. Hay 2 paths posibles:

1. **Path A (V1 elegido)**: agregar policy member-self `membership_upd_self` con `USING (user_id = (SELECT app_user.id FROM app_user WHERE auth_user_id = app.current_user_id())) AND user_id = (...)`+ `WITH CHECK` mismo + scope a la columna `headline` solamente (Postgres no soporta column-level RLS — el approach correcto es policy a nivel de fila con `USING user_id = caller` Y validación app-side de que `update set` sólo toca `headline`).
2. **Path B**: `SECURITY DEFINER` function `app.update_my_headline(p_place_id, p_new_headline)` que bypassea RLS para el caso self-edit.

**Decisión V1: Path B (DEFINER) — simétrico con el resto de Feature E + más seguro.** Razón: column-level enforcement vía policy + scope app-side es frágil (un drift app-side podría UPDATE-ear otras columnas sin que la RLS lo note). DEFINER `app.update_my_headline(p_place_id, p_new_headline)` con cuerpo `UPDATE membership SET headline = p_new_headline WHERE user_id = caller AND place_id = p_place_id` aísla la column exposure. **Re-clasifica CU1 como DEFINER** — actualizar §"Funciones DEFINER nuevas" con la 4ta función `app.update_my_headline` (no afecta plan de sesiones — S2/S3/S4 mantiene sus 3 funciones para no-headline; S1 incluye además `app.update_my_headline` para acompañar la migration de la columna, o se mueve a S2 si scope de S1 ya es denso — decidir en S1 según LOC budget).

**Reverso de la decisión queda registrado: si LOC de S1 excede, mover `app.update_my_headline` a S2 (`app.create_invitation`) sin re-arquitectura.**

**Place archived: invitations + member-remove son operables.** Misma decisión que Feature D §"Decisión operativa": las 3 funciones DEFINER de Feature E NO discriminan por `place.subscription_status`. Razón: mantenimiento de places archivados (un owner puede querer remover miembros o limpiar invitations expiradas antes de purga física). Sin gating por status — la única discriminación es la del invariante per-función (caller is owner, target is active member, etc.). Tests S2-S4 cubren explícitamente el caso `place archived → operación permitida`.

## Smoke verification

Tras S12 (cierre operativo del slice), la verificación manual end-to-end contra Neon test branch + browser real:

1. **Setup**: 3 `app_user` (alice, bob, carol) + 1 place creado por alice via `app.create_place` (CU1 de Feature D — alice = founder + owner único).
2. **CU2 Invitar**: como alice, abrir `/settings/members` → click "Invitar" → form email `bob@test.com` + 7d → submit → modal muestra link → click "Copiar link". Verificar: nueva fila `invitation`, tab "Pendientes" muestra entry, link tiene formato `https://<host>/invite/<token>`.
3. **Aceptar invite**: en incognito, abrir el link copiado → flow de signup/login (existente de Feature C) → al cerrar el flow, bob aparece como miembro activo en la lista de alice (`/settings/members` reload).
4. **CU1 Editar headline propio**: como bob (en incognito), navegar a su perfil contextual (tap su avatar) → editor inline headline → ingresar "Recién en el barrio" → save. Verificar fila `membership.headline = 'Recién en el barrio'` (NULL antes); render condicional: bloque aparece donde antes no aparecía.
5. **CU5 Elevar a co-owner**: como alice, en `/settings/members` row bob → context menu "Hacer co-owner" → click. Verificar: bob ahora tiene fila `place_ownership` + badge "Owner" en la lista.
6. **CU3 Revocar invitación pending**: como alice, crear segunda invitación `carol@test.com` → no aceptarla → tab "Pendientes" → click "Revocar" → confirm dialog → OK. Verificar: fila `invitation` eliminada, tab vacío.
7. **CU4 Remover miembro**: como alice, crear tercera invitación `eve@test.com` + aceptarla en incognito como eve → eve aparece como miembro activo → row eve → context menu "Remover miembro" → confirm. Verificar: `membership.left_at NOT NULL`, eve desaparece de la lista activa.
8. **CU6 Revocar co-owner**: como alice (founder), row bob (co-owner) → context menu "Revocar co-owner" → confirm. Verificar: `place_ownership` row de bob eliminada; `membership` de bob intacta; badge "Owner" desaparece de la lista.
9. **CU7 Transferir founder**: re-elevar a bob → row bob → "Transferir founder" → confirm. Verificar: `place.founder_user_id = bob.user_id`, alice ya no es owner (badge desaparece) pero sigue miembro activo.
10. **Regression CU4 (target = owner)**: como bob (nuevo founder), intentar `remove_member(alice)` → error `P0001 target is an owner; revoke ownership first`. Confirma separation of concerns.
11. **i18n smoke**: cambiar `place.default_locale` a `en` → reload `/settings/members` → verificar todos los labels traducidos (no aparece nada en español).

Resultados se logean en S12 (mismo patrón que el smoke `dpl_*` de Feature C y el smoke de Feature D S6); si algún assert falla, S12 no cierra y se abre debugging session.

## Pointers

- **ADRs canónicas V1 de Feature E**:
  - [`../../decisions/0036-member-bio-contextual.md`](../../decisions/0036-member-bio-contextual.md) — `membership.headline` per place.
  - [`../../decisions/0037-member-invite-quota.md`](../../decisions/0037-member-invite-quota.md) — `place.member_invite_quota` V1 schema-only.
- **Primitive de gobierno consumida (Feature D, cerrada)**: [`../place-ownership/spec.md`](../place-ownership/spec.md) + [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md) — 4 funciones DEFINER + helper canónico `app.current_user_owns_place`.
- **Patrón WORM-via-DEFINER**: ADR-0012 §3 (`app.create_place`), ADR-0032 §6 (`app.consume_sso_jti`), ADR-0035 §4 (las 4 de Feature D), esta spec §"Funciones DEFINER nuevas" (las 3 de Feature E).
- **Patrón zone-aware Server Actions**: ADR-0034 (`getAuthenticatedDbForRequest`) — todas las actions de Feature E lo usan.
- **Patrón capability-based invitation**: ADR-0010 §2 (token-link, no email lookup, owner crea).
- **Patrón AppShell + sidebar**: ADR-0023 (shell agnóstico) + ADR-0025 (sidebar agrupado + iconoir).
- **Patrón i18n DB-based**: ADR-0022 (`place.default_locale`) + ADR-0024 (fallback runtime deep-merge + `check-translations` informativo).
- **Patrón member-read RLS (forward-compat para V1.1+)**: ADR-0021.
- **Schema base + invariantes del dominio (post-S0)**: [`../../data-model.md`](../../data-model.md) (secciones `place` + `membership` actualizadas con `member_invite_quota` + `headline` + invariantes nuevos).
- **Ontología canónica refinada (post-S0)**: [`../../ontologia/miembros.md`](../../ontologia/miembros.md) — bio flip + multi-owner mention + headline en capa 2.
- **Plan de sesiones operativo**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Test checklist por sesión**: [`./tests.md`](./tests.md).
