# Members slice V1 — Tests checklist

> _Checklist TDD por sesión. Cada test describe una expectativa observable; el orden refleja el plan de sesiones ([`./plan-sesiones.md`](./plan-sesiones.md)). Convención: `[ ]` pending, `[x]` ejecutado verde._
>
> **Mandato TDD (CLAUDE.md §"Durante la implementación")**: tests primero, verificar que fallan, implementar, verificar que pasan. Sin excepciones en el core. Cada sesión arranca con tests RED, implementa, verifica GREEN. Las 4 funciones DEFINER nuevas (S1+S2+S3+S4) son código de seguridad — RED→GREEN obligatorio antes de tag.
>
> **Total proyectado nuevo**: ~118 tests vitest distribuidos S1-S11 + verificaciones manuales psql en S1-S4 + smoke E2E manual en S12. Suite objetivo post-S12: baseline post-Feature-D 761 + ~118 nuevos.

## Canon "Tests SQL directo vía harness `inRlsTx`"

Heredado del precedente Feature D (`docs/features/place-ownership/tests.md`) + Feature C (`docs/features/custom-domain-sso/tests.md`). Las 4 funciones DEFINER nuevas de Feature E (S1 `update_my_headline`, S2 `create_invitation`, S3 `revoke_invitation`, S4 `remove_member`) se testean con SQL directo contra Neon test branch vía harness `inRlsTx` de `src/db/__tests__/db-test-pool.ts` (seed-as-`neondb_owner`, assert-as-`app_system` con claim del user-bajo-test, ROLLBACK siempre). Los tests inyectan `request.jwt.claims` para simular distintos callers en la misma transacción.

Las queries de S6 + Server Actions de S7-S8 se testean con el mismo harness (queries directo; actions con mock del wrap zod/revalidatePath alrededor de la DB call). Los componentes UI de S5/S9/S10 se testean con React Testing Library (RTL) — mock de actions vía vi.mock, render isolated.

---

## S1 — Migration 0017: schema + `app.update_my_headline` DEFINER

### `src/db/__tests__/schema-headline-quota.test.ts` (nuevo)

**Por qué importa:** las 2 columnas nuevas son la base del schema delta de Feature E. Si los CHECK constraints o defaults fallan, S2-S11 operan sobre superficie quebrada (ej. `create_invitation` permitiría email en columnas que no aceptan, o places nuevos arrancarían con cupo no-cero).

**Harness:** `inRlsTx` con seed-as-`neondb_owner` (1 place + 2 users + 2 memberships).

**LOC budget estimado:** ~180.

**Casos cubiertos (12 total):**

- [ ] `membership.headline` column exists con tipo `text` y `NULL` aceptado.
- [ ] `membership.headline` CHECK constraint rechaza string de 281 chars (`P0001`/`23514` check_violation).
- [ ] `membership.headline` CHECK acepta exactly 280 chars (boundary).
- [ ] `membership.headline` CHECK acepta NULL.
- [ ] `membership.headline` CHECK acepta empty string `''` (length 0).
- [ ] `membership.headline` UPDATE 280→500 chars falla `23514`.
- [ ] `place.member_invite_quota` column exists con tipo `int` y `NOT NULL`.
- [ ] `place.member_invite_quota` DEFAULT 0 — INSERT INTO place sin la columna aplica 0.
- [ ] `place.member_invite_quota` CHECK rechaza -1 (`23514`).
- [ ] `place.member_invite_quota` CHECK acepta 0 (boundary).
- [ ] `place.member_invite_quota` CHECK acepta valores grandes (1000, 1000000).
- [ ] `place.member_invite_quota` UPDATE 0→5 succeeds (placeholder de editabilidad V2+).

### `src/db/__tests__/update-my-headline.test.ts` (nuevo)

**Por qué importa:** primer mutador DEFINER del flow personal del miembro. Bug = miembro edita headline de otros, owner re-edita headline de miembros, drift en `WHERE` clause que UPDATE-ea filas equivocadas.

**Harness:** `inRlsTx` con seed (1 place creado por alice + bob/carol como miembros activos).

**LOC budget estimado:** ~200.

**Casos cubiertos (8 total):**

- [ ] Happy: caller = bob, `app.update_my_headline(place_id, 'Recién en el barrio')` → `membership(bob, place).headline = 'Recién en el barrio'`.
- [ ] Set NULL: caller = bob, `app.update_my_headline(place_id, NULL)` post-set → headline vuelve a NULL.
- [ ] Caller sin sesión: claim vacío → `28000 invalid_authorization_specification`.
- [ ] Caller no-miembro: caller = dave (sin membership en place) → `P0001 caller is not an active member of this place`.
- [ ] Caller con membership con `left_at NOT NULL`: caller = eve (ex-miembro) → `P0001 caller is not an active member`.
- [ ] Owner edita su propio headline (alice = founder) → OK (owner ES también miembro activo).
- [ ] Owner intenta editar headline de otro → la función NO permite (no acepta `p_target_user_id` — el UPDATE en cuerpo siempre acota `WHERE user_id = caller`). Documenta que NO hay path desde la DEFINER para que owner edite headline de otro.
- [ ] Headline > 280 chars: zod app-side rechaza antes; defense-in-depth DB-side: `app.update_my_headline(place_id, 'X'.repeat(281))` → `23514 check_violation` (la DEFINER no re-valida length; delega a CHECK).

**Verificación manual psql (S1 closeout):**

- [ ] `psql -c "\d+ membership"` muestra columna `headline text` + CHECK constraint.
- [ ] `psql -c "\d+ place"` muestra columna `member_invite_quota integer not null default 0` + CHECK.
- [ ] `psql -c "\df app.update_my_headline"` muestra `Security` = `definer`.
- [ ] Header migration 0017 documenta reverse-SQL inline.

**Total S1: 20 vitest + 4 verificaciones manuales psql.**

---

## S2 — `app.create_invitation` (migration 0018)

### `src/db/__tests__/create-invitation.test.ts` (nuevo)

**Por qué importa:** primer mutador DEFINER del flow invitations. Bug = miembro-no-owner pasa V1 (privilege escalation antes de V2+ quota gate), token colisiona, expires_at acepta pasado.

**Harness:** `inRlsTx` con seed (1 place creado por alice + bob co-owner + carol miembro no-owner + dave fuera del place).

**LOC budget estimado:** ~230.

**Casos cubiertos (10 total):**

- [ ] Happy: caller = alice (founder + owner), `app.create_invitation(place, 'eve@test.com', now()+'7 days')` → retorna `{invitation_id, token}`; nueva fila `invitation` con `invited_by = alice.user_id`, `accepted_at IS NULL`, `token` matches retorno.
- [ ] Caller sin sesión: claim vacío → `28000`.
- [ ] Caller no-owner V1: caller = carol (miembro pero no owner) → `P0001 caller is not an owner of this place` (V1 gate hardcoded — ADR-0037 §4).
- [ ] Caller fuera del place: caller = dave → mismo `P0001 caller is not an owner of this place`.
- [ ] `p_expires_at` en pasado: `now() - '1 day'` → `P0001 expires_at must be in the future`.
- [ ] `p_expires_at` boundary `now()`: `now()` exact → `P0001 expires_at must be in the future` (strict >, no >=).
- [ ] Multi-owner co-owner OK: caller = bob (co-owner) → succeeds (cualquier owner invita, no sólo founder).
- [ ] Token uniqueness: simular 2 invocaciones consecutivas con mock determinístico de `random` (si harness lo permite) → ambos tokens distintos. Si harness no permite mock, assert que en 100 invocaciones reales no hay colisión (probabilístico — random 32 bytes).
- [ ] Email passthrough sin re-validación: caller = alice, `p_email = 'not-an-email'` → la función NO re-valida formato (delega a zod app-side); la fila se inserta con `email = 'not-an-email'`. Documenta el contract.
- [ ] Place not found: caller = alice, `p_place_id = 'nonexistent'` → `P0001 caller is not an owner of this place` (helper retorna false para place inexistente; el caller "no es owner" trivialmente).

**Total S2: 10 vitest.**

---

## S3 — `app.revoke_invitation` (migration 0019)

### `src/db/__tests__/revoke-invitation.test.ts` (nuevo)

**Por qué importa:** la cancelación debe ser owner-only y debe bloquear sobre invitations ya aceptadas (membership ya existe; usar remove_member).

**Harness:** `inRlsTx` con seed (1 place + alice founder + bob co-owner + 3 invitations: pending normal, accepted, expired pending).

**LOC budget estimado:** ~180.

**Casos cubiertos (8 total):**

- [ ] Happy: caller = alice, `app.revoke_invitation(pending_invitation_id)` → DELETE row; SELECT WHERE id = ... retorna 0 rows.
- [ ] Caller sin sesión → `28000`.
- [ ] Invitation not found: `app.revoke_invitation('nonexistent')` → `P0001 invitation not found`.
- [ ] Caller no-owner del place: caller = carol (miembro no-owner del place) → `P0001 caller is not an owner of this place`.
- [ ] Already accepted: invitation con `accepted_at IS NOT NULL` → `P0001 cannot revoke already-accepted invitation`.
- [ ] Multi-owner co-owner OK: caller = bob → succeeds.
- [ ] Cross-place denied: caller = alice (owner de place-1), invitation de place-2 (donde alice no es owner) → `P0001 caller is not an owner of this place`.
- [ ] Expired pending revoke OK: invitation con `expires_at < now()` AND `accepted_at IS NULL` (caso edge — expired pero aún cancellable para limpieza) → DELETE succeeds (la lógica permite revoke de expired; cleanup explícito).

**Total S3: 8 vitest.**

---

## S4 — `app.remove_member` (migration 0020)

### `src/db/__tests__/remove-member.test.ts` (nuevo)

**Por qué importa:** la separación de concerns con `app.revoke_ownership` (Feature D) es crítica. Bug = owner-as-member removed via remove_member (deja `place_ownership` orfana → drift de invariante "owner = miembro"), founder removed (corrompe schema), self-remove pasa V1 (incompleto — `leave_place` es V1.1+).

**Harness:** `inRlsTx` con seed (1 place + alice founder + bob co-owner + carol miembro no-owner + dave ex-miembro con left_at + 1 place-2 separado para cross-place tests).

**LOC budget estimado:** ~220.

**Casos cubiertos (10 total):**

- [ ] Happy: caller = alice, target = carol (miembro no-owner activo) → `membership(carol, place).left_at = now()` (UPDATE, no DELETE — soft-remove).
- [ ] Caller sin sesión → `28000`.
- [ ] Caller no-owner: caller = carol misma (no es owner), target = bob → `P0001 caller is not an owner of this place`.
- [ ] Target es owner (co-owner): caller = alice, target = bob → `P0001 target is an owner; revoke ownership first` (separation of concerns).
- [ ] Target es founder: caller = bob (co-owner), target = alice (founder) → `P0001 target is an owner; revoke ownership first` (founder es owner — mismo error path).
- [ ] Target = caller (self-remove): caller = alice, target = alice → `P0001 cannot self-remove; use leave_place (V1.1+)`.
- [ ] Target no-miembro: caller = alice, target = eve (sin membership en place) → `P0001 target is not an active member`.
- [ ] Target ya removido: caller = alice, target = dave (membership con `left_at NOT NULL`) → `P0001 target is not an active member`.
- [ ] Multi-owner co-owner OK: caller = bob, target = carol → succeeds (cualquier owner remueve no-owner).
- [ ] Cross-place denied: caller = alice (owner de place-1), target = carol (miembro de place-2 donde alice no es owner) → `P0001 caller is not an owner of this place`.

**Total S4: 10 vitest.**

---

## S5 — Shared UI extracción (RTL)

### `src/shared/ui/confirm-dialog.test.tsx` (nuevo, agente A)

**Casos cubiertos (6):**

- [ ] Render closed: `open={false}` → no aparece en DOM.
- [ ] Render open: `open={true}` + `title` + `description` + `confirmLabel` → todos visibles.
- [ ] Click confirm → `onConfirm()` invocado 1×.
- [ ] Click cancel/close → `onClose()` invocado, `onConfirm()` NO invocado.
- [ ] Destructive variant: `destructive={true}` → CTA con clase visual destructiva (color, ARIA).
- [ ] ARIA: dialog tiene `role="dialog"` + `aria-modal="true"` + focus trap inicial.

### `src/shared/ui/context-menu.test.tsx` (nuevo, agente B)

**Casos cubiertos (6):**

- [ ] Render trigger initially, no items visibles.
- [ ] Click trigger → items aparecen.
- [ ] Click item → `onClick` del item invocado + menú cierra.
- [ ] Click outside → menú cierra sin invocar ningún item.
- [ ] Destructive item: `destructive: true` → item con clase visual destructiva.
- [ ] Item con `icon` ReactNode → icon renderiza junto al label.

### `src/shared/ui/badge.test.tsx` (nuevo, agente C)

**Casos cubiertos (6):**

- [ ] Render con `variant="owner"` + children → texto visible + clase visual owner.
- [ ] Render con `variant="founder"` → clase distintiva founder.
- [ ] Render con `variant="pending"` → clase distintiva pending.
- [ ] Render con `variant="expired"` → clase distintiva expired.
- [ ] Render sin variant → throws TS error (test type-level).
- [ ] Render con children null/undefined → no rompe (graceful).

**Total S5: 18 vitest (RTL) distribuidos en 3 archivos.**

---

## S6 — Slice foundation: types + queries

### `src/features/members/queries/__tests__/load-members.test.ts` (nuevo)

**Por qué importa:** la query es la fuente única de verdad para la UI. Bug en JOIN/comparación con founder = badges mal asignados; bug en filter de `left_at IS NULL` = ex-miembros aparecen en lista activa.

**Harness:** `inRlsTx` con seed (1 place creado por alice + bob co-owner + carol miembro + dave ex-miembro left_at + eve sin membership).

**LOC budget estimado:** ~200.

**Casos cubiertos (7 total):**

- [ ] Happy: caller = alice (owner), `loadMembers(place_id)` → array con 3 entries (alice, bob, carol), cada uno con `{userId, displayName, handle, avatarUrl, headline, joinedAt, isOwner, isFounder}`.
- [ ] Filter ex-miembros: dave (con `left_at NOT NULL`) NO aparece en la lista.
- [ ] Filter no-miembros: eve (sin membership) NO aparece.
- [ ] Founder badge: alice.isFounder = true, alice.isOwner = true.
- [ ] Co-owner badge: bob.isFounder = false, bob.isOwner = true.
- [ ] Miembro no-owner: carol.isFounder = false, carol.isOwner = false.
- [ ] Caller no-owner del place: caller = carol → la RLS owner-only de `membership` deniega; query retorna [] (o throws RLS error según contrato — fijar comportamiento del test).

### `src/features/members/queries/__tests__/load-pending-invitations.test.ts` (nuevo)

**LOC budget estimado:** ~150.

**Casos cubiertos (5 total):**

- [ ] Happy: caller = alice, 2 invitations pending → array con 2 entries (`{invitationId, email, expiresAt, invitedByDisplayName}`).
- [ ] Filter accepted: invitation con `accepted_at NOT NULL` NO aparece.
- [ ] Filter expired: invitation con `expires_at < now()` NO aparece (sólo pending activas — V1 muestra sólo lo accionable; expired se purga eventualmente).
- [ ] Caller no-owner: query retorna [] (RLS deniega).
- [ ] Order: invitations ordenadas por `expires_at ASC` (más urgentes primero).

**Total S6: 12 vitest.**

---

## S7 — Server Actions invitations + headline (re-baseline seam-split 2026-05-25)

> Cambio de estrategia: vitest **NO** mockea Server Actions (canon vigente — ver plan-sesiones §S7 nota re-baseline). Se testea **lógica pura extraída** a `_lib/`. Las actions delgadas se verifican por typecheck + smoke S12.

### `src/features/members/actions/_lib/__tests__/schemas.test.ts`

**Casos cubiertos (7):**

- [ ] `createInvitationSchema` happy: `{placeId, email valid, expiresInDays: 7}` → success.
- [ ] `createInvitationSchema` invalid_email: `'no-arroba'` → fail.
- [ ] `createInvitationSchema` invalid_expires below: `expiresInDays: 0` → fail.
- [ ] `createInvitationSchema` invalid_expires above: `expiresInDays: 91` → fail.
- [ ] `revokeInvitationSchema` happy: `{invitationId}` → success.
- [ ] `updateMyHeadlineSchema` happy 280: `'a'.repeat(280)` → success.
- [ ] `updateMyHeadlineSchema` too_long: `'a'.repeat(281)` → fail; null y `''` ambos pasan.

### `src/features/members/actions/_lib/__tests__/map-invite-error.test.ts`

**Casos cubiertos (5):**

- [ ] `28000` / `'no autenticado'` → `'unauthorized'`.
- [ ] `'caller is not an owner of this place'` → `'not_owner'`.
- [ ] `'expires_at must be in the future'` → `'expires_in_past'`.
- [ ] `P0002` / `'app_user inexistente'` → `'unauthorized'`.
- [ ] Unknown error message → `'generic'`.

### `src/features/members/actions/_lib/__tests__/map-revoke-error.test.ts`

**Casos cubiertos (5):**

- [ ] `28000` → `'unauthorized'`.
- [ ] `'invitation not found'` → `'not_found'`.
- [ ] `'caller is not an owner of this place'` → `'not_owner'`.
- [ ] `'cannot revoke already-accepted invitation'` → `'already_accepted'`.
- [ ] Unknown → `'generic'`.

### `src/features/members/actions/_lib/__tests__/map-headline-error.test.ts`

**Casos cubiertos (4):**

- [ ] `28000` → `'unauthorized'`.
- [ ] `P0002` → `'unauthorized'` (compat con `update_my_headline` migration 0017).
- [ ] `'caller is not an active member of this place'` → `'not_member'`.
- [ ] Unknown → `'generic'`.

**Total S7: 21 vitest puros (sin next/headers ni DB).**

**Actions (wiring delgado, sin vitest)**: 3 archivos verificados por:
- `pnpm typecheck` (firma + import correcto de `_lib/`).
- Grep guards pre-commit (uso de `getAuthenticatedDbForRequest` + `revalidatePath`).
- Smoke E2E en S12 (happy path real con DB + Neon Auth).

---

## S8 — Server Actions member mgmt + ownership wrappers (re-baseline seam-split 2026-05-25)

> Cambio de estrategia: vitest **NO** mockea Server Actions (extensión del canon S7 — ver plan-sesiones §S8 nota re-baseline). Se testea **lógica pura extraída** a `_lib/` (4 nuevos schemas + 4 nuevos map-error modules). Las 4 actions delgadas se verifican por typecheck + smoke S12. Mismo principio del precedente S7.

### `src/features/members/actions/_lib/__tests__/schemas.test.ts` (EDIT — +4 describes)

Extensión sobre el file ya existente de S7 (3 schemas) — añade describes para los 4 nuevos schemas con shape `{placeId, targetUserId}`.

**Casos nuevos cubiertos (8):**

- [ ] `removeMemberSchema` happy: `{placeId: 'place_x', targetUserId: 'usr_y'}` → success.
- [ ] `removeMemberSchema` placeId vacío → fail (zod `.min(1)`).
- [ ] `elevateToOwnerSchema` happy → success.
- [ ] `elevateToOwnerSchema` targetUserId vacío → fail.
- [ ] `revokeOwnershipSchema` happy → success.
- [ ] `revokeOwnershipSchema` placeId vacío → fail.
- [ ] `transferFounderOwnershipSchema` happy → success.
- [ ] `transferFounderOwnershipSchema` targetUserId vacío → fail.

### `src/features/members/actions/_lib/__tests__/map-remove-member-error.test.ts` (nuevo)

Espejo del pattern S7 `map-invite-error.test.ts`. Cubre cada rama de migration 0020 `app.remove_member` + `unauthorized` y `generic`.

**Casos cubiertos (6):**

- [ ] `SQLSTATE 28000 / 'no autenticado'` → `'unauthorized'`.
- [ ] `SQLSTATE P0002 / 'app_user inexistente'` → `'unauthorized'`.
- [ ] `'caller is not an owner of this place'` → `'not_owner'`.
- [ ] `'target is an owner; revoke ownership first'` → `'target_is_owner'`.
- [ ] `'cannot self-remove; use leave_place (V1.1+)'` → `'cannot_self_remove'`.
- [ ] `'target is not an active member'` → `'target_not_active_member'`.
- [ ] Error desconocido → `'generic'`.

### `src/features/members/actions/_lib/__tests__/map-elevate-error.test.ts` (nuevo)

Cubre cada rama de migration 0014 `app.elevate_to_owner` (Feature D).

**Casos cubiertos (6):**

- [ ] `SQLSTATE 28000` → `'unauthorized'`.
- [ ] `SQLSTATE P0002` → `'unauthorized'`.
- [ ] `'caller is not an owner of this place'` → `'not_owner'`.
- [ ] `'place not found'` → `'place_not_found'`.
- [ ] `'target is already an owner'` → `'target_already_owner'`.
- [ ] `'target is not an active member'` → `'target_not_member'`.
- [ ] Error desconocido → `'generic'`.

### `src/features/members/actions/_lib/__tests__/map-revoke-ownership-error.test.ts` (nuevo)

Cubre cada rama de migration 0015 `app.revoke_ownership` (Feature D — la DEFINER con mayor superficie de errores: 7 ramas distintas).

**Casos cubiertos (7):**

- [ ] `SQLSTATE 28000` → `'unauthorized'`.
- [ ] `SQLSTATE P0002` → `'unauthorized'`.
- [ ] `'caller is not an owner of this place'` → `'not_owner'`.
- [ ] `'target is not an owner of this place'` → `'target_not_owner'`.
- [ ] `'cannot revoke founder ownership'` → `'cannot_revoke_founder'`.
- [ ] `'cannot self-revoke ownership; use transfer or future step-down'` → `'cannot_self_revoke'`.
- [ ] `'cannot revoke the only remaining owner'` → `'last_owner'`.
- [ ] Error desconocido → `'generic'`.

### `src/features/members/actions/_lib/__tests__/map-transfer-error.test.ts` (nuevo)

Cubre cada rama de migration 0016 `app.transfer_founder_ownership` (Feature D).

**Casos cubiertos (6):**

- [ ] `SQLSTATE 28000` → `'unauthorized'`.
- [ ] `SQLSTATE P0002` → `'unauthorized'`.
- [ ] `'place not found'` → `'place_not_found'`.
- [ ] `'caller is not the founder of this place'` → `'not_founder'`.
- [ ] `'target is not an owner; elevate first'` → `'target_not_owner'`.
- [ ] `'cannot transfer to self'` → `'cannot_transfer_to_self'`.
- [ ] Error desconocido → `'generic'`.

**Total S8: 37 vitest puros (8 schemas ext + 7 map-remove + 7 map-elevate + 8 map-revoke-ownership + 7 map-transfer; cada map cubre 1 caso por rama observable + 1 caso `'generic'` default).**

**Actions (wiring delgado, sin vitest)**: 4 archivos verificados por:
- `pnpm typecheck` (firma + import correcto de `_lib/`).
- Grep guards pre-commit (uso de `getAuthenticatedDbForRequest` + `revalidatePath` + zod via `_lib/schemas`).
- Smoke E2E en S12 (happy path real con DB + Neon Auth — CU4 remove, CU5 elevate, CU6 revoke, CU7 transfer).

---

## S9 — UI invite modal + pending tab (RTL)

### `src/features/members/ui/__tests__/invite-member-modal.test.tsx`

**Casos cubiertos (5):**

- [ ] Open form → email + expiresInDays input visibles.
- [ ] Submit valid form → invoca `createInvitationAction` con FormData; loading state during; success → muestra link copiable.
- [ ] Click "Copiar link" → `navigator.clipboard.writeText` invocado con link real; toast aparece.
- [ ] Validation error email → mensaje inline rojo; submit NO ocurre.
- [ ] Action error not_owner → toast error; modal sigue abierto.

### `src/features/members/ui/__tests__/pending-invitations-tab.test.tsx`

**Casos cubiertos (5):**

- [ ] Render con array de invitations → cada fila muestra email + caducidad relativa + botón "Revocar".
- [ ] Render array vacío → empty state visible.
- [ ] Click "Revocar" → abre `<ConfirmDialog>`.
- [ ] Confirm → invoca `revokeInvitationAction`; fila desaparece (optimistic update o post-revalidate).
- [ ] Action error already_accepted → toast error; fila NO desaparece.

**Total S9: 10 vitest.**

---

## S10 — UI members list + actions menu + headline editor (RTL)

### `src/features/members/ui/__tests__/members-list.test.tsx`

**Casos cubiertos (4):**

- [ ] Render array members → cada fila muestra avatar + display_name + handle.
- [ ] Render member con headline NOT NULL → bloque headline visible.
- [ ] Render member con headline NULL → bloque headline NO renderiza (sin placeholder).
- [ ] Badges: founder muestra `<Badge variant="founder">`, co-owner `<Badge variant="owner">`, miembro sin badge.

### `src/features/members/ui/__tests__/member-row-actions-menu.test.tsx`

**Por qué importa:** matriz role × role complex — bug = founder se ve "Transferir founder" a sí mismo, o miembro ve opciones que no debería.

**Casos cubiertos (6):**

- [ ] Caller founder, row no-owner: items ["Hacer co-owner", "Remover miembro"].
- [ ] Caller co-owner, row no-owner: items ["Remover miembro"] (no puede elevate a otros — sólo founder eleva en V1? Decidir en S10 según spec; este test fija comportamiento).
- [ ] Caller founder, row co-owner: items ["Revocar co-owner", "Transferir founder"].
- [ ] Caller co-owner, row co-owner: items ["Revocar co-owner"] (no transfer — sólo founder transfiere).
- [ ] Caller founder, row founder mismo: NO acciones destructivas (founder no-delete por sí mismo V1 — gap consciente).
- [ ] Caller miembro no-owner, row cualquier: menú no aparece (no es owner del place — UI no expone acciones).

### `src/features/members/ui/__tests__/headline-editor.test.tsx`

**Casos cubiertos (5):**

- [ ] Render con headline NOT NULL → texto visible + botón "Editar".
- [ ] Render con headline NULL + `isMe = true` → CTA "Agregar headline".
- [ ] Render con headline NULL + `isMe = false` → bloque entero NO renderiza.
- [ ] Click "Editar" → input visible con headline actual; counter caracteres (e.g. "12/280").
- [ ] Submit válido → invoca `updateMyHeadlineAction`; UI update post-success.

**Total S10: 15 vitest.**

---

## S11 — Page + sidebar + i18n ×6 (parity + render smoke)

### `src/features/members/__tests__/i18n-keys.test.ts` (nuevo)

**Casos cubiertos (2):**

- [ ] Todas las keys `placeMembers.*` usadas en `src/features/members/ui/*.tsx` existen en `i18n/messages/es.json` (defense contra typos).
- [ ] Bonus: parity check informativo entre `es.json` y los otros 5 locales (puede ser warning, no error — ADR-0024 deep-merge runtime cubre missing keys con fallback).

### `src/app/[placeSlug]/(place)/settings/members/__tests__/page.test.ts` (nuevo)

**Casos cubiertos (1):**

- [ ] Page renderiza con `<AppShell>` + tabs + lista de miembros + tab pendientes (smoke test RSC — render server-side con queries mockeadas).

**Verificación manual:**

- [ ] `pnpm dev` → navegar `/<placeSlug>/settings/members` → sidebar item "Miembros" activo (no disabled); page renderiza; modal "Invitar" abre.
- [ ] `node scripts/check-translations.mjs` ejecutado — sin errores fatales (warnings de drift pre-S11 OK).

**Total S11: 3 vitest + 2 verificaciones manuales.**

---

## S12 — Smoke E2E manual + write-back + push autorizado

### Verificación manual (no vitest)

Ejecutar los 11 steps del `spec.md` §"Smoke verification" contra Neon test branch + browser real:

- [ ] Step 1 — Setup: 3 users + 1 place alice (founder via `app.create_place`).
- [ ] Step 2 — CU2 Invitar: alice abre modal, crea invitación bob, copia link.
- [ ] Step 3 — Aceptar: bob acepta link en incognito; aparece en lista de alice.
- [ ] Step 4 — CU1 Editar headline: bob edita su headline; render condicional aparece.
- [ ] Step 5 — CU5 Elevar: alice eleva bob a co-owner; badge "Owner" aparece.
- [ ] Step 6 — CU3 Revocar invitación pending: alice crea+revoca carol; fila desaparece.
- [ ] Step 7 — CU4 Remover miembro: alice remueve eve (post-accept); membership.left_at NOT NULL.
- [ ] Step 8 — CU6 Revocar co-owner: alice revoca bob (co-owner); ownership row desaparece; membership intacta.
- [ ] Step 9 — CU7 Transferir founder: re-elevar bob; alice transfiere founder a bob; place.founder_user_id = bob.
- [ ] Step 10 — Regression: bob (nuevo founder) intenta `remove_member(alice)` → error `target_is_owner`.
- [ ] Step 11 — i18n: cambiar `place.default_locale` a `en` → todos los labels traducidos.

### Pre-push checklist (gating push autorizado)

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean (sin warnings de los archivos nuevos).
- [ ] `pnpm test` verde — suite total = baseline post-Feature-D 761 + Feature E tests acumulados (~118).
- [ ] `pnpm build` exitoso — Next 16 build sin warnings.
- [ ] `git diff baseline/feature-e-s11-done -- src/` empty (S12 sólo toca docs).
- [ ] LOC budget verificado: `find src/features/members -name '*.ts' -o -name '*.tsx' | xargs wc -l` ≤1500 LOC (cap feature).
- [ ] Push autorizado **explícitamente** por el user en el turno de S12 (memoria operacional: nunca push sin autorización turno-a-turno).

**Total S12: 11 verificaciones manuales smoke + 7 gates pre-push (manual/script).**

---

## Coverage acumulado

V1 esperado al cierre S12:

| Sesión | Tests vitest nuevos | Verificaciones manuales |
|---|---|---|
| S1 — Migration 0017 schema + update_my_headline DEFINER | 20 | 4 psql |
| S2 — `app.create_invitation` | 10 | — |
| S3 — `app.revoke_invitation` | 8 | — |
| S4 — `app.remove_member` | 10 | — |
| S5 — Shared UI (3 componentes × 6 tests) | 18 | — |
| S6 — Queries (load-members + load-pending-invitations) | 12 | — |
| S7 — Server Actions invitations + headline (seam-split puro) | 21 | — |
| S8 — Server Actions member mgmt + ownership wrappers (seam-split puro) | 37 | — |
| S9 — UI invite modal + pending tab | 10 | — |
| S10 — UI members list + actions menu + headline editor | 15 | — |
| S11 — i18n parity + page render smoke | 3 | 2 (dev server + check-translations) |
| S12 — Smoke E2E + gating push | — | 11 smoke + 7 pre-push |
| **Total nuevo** | **~141 vitest** | **~24 manual/psql** |

S12 smoke + gating push NO se contabilizan como tests vitest. Total proyectado vitest puede flex ±15 según density real de tests RTL (algunos casos se pueden combinar en un solo `it()` parametrizado).

---

## Lo que NO probamos (decisión)

- **RLS owner-only de `place`/`membership`/`invitation`/`place_domain`** — ya cubierto por suites existentes desde ADR-0012 + ADR-0035 (Feature D). Feature E NO modifica esas policies (sólo agrega columnas a tablas existentes); tests existentes deben seguir verdes (regression implícita en suite total post-S12).
- **Gate por cupo de invitaciones** — ADR-0037 §4 V1 es schema-only; no hay gate function todavía. V2+ agregará tests.
- **Counter `membership.invitations_used` increment/decrement** — V2+ con counter.
- **UI editor de `member_invite_quota`** — V2+.
- **`leave_place`** — V1.1+ — endpoint diferido.
- **Auto-revoke ownership** — V1.1+ (mantenido bloqueado por Feature D).
- **Notificaciones** — V1 no notifica al ex-miembro removido ni al invitado por email — capability link copiable manual (ADR-0010 §2). V1.1+ con notifs.
- **Búsqueda/filter/sort de lista de miembros** — V1.1+ (lista cruda ordenada por `joined_at DESC`).
- **Pagination** — cap 150 miembros por place (invariante data-model.md) hace pagination innecesaria V1.
- **Auditoría/historial** — V1 no logea cambios de membership. V1.1+ si compliance lo pide.
- **Concurrent invitations** — V1 confía en `invitation.token UNIQUE` para race; sin tests de carga.
- **Performance** — no se mide en vitest. Volumen V1 esperado: <10 invite/remove/elevate por place per día; sub-ms en PG. Cost budget no aplica.

---

## Pointers

- **ADRs canónicas V1**: [`../../decisions/0036-member-bio-contextual.md`](../../decisions/0036-member-bio-contextual.md), [`../../decisions/0037-member-invite-quota.md`](../../decisions/0037-member-invite-quota.md).
- **Spec del feature**: [`./spec.md`](./spec.md).
- **Plan de sesiones**: [`./plan-sesiones.md`](./plan-sesiones.md).
- **Precedente harness RLS**: `src/db/__tests__/db-test-pool.ts` (`inRlsTx`).
- **Precedente test SQL directo SECURITY DEFINER**: `src/db/__tests__/elevate-to-owner.test.ts` (Feature D S2, mismo patrón de inyección de claim + assert RAISE EXCEPTION + REVOKE PUBLIC enforcement). También `src/db/__tests__/consume-sso-jti.test.ts` (Feature C S1).
- **Precedente test Server Action wrapper**: revisar tests de `update-default-locale` (Feature settings) y `register-custom-domain` (Feature custom-domain) — patrón canónico de mock zod + invoke DEFINER + assert revalidatePath.
- **ADRs relacionadas**: ADR-0010 §2 (refinada por 0037 — invitation flow), ADR-0021 (member-read pattern para V1.1+), ADR-0034 (zone-aware Server Actions).
