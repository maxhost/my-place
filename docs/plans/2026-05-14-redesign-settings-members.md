# Plan — Rediseño `/settings/members` con detail-from-list (4 sesiones)

## Context

`/settings/members` hoy mezcla 5 concerns en una page de 121 LOC con layout vertical plano: lista activos (sin search/filter/paginación), invitar form inline, invitaciones pendientes, transferir ownership, salir del place. Adicionalmente hay sub-page `[userId]/page.tsx` (148 LOC) con groups, tiers, block y expel sections.

Aplicamos el **patrón canónico `detail-from-list`** ya consolidado en `groups/admin` (S7, 2026-05-13) y `library/admin`:

- **Row tappable → EditPanel read-only** (sidepanel desktop 520px / bottom sheet mobile).
- Kebab `<RowActions forceOverflow>` con atajos.
- Dashed-border `+ Nuevo` al final.
- State machine discriminada para overlays.
- Latch interno en panels para preservar Radix Presence exit anim.

**Decisiones del user (2026-05-14)**:

- Detalle completo del miembro (groups, tiers, block, expel) → al EditPanel. **Drop sub-page `[userId]/page.tsx`**.
- **Drop "Salir del place"** del page (ya vive en `/settings/system`).
- "Transferir ownership" se mantiene como sección al final (sin tocar — fuera de scope).
- Funcionalidades nuevas: filter chip Activos/Invitados, search por nombre/handle (activos) o email (pending), paginación server-side, cancelar invitación.

**Privacy guard rail** (decisión #6 spec members): email NO se expone para active members. El input de search se aplica contra `displayName + handle` cuando el tab es Activos, contra `email` cuando el tab es Invitados.

**Backend ya disponible** (no requiere extender):

- `searchMembers(placeId, params)` en `directory/server/directory-queries.ts:302` — search por q (displayName/handle), filters por group/tier/joinedSince. Falta paginación.
- `listPendingInvitationsByPlace(placeId)` en `server/queries.ts:295` — lista pendientes con delivery info. Falta search por email + paginación.
- `revokeInvitationAction` con permission `members:revoke-invitation` (gateado server-side, canónico).
- `inviteMemberAction`, `resendInvitationAction`, `blockMemberAction`, `unblockMemberAction`, `expelMemberAction` — todos disponibles.
- Sub-slices `moderation/`, `invitations/`, `profile/`, `directory/`, `access/` ya estructurados.

**Outcome esperado** post-4 sesiones:

- `/settings/members` page flat con `<PageHeader>` + `<MembersAdminPanel>` consumiendo queries paginadas.
- Filter chips Activos (N) / Invitados (M), search bar, paginación URL-based.
- Click row → EditPanel con detalle read-only (info + acciones).
- Footer del panel: Bloquear/Expulsar/Cambiar tiers/Cambiar grupos (miembro), Reenviar/Cancelar (invitación).
- Sub-page `[userId]/page.tsx` eliminada — toda la info migra al panel.
- Drop legacy duplicates (`features/members/ui/invite-form.tsx`, `pending-invitations-list.tsx`, `resend-invitation-button.tsx`, `leave-button.tsx` raíz).
- `ux-patterns.md` actualizado con members como tercer consumer canónico del patrón.

**LOC budget global**: archivos ≤300, funciones ≤60, feature completa ≤1500, módulo ≤800.

---

## Sesión 1 — Backend: paginación + search unificado

**Goal**: extender queries para soportar paginación + search por email en invitations. Esta sesión es deployable sola — las queries nuevas son backward-compatible (params opcionales). UI sigue sin cambiar.

**Files**:

- `src/features/members/schemas.ts` (145 LOC → ~180 LOC)
  - Sumar `directoryQueryParamsSchema` Zod: `{ tab: 'active' | 'pending', q?: string, page?: number, limit?: number }` con `tab` requerido y defaults `page=1, limit=20`.
  - Tests en `__tests__/schemas.test.ts`: validación de tab inválido, q max length, page ≥ 1, limit cap 50.

- `src/features/members/directory/server/directory-queries.ts` (302 LOC → ~370 LOC)
  - Refactor `searchMembers(placeId, params)` para aceptar `{ page, limit }`. Retornar shape `{ rows: MemberSummary[], totalCount: number, hasMore: boolean }` en vez de `MemberSummary[]` pelado.
  - Mantener `q`, `groupId`, `tierId`, `joinedSince` (ya implementados).
  - Cap interno: `limit` clamped a [1, 50]; `page` clamped a >= 1.
  - Test query con paginación: tests existentes en `__tests__/search-members.test.ts` (verificar 3 queries paralelas, sin N+1) + 2 nuevos: page 1 con totalCount, page 2 con hasMore=false al final.

- `src/features/members/server/queries.ts` (295 LOC → ~360 LOC)
  - Refactor `listPendingInvitationsByPlace(placeId)` → `listPendingInvitationsByPlace(placeId, params: { q?, page?, limit? })`. Retornar `{ rows: PendingInvitation[], totalCount, hasMore }`.
  - WHERE: `acceptedAt IS NULL AND expiresAt > now()` + opcional `email ILIKE %q%`.
  - ORDER BY: `expiresAt ASC` (mantener).
  - SELECT con inviter inline (mantener).
  - Tests nuevos en `__tests__/list-pending-invitations.test.ts` (~80 LOC, nuevo): paginación + search por email + edge cases (q sin matches, page > totalPages).

- Update `src/features/members/public.server.ts` y `directory/public.server.ts` — exportar nuevas signatures + types nuevos (`MemberDirectoryPage`, `PendingInvitationsPage`).

**Verificación**:

- `pnpm vitest run src/features/members` — todos los tests existentes pasan + nuevos verdes.
- `pnpm typecheck` — verde.
- Grep `searchMembers(` y `listPendingInvitationsByPlace(` en codebase: solo el callers existentes (page + tests). Si hay más, ajustar para nueva signature.

**LOC delta**: +200 net (schema +35, directory +70, queries +65, tests +80, ajustes callers ≈ -10).

**Riesgo deploy**: bajo. Las queries cambian shape (array → objeto paginado) pero los callers actuales son solo `/settings/members/page.tsx` que se reescribe en sesión 3. Como mitigación, NO mergeamos sesión 1 sola sin sesión 3 — el orden es: commit local, sesión 3 consume las nuevas signatures, push después.

---

## Sesión 2 — Frontend: orquestador + detail panel de miembros

**Goal**: crear el sub-slice `features/members/admin/` con el orchestrator y el detail panel para miembros activos. Mirror exacto del `<GroupsAdminPanel>`. NO consume aún en page — eso queda para sesión 3.

**Files**:

- `src/features/members/admin/public.ts` (nuevo, ~30 LOC)
  - Barrel del sub-slice. Exporta `MembersAdminPanel`, `MemberDetailPanel`, `InvitationDetailPanel` (sesión 3), `InviteMemberSheet`.

- `src/features/members/admin/ui/members-admin-panel.tsx` (nuevo, ~280 LOC máx)
  - Client orchestrator. Props: `placeSlug`, `tab: 'active' | 'pending'`, `q: string`, `page: number`, `membersPage: MemberDirectoryPage`, `invitationsPage: PendingInvitationsPage`, `canRevoke: boolean`, `canBlock: boolean`, `canExpel: boolean`, `viewerUserId: string`, `allGroups`, `allTiers` (para resolución de IDs → labels en panel).
  - State machine:
    ```ts
    type SheetState =
      | { kind: 'closed' }
      | { kind: 'invite' }
      | { kind: 'detail-member'; userId: string }
      | { kind: 'detail-invitation'; invitationId: string }
    ```
  - Renderiza listado (`<ul divide-y>`) con rows tappables. Empty states.
  - Dashed-border "+ Invitar miembro" al final → setSheet `{kind: 'invite'}`.
  - Latch interno para detail panels (Radix Presence).

- `src/features/members/admin/ui/member-row.tsx` (nuevo, ~120 LOC)
  - Server-safe component. Row tappable: button principal (avatar + displayName + handle + role chips owner/admin + joinedAt) + kebab `<RowActions forceOverflow>` con [Ver detalle (atajo, equivalente a tap row), Expulsar (destructive)] si aplica permission.
  - Kebab fuera del button principal (sibling) para evitar tap propagation — patrón canónico de `<TierCard>`.

- `src/features/members/admin/ui/invitation-row.tsx` (nuevo, ~110 LOC)
  - Análoga a `member-row` para invitations. Row con email + delivery chip + invitedBy + expira. Kebab: [Reenviar, Cancelar (destructive con confirm)].

- `src/features/members/admin/ui/member-detail-panel.tsx` (nuevo, ~280 LOC máx)
  - EditPanel read-only del miembro. Mirror exacto de `<GroupDetailPanel>`.
  - Header: avatar grande + displayName + chips role + handle.
  - Body sections (canonical `<h2 border-b>`):
    - Membresía: joinedAt, antigüedad calculada (`Intl.RelativeTimeFormat`).
    - Tiers asignados: lista con chips (read-only en V1; "Gestionar tiers" botón abre sub-sheet `<MemberTiersSheet>` — postergado a sesión 4 si no entra en LOC budget esta).
    - Grupos asignados: similar a tiers — chips read-only + "Gestionar grupos" botón.
    - Bloqueo: si `blockedAt`, mostrar fecha, razón y action "Desbloquear" (filled neutral). Si no, sección oculta.
  - Footer: kebab/buttons inline:
    - "Bloquear" filled red (si `canBlock` && target not owner && target not self && not blocked).
    - "Expulsar" destructive (si `canExpel` && target not owner && target not self).
  - Latch interno: `{member, blockInfo}` non-null preservado.

- `src/features/members/admin/__tests__/members-admin-panel.test.tsx` (nuevo, ~100 LOC)
  - Test render con tab active vacío, tab active con rows, tab pending, click row dispara state change.
  - Mock `next/navigation` (router + pathname).

- `src/features/members/admin/__tests__/member-detail-panel.test.tsx` (nuevo, ~120 LOC)
  - Test: render con member sin bloqueo, render con member bloqueado, footer actions visibility según permisos (canBlock, canExpel, isSelf, isOwner target).

- Update `src/features/members/public.ts` — re-exportar `{ MembersAdminPanel, MemberDetailPanel, InvitationDetailPanel, InviteMemberSheet }` desde `./admin/public`.

**Verificación**:

- `pnpm vitest run src/features/members/admin` — todos verde.
- `pnpm typecheck` + `pnpm lint`.
- Visual smoke local: mount Storybook-like vía test (skipear si no hay infra), o simplemente confirmar typecheck + tests para esta sesión.

**LOC delta**: +1010 (5 archivos UI ≈ 920 + 2 test files ≈ 220 - exports). Cada archivo ≤300 ✓.

**Riesgo deploy**: cero. Los nuevos componentes no se consumen aún (la page actual sigue intacta). Safe to commit + push.

---

## Sesión 3 — Frontend: page integration + sub-overlays (invite, invitation detail, member tiers/groups)

**Goal**: completar overlays restantes, eliminar sub-page legacy, reescribir `/settings/members/page.tsx`.

**Files**:

- `src/features/members/admin/ui/invitation-detail-panel.tsx` (nuevo, ~180 LOC)
  - EditPanel read-only de una invitation. Header: email + delivery chip.
  - Body: invitedBy (displayName), sentAt, expiresAt (con fmt locale), delivery status detail (PENDING/SENT/DELIVERED/BOUNCED/COMPLAINED/FAILED con explicación corta).
  - Footer:
    - "Reenviar" filled primary (si delivery no FINAL_OK aún o si user quiere forzar reenvío).
    - "Cancelar invitación" destructive con confirm (gateado: `canRevoke` prop pasado por orchestrator).
  - Latch interno.

- `src/features/members/admin/ui/invite-member-sheet.tsx` (nuevo, ~220 LOC)
  - EditPanel con form RHF. Inputs: email (required, Zod), checkbox `asAdmin` (owner-only), checkbox `asOwner` (owner-only).
  - Footer: "Listo" filled primary + "Cancelar" outline.
  - Submit: `inviteMemberAction` → toast success/error según result, cierra sheet.

- `src/features/members/admin/ui/member-tiers-sheet.tsx` (nuevo, ~180 LOC)
  - Sub-sheet (abre desde detail panel "Gestionar tiers"). Lista de tiers del place con checkbox por tier. Mutación: optimistic update + `addMemberToTierAction` / `removeMemberFromTierAction` (estos actions deben existir — verificar; si no, crear en sesión 3.5 — anotado abajo).
  - Cerrar al "Listo" vuelve al detail panel (`returnTo: 'detail'`).

- `src/features/members/admin/ui/member-groups-sheet.tsx` (nuevo, ~150 LOC)
  - Análogo para grupos. Reutiliza `addMemberToGroupAction` / `removeMemberFromGroupAction` del slice groups.

- Update `<MembersAdminPanel>` (sesión 2):
  - Sumar variants al SheetState:
    ```ts
    | { kind: 'invitation-detail'; invitationId }
    | { kind: 'edit-tiers'; userId; returnTo: 'closed' | 'detail-member' }
    | { kind: 'edit-groups'; userId; returnTo: 'closed' | 'detail-member' }
    ```
  - Wiring entre detail-member y sub-sheets (close → returnTo).
  - LOC final estimado ≤ 320 — si supera 300, extraer la lógica de close-state-machine a helper.

- `src/app/[placeSlug]/settings/members/page.tsx` (121 LOC → ~150 LOC)
  - Streaming aggressive shell: top-level await SOLO para gate (auth + place + perms). Datos a Suspense.
  - Resolver `searchParams`: `{ tab, q, page }` con defaults `tab='active', q='', page=1`. Validar con `directoryQueryParamsSchema` (defensa).
  - Cargar paralelo según tab activo:
    - `tab='active'`: `searchMembers(placeId, params)` + `listAllGroups()` + `listAllTiers()` (para resolver IDs en detail panel).
    - `tab='pending'`: `listPendingInvitationsByPlace(placeId, params)`.
  - Renderizar:
    - `<PageHeader title="Miembros" description="N de M miembros · K invitaciones pendientes." />`
    - `<MembersAdminPanel ... />` con todos los props.
    - Sección `<h2>` "Transferir ownership" (mantenida, sin tocar).
  - Drop: `<LeaveButton>` import y render.
  - Drop: `<PendingInvitationsList>` (la lista nueva vive en `<MembersAdminPanel>`).
  - Drop: `<InviteMemberForm>` inline (reemplazado por sheet desde dashed-border).

- Drop completo:
  - `src/app/[placeSlug]/settings/members/[userId]/page.tsx`
  - `src/app/[placeSlug]/settings/members/[userId]/components/*` (member-detail-header, expel-section, groups-section, tiers-section, block-section, \_groups-section, \_tiers-section, \_block-section).
  - `src/app/[placeSlug]/settings/members/[userId]/__tests__/*`.
  - `src/app/[placeSlug]/settings/members/components/member-filters.tsx` (chip refactor reemplaza filtros viejos).
  - `src/app/[placeSlug]/settings/members/components/members-list.tsx` y `member-row.tsx` (la lista vive en admin sub-slice).
  - Mantener: `src/app/[placeSlug]/settings/members/components/member-search-bar.tsx` SI se decide re-usar; sino drop. Decisión: drop, el search bar lo absorbe el admin panel.

- E2E tests:
  - Verificar tests existentes en `tests/e2e/flows/members-directory.spec.ts` y `member-block-expel.spec.ts` — ajustar selectores si rompen, o marcar como `xfail` con TODO si selectores deep changed (preferible: ajustar selectores en mismo PR).

**Verificación**:

- `pnpm vitest run` — full suite 2096+ tests verde.
- `pnpm typecheck` + `pnpm lint`.
- `pnpm build` — smoke build (no `next start`).
- Manual smoke en local con `pnpm dev`:
  - Tab active: search funciona, paginación funciona, click row abre detail, footer actions visibles según permiso.
  - Tab pending: search por email, click row abre invitation detail, Reenviar y Cancelar funcionan.
  - Invitar: dashed-border abre sheet, submit invita, toast success.

**LOC delta**: +730 (4 nuevos sheets +750 + page +30) - 600 (drop sub-page + components + co-located legacy). Net: +130.

**Riesgo deploy**: alto — refactor central de `/settings/members`. Mitigación: tests E2E + smoke manual + revisar `members:revoke-invitation` permission gate antes de habilitar Cancelar.

**Nota sobre actions tier/group memberships del miembro**: verificar que `addMemberToTierAction`, `removeMemberFromTierAction` existen en `features/tiers` o `features/members`. Si NO existen (probable — la sub-page `[userId]/page.tsx` los podría haber consumido directo, audit pendiente al inicio de sesión 3), CREAR en sub-sesión 3.0 ANTES de tocar UI (+1 sesión chiquita, ≤100 LOC con tests).

---

## Sesión 4 — Cleanup + docs

**Goal**: eliminar duplicates legacy del slice `members/ui/` raíz, actualizar `ux-patterns.md` con la nueva canónica, ADR.

**Files**:

- Drop completo (legacy duplicates ya no consumidos):
  - `src/features/members/ui/invite-form.tsx` (duplicate de `invitations/ui/invite-form.tsx`).
  - `src/features/members/ui/pending-invitations-list.tsx` (duplicate de `invitations/ui/pending-invitations-list.tsx`).
  - `src/features/members/ui/resend-invitation-button.tsx` (duplicate).
  - `src/features/members/ui/leave-button.tsx` raíz (existe en `profile/ui/leave-button.tsx` también — verificar cuál consumen otros callers y drop el huérfano).
  - Verificar con grep que ningún caller los importa antes de drop.

- `src/features/members/public.ts` y `public.server.ts`:
  - Drop re-exports de los archivos eliminados.

- `docs/ux-patterns.md` (968 → ~1000 LOC):
  - § "Settings/members — extension del patrón" (líneas 882-968): reescribir reflejando que el patrón aplicado es **flat con detail-from-list** (no master-detail), members como tercer consumer canónico junto a groups y library.
  - § "Detail-from-list pattern" (línea 432): sumar callsite `features/members/admin/ui/members-admin-panel.tsx` a la lista de referencia.
  - Actualizar tabla "Patrón canónico aplica directo" reflejando flat layout.

- `docs/decisions/2026-05-14-members-detail-from-list.md` (nuevo, ~120 LOC, ADR):
  - Decisión: aplicar el patrón canónico flat detail-from-list a `/settings/members`.
  - Alternativas consideradas: (a) master-detail original (descartada: inconsistente con groups/library; el doc estaba desactualizado). (b) mantener sub-page `[userId]` como fallback (descartada: simplifica drop). (c) mover invitations a `/settings/access` (descartada: el user pidió ambos en misma page con filter chip).
  - Trade-offs: detail panel concentra mucha info (tiers + groups + block + expel) — mitigado con sub-sheets para mutaciones complejas.

**Verificación**:

- `grep -r "PendingInvitationsList" src/` (post-cleanup): solo en docs/tests, no en código vivo.
- `grep -r "members/ui/invite-form" src/`: cero hits.
- `pnpm typecheck` + `pnpm vitest run` + `pnpm lint` — verde.

**LOC delta**: -350 (drop legacy) + 200 (docs/ADR) = -150 net en código.

**Riesgo deploy**: bajo (solo limpieza + docs).

---

## Resumen total

| Sesión    | LOC delta              | Files tocados                                                  | Riesgo deploy           |
| --------- | ---------------------- | -------------------------------------------------------------- | ----------------------- |
| 1         | +200                   | 5 (schema + 2 queries + 2 test files)                          | Bajo (no consumido aún) |
| 2         | +1010                  | 7 (admin sub-slice nuevo)                                      | Cero (no consumido)     |
| 3         | +130 net (+730 / -600) | ~25 (page + 4 nuevos sheets + drop sub-page + drop co-located) | Alto (refactor central) |
| 4         | -150 net (-350 / +200) | ~8 (drop dupes + docs + ADR)                                   | Bajo (cleanup)          |
| **Total** | **+1190 net**          | **~45**                                                        | —                       |

## Cumplimiento CLAUDE.md / architecture.md

- **LOC caps**: cada archivo nuevo ≤300, cada función ≤60, sub-slice admin ≤1500. Verificar en cada sesión con `wc -l`.
- **Vertical slices**: nuevo sub-slice `features/members/admin/` con su `public.ts`. Cross-slice imports vía `public.ts` (groups → addMemberToGroupAction, tiers → addMemberToTierAction). NO importar internals.
- **TDD**: tests primero en sesión 1 (queries) y sesión 2 (panels). Sesión 3 se apoya en tests existentes + nuevos E2E adjustments.
- **Streaming agresivo del shell** (`docs/architecture.md`): page `/settings/members` aplica gate top-level await (auth + place + perms) y Suspense para data fetch.
- **Mobile-first padding canónico** (ux-patterns.md): `space-y-6 px-3 py-6 md:px-4 md:py-8`.
- **Color palette neutrals** (ux-patterns.md): raw Tailwind, no CSS vars de brand.
- **`<RowActions>` destructive auto-confirm**: Cancelar invitación y Expulsar usan el confirm dialog automático del primitive.
- **Permission gating server-side**: `members:revoke-invitation` ya canónico, los otros (block/expel) ya gateados. NO hardcodear "owner only" en actions.
- **Privacy**: email NO se expone para active members. Search por email aplica solo a tab `pending`.
- **Idioma**: docs/comentarios español, código inglés.
- **Diagnosticar antes de inferir**: audit del slice ya hecho previo al plan (320 archivos mapeados).
- **Sesiones cortas y focalizadas**: 4 sesiones, cada una deployable sola (con la excepción de sesión 1 → sesión 3 que se mergean juntas por backward-compat de query shape).
- **Nunca asumir state del código**: cada sesión lee archivos antes de modificar.

## Cleanup posterior (no en este plan)

- Mover "Transferir ownership" a `/settings/access` o `/settings/system` cuando se rediseñen.
- Si emerge necesidad de bulk actions ("asignar tier X a N miembros"), sumar checkbox selection + footer toolbar (no V1 — sumar cuando emerja caso real).
- Virtualización si el listado supera 150 (no aplica hoy por invariante).

## Critical files reference

- `src/app/[placeSlug]/settings/members/page.tsx` — page a reescribir.
- `src/app/[placeSlug]/settings/members/[userId]/page.tsx` — drop completo en sesión 3.
- `src/features/members/directory/server/directory-queries.ts:302` — extender paginación.
- `src/features/members/server/queries.ts:295` — extender pending invitations.
- `src/features/members/invitations/server/actions/revoke.ts:39` — `revokeInvitationAction` existente (no tocar).
- `src/features/groups/domain/permissions.ts:41` — `members:revoke-invitation` (no tocar).
- `src/features/groups/admin/ui/groups-admin-panel.tsx:337 LOC` — referencia canónica para `<MembersAdminPanel>`.
- `src/features/groups/admin/ui/group-detail-panel.tsx:307 LOC` — referencia canónica para `<MemberDetailPanel>`.
- `src/shared/ui/edit-panel.tsx` — primitive.
- `src/shared/ui/row-actions.tsx:309 LOC` — primitive con `forceOverflow` + destructive auto-confirm.
- `src/shared/ui/page-header.tsx:65 LOC` — primitive del título.
- `docs/ux-patterns.md:432` — § Detail-from-list pattern (a actualizar en sesión 4).
- `docs/ux-patterns.md:882` — § Settings/members propuesta vieja (reemplazar en sesión 4).
