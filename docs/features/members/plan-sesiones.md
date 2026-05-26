# Members slice V1 — Plan de sesiones (S0 esqueleto)

> _Plan creado 2026-05-24 (S0 de Feature E). Esqueleto de 12 sesiones (S1-S12) — el detalle de implementación lo arma cada sesión cuando arranque. Decisiones canónicas: [ADR-0035](../../decisions/0035-place-ownership-multi-owner-v1.md) (Feature D ya cerrada, consumida acá), [ADR-0036](../../decisions/0036-member-bio-contextual.md), [ADR-0037](../../decisions/0037-member-invite-quota.md). Spec en [`./spec.md`](./spec.md). Tests TDD en [`./tests.md`](./tests.md). Baseline pre-implementación: `baseline/pre-feature-e` = `ff1d18c` (HEAD post Feature D S6 cierre)._

## Status

| Sesión | Status | Tag baseline | Resumen |
|---|---|---|---|
| S-1 | ✅ closed | `baseline/feature-e-setup-done` (`54c865a`) | Save point + scaffold `docs/features/members/` |
| S0 | 🟡 in flight | `baseline/feature-e-s0-done` (esperado) | ADR-0036 + ADR-0037 + spec + plan-sesiones + tests + ontologia flip + data-model write-back |
| S1-S12 | ⏳ pending | — | DB layer + shared/ui + actions + UI + i18n + smoke |

Suite objetivo post-S12: baseline post-Feature-D 761 + Feature E tests (estimado ~70-90 tests, distribuidos S1-S12).

Comando rollback total inmediato (estado pre-Feature-E, idéntico a Feature D V1 cerrada):

```bash
git reset --hard baseline/pre-feature-e
```

## Guardrails operacionales (canónicos del proyecto)

Antes de cada sesión:
1. `git status --short` clean del scope previo (sólo `.gitignore` modificado + `.claude/` untracked pre-existentes).
2. Verificar baseline pre-sesión: `git log -1 --oneline` matches tag esperado.
3. `pnpm test` verde + `pnpm typecheck` clean + `pnpm lint` clean (no arrancar sobre superficie roja).
4. Compactar contexto (`/compact`) si la sesión anterior dejó conversación larga.
5. Revisar este plan-sesiones + CLAUDE.md + spec.md (triple review pre-implementación, regla CLAUDE.md §"Antes de implementar").

Después de cada sesión:
1. Pre-commit checklist completo (cada sesión define el suyo abajo).
2. `git status --short` verificar archivos a stagear (NUNCA `git add -A`/`git add .` — memoria operacional).
3. Stage paths explícitos uno por uno (`git add <path1> <path2> ...`).
4. Commit con mensaje del formato definido por sesión.
5. Tag `baseline/feature-e-s<N>-done` apuntando al HEAD post-commit.
6. **NO push** hasta autorización explícita turno-por-turno (memoria operacional canónica).

Paralelización (regla operacional Feature E):
- Agentes paralelos SÓLO sobre archivos ortogonales (ninguno toca el mismo archivo).
- Si una sesión requiere edits sobre archivos compartidos: el agente principal escribe primero; agentes secundarios sólo consumen.

LOC budget canónico (CLAUDE.md §"Límites de tamaño"):
- Archivo ≤300 líneas · función ≤60 · feature ≤1500 LOC · shared/ui módulo ≤800.

## Sesiones

### S1 — Migration 0017 schema (headline + member_invite_quota) + `app.update_my_headline` DEFINER

**Objetivo único**: agregar las 2 columnas nuevas (ADR-0036 + ADR-0037) en una sola migration + la función DEFINER `app.update_my_headline` que canaliza la edición self-only del headline (decisión §"Decisión operativa" de spec.md — DEFINER para aislar la column exposure del UPDATE acotado).

**Archivos esperados** (3-5):
- `src/db/migrations/0017_membership_headline_place_invite_quota.sql` (migration nueva — 2 ALTERs + 2 CHECK constraints + función `app.update_my_headline` SECURITY DEFINER + REVOKE PUBLIC + GRANT app_system).
- `src/db/schema/index.ts` — edición manual: agregar `headline: text("headline")` con `.check()` en `membership` + `memberInviteQuota: integer("member_invite_quota").notNull().default(0)` con `.check()` en `place`. Drizzle introspect NO genera CHECK constraints — todo el SQL crítico vive en la migration.
- `src/db/__tests__/schema-headline-quota.test.ts` (tests TDD estructurales — ~12 tests: columnas existen, defaults, CHECK constraints, NULL/NOT NULL).
- `src/db/__tests__/update-my-headline.test.ts` (tests TDD DEFINER — ~8 tests: happy, not authenticated, not member, too long, NULL set, owner-edit-self OK, owner-edit-other DENIED, member-edit-self OK).
- `src/db/migrations/meta/_journal.json` actualizado.

**Locked files** (NO modificar en S1):
- ADRs 0036/0037 (canónicas).
- `docs/data-model.md` (ya refinada en S0).
- `docs/ontologia/miembros.md` (ya refinada en S0).
- Cualquier archivo en `src/features/` (la slice se arma S6+).

**Tests TDD**: ver `tests.md` §S1 (estructurales + DEFINER ~20 tests).

**LOC budget estimado**: migration ~80 LOC, schema delta ~10 LOC, test estructurales ~180 LOC, test DEFINER ~200 LOC. Total ≤ 470 LOC distribuido en 4 archivos (cada uno ≤300).

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/schema-headline-quota` verde (12/12).
- [ ] `pnpm test src/db/__tests__/update-my-headline` verde (8/8).
- [ ] `pnpm typecheck` clean (schema regenerated válido).
- [ ] Verificación psql: `\d+ membership` muestra columna `headline` + CHECK; `\d+ place` muestra `member_invite_quota` + CHECK.
- [ ] Header de la migration documenta reverse-SQL inline.
- [ ] `wc -l` cada archivo nuevo ≤300.

**Commit message format**:
```
feat(db): migration 0017 — membership.headline + place.member_invite_quota + app.update_my_headline DEFINER

- ALTER membership ADD COLUMN headline text NULL + CHECK length ≤ 280 (ADR-0036)
- ALTER place ADD COLUMN member_invite_quota int NOT NULL DEFAULT 0 + CHECK >= 0 (ADR-0037)
- CREATE OR REPLACE FUNCTION app.update_my_headline(text, text) SECURITY DEFINER
- 12 tests estructurales + 8 tests DEFINER verdes

Ref: ADR-0036 §1, ADR-0037 §1, spec.md §"Decisión operativa" (DEFINER for self-edit).
```

**Tag baseline esperado**: `baseline/feature-e-s1-done`.

---

### S2 — Migration 0018: `app.create_invitation` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que canaliza el INSERT en `invitation` con gate V1 hardcoded owner-only (ADR-0037 §4). Retorna `{ invitation_id, token }` para que el caller arme el link.

**Archivos esperados** (2):
- `src/db/migrations/0018_app_create_invitation.sql` (función `LANGUAGE plpgsql` + `SECURITY DEFINER` + `SET search_path = public, pg_temp` + REVOKE PUBLIC + GRANT `app_system`).
- `src/db/__tests__/create-invitation.test.ts` (10 tests TDD).

**Locked files** (NO modificar):
- Migration 0017 (cerrada en S1).
- Schema `src/db/schema/index.ts` (sin cambios — la función opera sobre tabla existente).
- ADRs 0035/0036/0037.

**Tests TDD**: ver `tests.md` §S2 (10 tests: happy, not authenticated, not owner V1, expires in past, expires now (boundary), member-not-owner DENIED V1, place not found, multi-owner caller OK any, token uniqueness, email format passthrough sin re-validación).

**LOC budget estimado**: migration ~70 LOC, test ~230 LOC. Total ≤ 300 LOC.

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/create-invitation` verde (10/10).
- [ ] `pnpm typecheck` clean.
- [ ] Verificación psql: `\df app.create_invitation` muestra `Security` = `definer`.
- [ ] Header migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0018 — app.create_invitation SECURITY DEFINER + 10 tests TDD

V1 gate hardcoded owner-only (ADR-0037 §4). Returns { invitation_id, token }.
V2+ abrirá gate a member-with-quota-available (forward-compat ADR-0037 §4-§5).
```

**Tag baseline esperado**: `baseline/feature-e-s2-done`.

---

### S3 — Migration 0019: `app.revoke_invitation` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que DELETE físico de invitación pending (capability deja de existir; token queda inválido inmediatamente). Bloquea cancelar invitaciones ya aceptadas.

**Archivos esperados** (2):
- `src/db/migrations/0019_app_revoke_invitation.sql`.
- `src/db/__tests__/revoke-invitation.test.ts` (8 tests TDD).

**Locked files** (NO modificar):
- Migrations 0017/0018.
- ADRs 0035/0036/0037.

**Tests TDD**: ver `tests.md` §S3 (8 tests: happy, not authenticated, invitation not found, not owner of place, already accepted, multi-owner any-owner OK, cross-place denied, expired invitation revoke OK — caso edge).

**LOC budget estimado**: migration ~60 LOC, test ~180 LOC. Total ≤ 240 LOC.

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/revoke-invitation` verde (8/8).
- [ ] `pnpm typecheck` clean.
- [ ] Verificación psql: `\df app.revoke_invitation` muestra `Security` = `definer`.
- [ ] Header migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0019 — app.revoke_invitation SECURITY DEFINER + 8 tests TDD

DELETE físico (capability deja de existir). Bloquea revoke de invitations
ya aceptadas (use remove_member en su lugar). Ref ADR-0010 §2 + spec §CU3.
```

**Tag baseline esperado**: `baseline/feature-e-s3-done`.

---

### S4 — Migration 0020: `app.remove_member` SECURITY DEFINER

**Objetivo único**: implementar la función DEFINER que soft-remove miembro (UPDATE `membership.left_at = now()`). Bloquea remove de owners (separation of concerns con `app.revoke_ownership` de Feature D). Bloquea self-remove V1.

**Archivos esperados** (2):
- `src/db/migrations/0020_app_remove_member.sql`.
- `src/db/__tests__/remove-member.test.ts` (10 tests TDD).

**Locked files** (NO modificar):
- Migrations 0017/0018/0019.
- ADRs 0035/0036/0037.

**Tests TDD**: ver `tests.md` §S4 (10 tests: happy, not authenticated, not owner of place, target is owner DENIED, target is founder DENIED, target = self DENIED, target not active member, target already left, multi-owner any-owner can remove non-owner, idempotent on re-call — caso edge si target ya left_at NOT NULL).

**LOC budget estimado**: migration ~70 LOC, test ~220 LOC. Total ≤ 290 LOC.

**Pre-commit checklist**:
- [ ] `pnpm test src/db/__tests__/remove-member` verde (10/10).
- [ ] `pnpm typecheck` clean.
- [ ] Verificación psql: `\df app.remove_member` muestra `Security` = `definer`.
- [ ] Header migration documenta reverse-SQL inline.

**Commit message format**:
```
feat(db): migration 0020 — app.remove_member SECURITY DEFINER + 10 tests TDD

Soft-remove (UPDATE membership.left_at). Bloquea remove de owners
(separation of concerns con app.revoke_ownership Feature D). No self-remove
V1 (use leave_place V1.1+). Ref spec §CU4.
```

**Tag baseline esperado**: `baseline/feature-e-s4-done`.

---

### S5 — Shared UI extracción (3 agentes paralelos)

**Objetivo único**: extraer/crear 3 componentes shared/ui que Feature E consume. Trabajo coordinable por **3 agentes paralelos** (archivos ortogonales: cada agente crea su componente + su test en su propio archivo; ninguno toca un archivo del otro). El agente principal NO escribe los archivos — sólo orquesta y valida output.

**Archivos esperados** (6):
- `src/shared/ui/confirm-dialog.tsx` + `confirm-dialog.test.tsx` (agente A — extraído del inline en `src/features/custom-domain/ui/domain-section-archive.tsx:109-165`).
- `src/shared/ui/context-menu.tsx` + `context-menu.test.tsx` (agente B — extraído del inline en `src/shared/ui/app-shell/app-shell-account-menu.tsx:80-115`).
- `src/shared/ui/badge.tsx` + `badge.test.tsx` (agente C — nuevo componente, 4 variants).

**Locked files** (NO modificar):
- Los 2 archivos fuente del inline original NO se refactoran en S5 (eso queda para una sesión futura de cleanup — V1 sólo extrae para consumo de Feature E, sin tocar consumers existentes). Esto evita riesgo de regresión en custom-domain + account-menu en una sesión que ya tiene 3 archivos nuevos.
- Migrations 0017-0020.
- ADRs.

**Tests TDD**: ver `tests.md` §S5 (RTL tests por componente — ~6 tests/componente).

**LOC budget estimado**: cada componente ≤120 LOC + test ≤80 LOC = ≤200 LOC × 3 = ≤600 LOC total. Cap shared/ui módulo ≤800 respetado.

**Pre-commit checklist**:
- [ ] `pnpm test src/shared/ui/confirm-dialog` verde.
- [ ] `pnpm test src/shared/ui/context-menu` verde.
- [ ] `pnpm test src/shared/ui/badge` verde.
- [ ] `pnpm typecheck` clean.
- [ ] `wc -l` cada archivo nuevo ≤300.
- [ ] `git diff --stat` muestra sólo los 6 archivos nuevos.

**Commit message format**:
```
feat(shared/ui): extract ConfirmDialog + ContextMenu + Badge (Feature E S5)

3 componentes shared/ui que Feature E consume:
- ConfirmDialog: extraído del inline custom-domain/ui/domain-section-archive.tsx
- ContextMenu: extraído del inline shared/ui/app-shell/app-shell-account-menu.tsx
- Badge: nuevo, 4 variants (owner|founder|pending|expired)

Consumers originales NO refactorados en esta sesión (evita scope creep).
```

**Tag baseline esperado**: `baseline/feature-e-s5-done`.

---

### S6 — Slice foundation: types + queries

**Objetivo único**: crear la estructura base del slice `src/features/members/` con tipos del dominio + queries server-side (`loadMembers`, `loadPendingInvitations`). Sin acciones, sin UI. Permite que S7-S11 importen tipos estables.

**Archivos esperados** (4-6):
- `src/features/members/types.ts` (~80 LOC — `Member`, `PendingInvitation`, `MemberRole`, `InviteError`, `RevokeInviteError`, `RemoveMemberError`, `HeadlineError`, `ElevateError`, `RevokeError`, `TransferError`).
- `src/features/members/queries/load-members.ts` (~100 LOC — RSC-callable query con JOIN `app_user` + LEFT JOIN `place_ownership` + comparación con `place.founder_user_id`).
- `src/features/members/queries/load-pending-invitations.ts` (~80 LOC).
- `src/features/members/queries/__tests__/load-members.test.ts` (~200 LOC — tests con `inRlsTx` harness).
- `src/features/members/queries/__tests__/load-pending-invitations.test.ts` (~150 LOC).
- `src/features/members/public.ts` (~30 LOC — re-export tipos + queries para futuras features consumers).

**Locked files** (NO modificar):
- Shared/ui (cerrada S5).
- Migrations (cerradas S1-S4).
- ADRs.

**Tests TDD**: ver `tests.md` §S6 (~12 tests queries con RLS-aware harness).

**LOC budget estimado**: total ≤640 LOC distribuido en 6 archivos. Feature slice cap ≤1500 LOC respetado (S6 es ~640; queda ~860 para S7-S11).

**Pre-commit checklist**:
- [ ] `pnpm test src/features/members/queries` verde.
- [ ] `pnpm typecheck` clean.
- [ ] `git grep -E "from '\.\./other-feature'" src/features/members/` empty (no cross-feature imports — only public.ts).
- [ ] `wc -l` cada archivo ≤300.

**Commit message format**:
```
feat(members): slice foundation — types + queries loadMembers + loadPendingInvitations (S6)

Sin Server Actions ni UI todavía — establece tipos estables para S7-S11.
Public.ts re-exporta tipos para futuras features consumers.
```

**Tag baseline esperado**: `baseline/feature-e-s6-done`.

---

### S7 — Server Actions invitations + updateMyHeadline wrapper

**Objetivo único**: 3 Server Actions de la capa invitations + headline. Cada action ≤80 LOC. Pattern canónico: `getAuthenticatedDbForRequest` (ADR-0034) + zod parse + invoke DEFINER + try/catch + map error + revalidatePath.

> **Re-baseline S7 (2026-05-25)**: estrategia de tests ajustada a **seam-split puro** por consistencia con canon vigente del codebase. Precedentes vivos `update-default-locale.ts:13`, `auth-actions.ts:8`, `loginAction`/`signUpAccountAction`/`logoutAction`/`createPlaceAction` documentan que Server Actions cruzan `next/headers` + Neon Auth + DB y se verifican por typecheck + smoke en producción, NO vitest. Lo testeable con vitest es la **lógica pura extraída** (precedentes: `_v6-helpers.ts`, `decideAuthBranch`, `access-flow.test.tsx`). Detectado mid-S7 al auditar harness existente; el plan original (vitest action mocks) habría inaugurado pattern nuevo y agregado deuda de mocks fragiles. Decisión confirmada por user vía AskUserQuestion turno S7. Reaplica al planeo de S8 (mismo split).

**Archivos esperados** (7):
- `src/features/members/actions/_lib/schemas.ts` (~60 LOC — 3 zod schemas exportados puros).
- `src/features/members/actions/_lib/map-invite-error.ts` (~40 LOC — regex sobre error message → tag `InviteError`).
- `src/features/members/actions/_lib/map-revoke-error.ts` (~35 LOC — regex sobre error message → tag `RevokeInviteError`).
- `src/features/members/actions/_lib/map-headline-error.ts` (~30 LOC — regex sobre error message → tag `HeadlineError`).
- `src/features/members/actions/_lib/__tests__/map-invite-error.test.ts` (~80 LOC).
- `src/features/members/actions/_lib/__tests__/map-revoke-error.test.ts` (~60 LOC).
- `src/features/members/actions/_lib/__tests__/map-headline-error.test.ts` (~60 LOC).
- `src/features/members/actions/_lib/__tests__/schemas.test.ts` (~70 LOC).
- `src/features/members/actions/create-invitation.ts` (~60 LOC — wiring delgado sobre `_lib/`).
- `src/features/members/actions/revoke-invitation.ts` (~45 LOC).
- `src/features/members/actions/update-my-headline.ts` (~50 LOC).

**Locked files** (NO modificar):
- Tipos `src/features/members/types.ts` (cerrado S6 — si requiere ampliación, revisar antes).
- Queries (cerradas S6).
- Shared/ui (cerrada S5).
- Migrations.

**Tests TDD**: ver `tests.md` §S7 (re-baseline seam-split: ~20 vitest puros sobre `_lib/`; actions verificadas por typecheck + smoke S12).

**LOC budget re-baseline**: ≤500 LOC en 11 archivos (3 actions delgadas + 4 modules `_lib/` + 4 test files puros).

**Pre-commit checklist**:
- [ ] `pnpm test src/features/members/actions` verde (cubre `_lib/` puro).
- [ ] `pnpm typecheck` clean (verifica wiring de actions).
- [ ] Cada action usa `getAuthenticatedDbForRequest` (grep guard).
- [ ] Cada action usa zod (vía import `_lib/schemas`, grep guard).
- [ ] Cada action invoca `revalidatePath` post-success (grep guard).

**Commit message format**:
```
feat(members): Server Actions invitations + headline (S7)

- createInvitationAction (zod email+expiresInDays, wraps app.create_invitation)
- revokeInvitationAction (zod invitationId, wraps app.revoke_invitation)
- updateMyHeadlineAction (zod headline max 280, wraps app.update_my_headline)

Pattern canónico: getAuthenticatedDbForRequest + zod + DEFINER + revalidatePath.
```

**Tag baseline esperado**: `baseline/feature-e-s7-done`.

---

### S8 — Server Actions member mgmt + ownership wrappers

**Objetivo único**: 4 Server Actions wrappers (removeMember + 3 sobre Feature D DEFINERs ya existentes — elevate/revoke/transfer). Mismo pattern que S7.

> **Re-baseline S8 (2026-05-25)**: estrategia de tests = **seam-split puro** (extiende canon S7 re-baseline). Las 4 actions cruzan `next/headers` + Neon Auth + DB → NO vitest (precedentes S7 + `update-default-locale` + `auth-actions`). Lo testeable con vitest es la lógica pura extraída a `_lib/`: 4 schemas zod nuevos (extendiendo `_lib/schemas.ts` ya existente) + 4 nuevos `_lib/map-<X>-error.ts` modules (espejos de S7 `map-invite-error.ts` / `map-revoke-error.ts` / `map-headline-error.ts`). Actions verificadas por typecheck + smoke S12. Reaplica la nota de re-baseline S7 §plan-sesiones a esta sesión por consistencia.

**Archivos esperados** (13):
- `src/features/members/actions/_lib/schemas.ts` (EDIT: +4 schemas `removeMemberSchema` / `elevateToOwnerSchema` / `revokeOwnershipSchema` / `transferFounderOwnershipSchema` — todos `{placeId, targetUserId}` — +4 `…Input` tipos exportados).
- `src/features/members/actions/_lib/map-remove-member-error.ts` (~50 LOC — regex sobre error message + SQLSTATE → tag `RemoveMemberError`).
- `src/features/members/actions/_lib/map-elevate-error.ts` (~50 LOC — regex + SQLSTATE → `ElevateError`).
- `src/features/members/actions/_lib/map-revoke-ownership-error.ts` (~55 LOC — regex + SQLSTATE → `RevokeError`; cubre last_owner + cannot_revoke_founder + cannot_self_revoke + target_not_owner).
- `src/features/members/actions/_lib/map-transfer-error.ts` (~50 LOC — regex + SQLSTATE → `TransferError`; cubre not_founder + cannot_transfer_to_self + target_not_owner + place_not_found).
- `src/features/members/actions/_lib/__tests__/schemas.test.ts` (EDIT: +4 describe blocks happy + edge para los 4 nuevos schemas).
- `src/features/members/actions/_lib/__tests__/map-remove-member-error.test.ts` (~60 LOC, 6 casos).
- `src/features/members/actions/_lib/__tests__/map-elevate-error.test.ts` (~55 LOC, 6 casos).
- `src/features/members/actions/_lib/__tests__/map-revoke-ownership-error.test.ts` (~60 LOC, 7 casos).
- `src/features/members/actions/_lib/__tests__/map-transfer-error.test.ts` (~55 LOC, 6 casos).
- `src/features/members/actions/remove-member.ts` (~55 LOC — wiring delgado wraps `app.remove_member`).
- `src/features/members/actions/elevate-to-owner.ts` (~45 LOC — wraps Feature D `app.elevate_to_owner`).
- `src/features/members/actions/revoke-ownership.ts` (~45 LOC — wraps Feature D `app.revoke_ownership`).
- `src/features/members/actions/transfer-founder-ownership.ts` (~45 LOC — wraps Feature D `app.transfer_founder_ownership`).
- `src/features/members/public.ts` (EDIT: +4 action exports + 4 Result types + 4 Input types).

**Locked files** (NO modificar):
- Actions de S7 (cerradas — sólo extensión de `_lib/schemas.ts` que ES file compartido).
- Migrations Feature D (las 4 DEFINERs ya cerradas; sólo wraps).
- Migration 0020 (cerrada S4).
- `types.ts` (cerrado S6 — `RemoveMemberError` / `ElevateError` / `RevokeError` / `TransferError` ya definidos).

**Tests TDD**: ver `tests.md` §S8 re-baseline (~25 vitest puros sobre `_lib/`; actions verificadas por typecheck + smoke S12).

**LOC budget re-baseline**: ≤640 LOC en 14 archivos (4 actions delgadas + 4 map-error modules + schemas ext + 4 test files puros + public.ts edit). Feature slice acumulado S6-S8: **proyectado ~2168 LOC — excede cap 1500**. **Acción upfront**: documentar al cierre S8 que el cap se excede; decisión de split (`src/features/place-ownership-actions/` — originalmente nombrado `members-ownership/` en S10.5, renombrado en S10.6 por ADR-0040 a su nombre canónico capability-named — para los 3 wrappers Feature D + sus tests, dejando members core con queries + invitations + headline + remove-member) se tomará después de S10 cuando UI determine el footprint real (S9-S10 agregan otros ~1500 LOC de UI). Lock en S8: NO bloquear S9 por LOC cap — el split se documenta y se ejecuta como sesión-X bisagra entre S10 y S11 si LOC final lo confirma.

**Pre-commit checklist**:
- [ ] `pnpm test src/features/members/actions/_lib` verde (cubre 4 nuevos map-error + schemas extension).
- [ ] `pnpm typecheck` clean (verifica wiring 4 actions + public.ts re-exports).
- [ ] Cada action usa `getAuthenticatedDbForRequest` (grep guard).
- [ ] Cada action usa zod (vía import de `_lib/schemas`, grep guard).
- [ ] Cada action invoca `revalidatePath(`/${placeSlug}/settings/members`)` post-success (grep guard).
- [ ] `wc -l` cada archivo nuevo ≤300; función ≤60.
- [ ] LOC slice total documentado al final del commit message (`find src/features/members -name '*.ts' -o -name '*.tsx' | xargs wc -l`).

**Commit message format**:
```
feat(members): Server Actions member mgmt + ownership wrappers (S8)

- removeMemberAction (wraps app.remove_member migration 0020)
- elevateToOwnerAction (wraps Feature D app.elevate_to_owner)
- revokeOwnershipAction (wraps Feature D app.revoke_ownership)
- transferFounderOwnershipAction (wraps Feature D app.transfer_founder_ownership)

Pattern canónico (seam-split S7 re-baseline): getAuthenticatedDbForRequest +
zod (extendido en _lib/schemas) + DEFINER + map-<X>-error + revalidatePath.
4 nuevos vitest puros sobre _lib/ + ext schemas.test.ts. Actions verificadas
por typecheck + smoke S12.

LOC slice total: <NNNN> (excede cap 1500 — decisión de split aplazada a
post-S10, ver plan-sesiones §S8 nota LOC).
```

**Tag baseline esperado**: `baseline/feature-e-s8-done`.

---

### S9 — UI invite modal + pending tab

**Objetivo único**: 2 componentes UI principales del flujo de invitaciones. Consume actions de S7 + shared/ui de S5.

**Archivos esperados** (4-6):
- `src/features/members/ui/invite-member-modal.tsx` (~150 LOC — form email + expiresInDays + submit + clipboard copy + toast).
- `src/features/members/ui/pending-invitations-tab.tsx` (~120 LOC — lista + revoke con `<ConfirmDialog>`).
- `src/features/members/ui/__tests__/invite-member-modal.test.tsx` (~150 LOC — RTL).
- `src/features/members/ui/__tests__/pending-invitations-tab.test.tsx` (~120 LOC — RTL).

**Locked files** (NO modificar):
- Actions/queries S6-S8.
- Shared/ui S5.
- i18n (se carga en S11 — usar strings hardcoded temporales en español + TODO comment para extraction).

**Tests TDD**: ver `tests.md` §S9.

**LOC budget estimado**: ≤540 LOC. **Recheck feature slice cap** al cierre S9.

**Pre-commit checklist**:
- [ ] `pnpm test src/features/members/ui/invite-member-modal` verde.
- [ ] `pnpm test src/features/members/ui/pending-invitations-tab` verde.
- [ ] `pnpm typecheck` clean.
- [ ] Lint clean.

**Commit message format**:
```
feat(members): UI invite modal + pending invitations tab (S9)

- <InviteMemberModal />: form + submit + clipboard copy + toast
- <PendingInvitationsTab />: list + revoke confirm via shared <ConfirmDialog>

i18n strings hardcoded temp ES — extraction a S11.
```

**Tag baseline esperado**: `baseline/feature-e-s9-done`.

---

### S10 — UI members list + actions menu + headline editor

**Objetivo único**: 3 componentes UI del flujo de gestión de miembros + edit headline propio.

**Archivos esperados** (5-7):
- `src/features/members/ui/members-list.tsx` (~150 LOC — tabla/lista con avatar + handle + headline + badges).
- `src/features/members/ui/member-row-actions-menu.tsx` (~180 LOC — context menu condicional por rol caller × rol row).
- `src/features/members/ui/headline-editor.tsx` (~120 LOC — inline editor en perfil contextual; consume `updateMyHeadlineAction`).
- `src/features/members/ui/__tests__/members-list.test.tsx` (~150 LOC).
- `src/features/members/ui/__tests__/member-row-actions-menu.test.tsx` (~200 LOC — matriz role × role).
- `src/features/members/ui/__tests__/headline-editor.test.tsx` (~120 LOC).

**Locked files** (NO modificar):
- S9 UI components.
- Actions S7-S8.
- Shared/ui.

**Tests TDD**: ver `tests.md` §S10.

**LOC budget estimado**: ≤920 LOC. **CHECK feature slice cap** al cierre S10 — si excede 1500, ejecutar Plan B split (`place-ownership-actions/` slice separado — nombre post-S10.6 ADR-0040; originalmente `members-ownership/` durante S10.5).

**Pre-commit checklist**:
- [ ] `pnpm test src/features/members/ui/members-list` verde.
- [ ] `pnpm test src/features/members/ui/member-row-actions-menu` verde.
- [ ] `pnpm test src/features/members/ui/headline-editor` verde.
- [ ] `pnpm typecheck` clean + `pnpm lint` clean.
- [ ] `find src/features/members -name '*.ts' -o -name '*.tsx' | xargs wc -l` total ≤1500 (decisión de split aplicada si excede).

**Commit message format**:
```
feat(members): UI members list + actions menu + headline editor (S10)

- <MembersList />: tabla con avatar + handle + headline + badges (rol)
- <MemberRowActionsMenu />: context menu condicional caller-role × row-role
- <HeadlineEditor />: inline editor self-only del headline

Closes UI components; S11 cablea page + sidebar + i18n.
```

**Tag baseline esperado**: `baseline/feature-e-s10-done`.

---

### S11 — Page + sidebar wiring + i18n ×6 locales

**Objetivo único**: cablear todo en la page final + habilitar sidebar item + extraer i18n strings de S9/S10 a las 6 locales operativas.

**Archivos esperados** (10-15):
- `src/app/[placeSlug]/(place)/settings/members/page.tsx` (~120 LOC — RSC que carga queries + renderiza UI).
- `src/features/nav-place/ui/nav-place-items.tsx` (edit línea 120 — flip `disabled: true → false` para item "members").
- `i18n/messages/es.json` (agrega bloque `placeMembers.*` ~40 keys).
- `i18n/messages/en.json` (mismo bloque traducido).
- `i18n/messages/fr.json`.
- `i18n/messages/pt.json`.
- `i18n/messages/de.json`.
- `i18n/messages/ca.json`.
- `src/features/members/ui/*.tsx` — extraer hardcoded strings a `t('placeMembers.xxx')` usando hook canónico del proyecto.
- (Opcional) `src/features/members/__tests__/i18n-keys.test.ts` — test que verifica que todas las claves usadas existen en `es.json` (defense contra typos).

**Locked files** (NO modificar):
- Schema migrations.
- Shared/ui.

**Tests TDD**: ver `tests.md` §S11 (i18n parity check + page render test).

**LOC budget estimado**: page + nav edit ≤140 LOC; cada locale ~40 keys ~80 LOC × 6 = ~480 LOC. Total ≤620 LOC.

**Pre-commit checklist**:
- [ ] `pnpm test` total verde (incluye nuevos tests + regression de toda la suite).
- [ ] `pnpm typecheck` clean + `pnpm lint` clean.
- [ ] `node scripts/check-translations.mjs` parity check sin warnings críticos (ADR-0024 — script informativo, pero no debe reportar drift de keys agregadas en S11).
- [ ] `grep -r "TODO.*i18n" src/features/members/` empty (todos los TODOs de S9/S10 resueltos).
- [ ] `pnpm build` exitoso (Next 16 production build).
- [ ] Smoke local manual: arrancar `pnpm dev` y navegar `/settings/members` — verificar sidebar item activo, page renderiza, modal abre.

**Commit message format**:
```
feat(members): page + sidebar + i18n ×6 locales (S11)

- /settings/members RSC carga loadMembers + loadPendingInvitations
- nav-place-items: flip members item disabled:true → false
- i18n: 40 keys × 6 locales (es/en/fr/pt/de/ca)

Slice members V1 wired end-to-end. S12 = smoke E2E + push autorizado.
```

**Tag baseline esperado**: `baseline/feature-e-s11-done`.

---

### S12 — Smoke E2E + write-back + push autorizado por turno

**Objetivo único**: validar end-to-end Feature E contra Neon test branch + browser real (los 11 steps del `spec.md` §"Smoke verification"). Write-back de plan-sesiones con SHAs reales. Push final autorizado explícito turno-por-turno por el user.

**Archivos esperados** (3-5):
- `docs/features/members/plan-sesiones.md` — write-back de SHAs reales S1-S11 en §Status (este archivo).
- `docs/features/members/spec.md` — sección "Smoke verification" actualizada con resultados real (steps 1-11 con ✓/✗ + observaciones).
- (Opcional) `docs/gotchas/<slug>.md` si el smoke descubre un gotcha que valga documentar — criterio CLAUDE.md §"Gotchas" (no derivable del código + síntoma confuso + volvería a morder).

**Locked files** (NO modificar):
- TODO el código (S1-S11 cerrados — S12 sólo toca docs).
- ADRs.

**Tests TDD**: ver `tests.md` §S12 (smoke manual + gating push).

**LOC budget estimado**: write-backs ≤80 LOC; gotcha (si aparece) ~40 LOC. Total ≤120 LOC.

**Pre-commit checklist (pre-push)**:
- [ ] Smoke E2E manual ejecutado y logueado: los 11 steps del `spec.md` §"Smoke verification" pasan.
- [ ] i18n smoke (step 11): cambiar locale a `en` y verificar render completo traducido.
- [ ] `pnpm typecheck` clean.
- [ ] `pnpm lint` clean.
- [ ] `pnpm test` verde (suite total — baseline + Feature E tests).
- [ ] `pnpm build` exitoso.
- [ ] `git diff baseline/feature-e-s11-done -- src/` empty (S12 sólo toca docs).
- [ ] Push autorizado **explícitamente** por el user en el turno de S12 (memoria operacional: nunca push sin autorización turno-a-turno).

**Commit message format**:
```
docs: cierre Feature E V1 — smoke E2E verde + write-back plan-sesiones

- Smoke ejecutado contra Neon test branch + browser real: 11 steps verdes.
- Plan-sesiones write-back con SHAs S1-S11 reales.
- Spec.md §"Smoke ejecutado" actualizada con resultados.

Ref: ADR-0036 + ADR-0037 (V1 cerrada end-to-end).
```

**Tag baseline esperado**: `baseline/feature-e-s12-done` (= V1 cerrada).

---

## Mecanismo de rollback

Rollback granular por sesión vía tags `baseline/feature-e-s<N>-done` + rollback total al punto absoluto pre-Feature-E vía `baseline/pre-feature-e` (commit `ff1d18c`, HEAD post Feature D V1 cerrada).

```bash
# Rollback total (estado pre-Feature-E, equivalente a Feature D V1 cerrada):
git reset --hard baseline/pre-feature-e

# Rollback granular S<N>:
git reset --hard baseline/feature-e-s<N-1>-done

# Ejemplos concretos:
#   - Tras S3 detecta bug: rollback a baseline/feature-e-s2-done.
#   - Tras S8 LOC cap excedido: rollback a baseline/feature-e-s7-done + ejecutar Plan B split.
#   - Tras S12 smoke fail: rollback a baseline/feature-e-s11-done + debugging.
```

**Pre-condición rollback con migration aplicada en Neon branch**: si las migrations 0017-0020 ya se aplicaron a la branch Neon afectada, el reverse-SQL manual es necesario antes del próximo deploy (Drizzle journal no soporta `down` automático). Cada migration documenta su reverse inline en el header.

**Push reversal**: si el push de S12 ya ocurrió pero smoke production detecta regression, rollback = `git revert <commit-sha>` + nuevo push (NO `git reset` en remote main). Decisión por turno con user.

## Reverse SQL manual por migration (esqueleto)

Cada migration documenta inline en su header el reverse-SQL exacto. Esqueleto canónico:

```sql
-- 0017 reverse (S1):
--   REVOKE EXECUTE + DROP FUNCTION app.update_my_headline(text, text);
--   ALTER TABLE place DROP CONSTRAINT place_member_invite_quota_nonneg_chk;
--   ALTER TABLE place DROP COLUMN member_invite_quota;
--   ALTER TABLE membership DROP CONSTRAINT membership_headline_length_chk;
--   ALTER TABLE membership DROP COLUMN headline;
-- 0018 reverse (S2): REVOKE EXECUTE + DROP FUNCTION app.create_invitation(text, text, timestamptz).
-- 0019 reverse (S3): REVOKE EXECUTE + DROP FUNCTION app.revoke_invitation(text).
-- 0020 reverse (S4): REVOKE EXECUTE + DROP FUNCTION app.remove_member(text, text).
```

Cada sesión que aplique su migration tiene la responsabilidad de validar que el reverse del header efectivamente revierte limpio antes de tag baseline.

## Decisiones operacionales canónicas (canon de Feature E, no modificable durante implementación)

Para que ninguna sesión re-decida estos puntos por su cuenta:

- **Wrappers TS sobre Feature D DEFINERs viven en `src/features/place-ownership-actions/`** (slice hermano, NO en `members/actions/` ni en `place-ownership/`). Evolución de la decisión:
  - **Original (pre-S10.5)**: ir en `src/features/members/actions/` (no en `place-ownership/` porque Feature D cerró sin UI y sin actions; Feature E es el UI consumer de esas primitives — sin re-arquitectura).
  - **Plan B (S10.5)**: extracción a slice hermano `members-ownership/` por LOC cap del slice `members/` (proyección S6-S10 superó 1500 LOC — CLAUDE.md §"Límites de tamaño").
  - **Rename (S10.6, ADR-0040)**: `members-ownership/` → `place-ownership-actions/`. Razón: el nombre original mapeaba la relación consumer ("ownership consumida por members/ui/") en lugar de la capability ("acciones que mutan place_ownership"). El nombre canónico capability-named hace explícita la dependencia hacia el slot del schema (no hacia el consumer UI). Cross-slice import único: `members/ui/{members-list,member-row-actions-menu}` → `@/features/place-ownership-actions/public`. La cohesión por capability + cap LOC + reversibilidad estructural se mantienen — sólo cambia el nombre.
- **`updateMyHeadlineAction` invoca DEFINER `app.update_my_headline`**, no UPDATE directo (decisión §"Decisión operativa" de spec.md — column-level isolation via DEFINER es más seguro que policy + scope app-side).
- **Capability-based link copy** (NO email sending V1) por canon ADR-0010 §2 — el owner copia el link del modal post-create y lo manda manualmente.
- **Place archived es operable** (invitations + member-remove permitidos sobre archived places) — canon §"Decisión operativa" spec.md, idéntica a Feature D §"Decisión operativa".
- **Sidebar item "members" se habilita en S11, no antes** — evita que sidebar ofrezca link a página vacía durante S1-S10.

## Pointers

- **ADRs canónicas V1**:
  - [`../../decisions/0036-member-bio-contextual.md`](../../decisions/0036-member-bio-contextual.md).
  - [`../../decisions/0037-member-invite-quota.md`](../../decisions/0037-member-invite-quota.md).
- **Primitive consumida (Feature D, cerrada)**: [`../place-ownership/spec.md`](../place-ownership/spec.md) + [`../../decisions/0035-place-ownership-multi-owner-v1.md`](../../decisions/0035-place-ownership-multi-owner-v1.md).
- **Spec del feature**: [`./spec.md`](./spec.md).
- **Tests TDD checklist**: [`./tests.md`](./tests.md).
- **Save point absoluto pre-Feature-E**: tag `baseline/pre-feature-e` = commit `ff1d18c`.
- **Save point setup (S-1 cerrado)**: tag `baseline/feature-e-setup-done` = commit `54c865a`.
- **Precedente plan ejecutado (referencia)**: [`../place-ownership/plan-sesiones.md`](../place-ownership/plan-sesiones.md) — Feature D 6 sesiones cerradas.
- **Precedente migration SECURITY DEFINER**: `src/db/migrations/0014_app_elevate_to_owner.sql` (Feature D S2).
- **Patrón zone-aware actions**: ADR-0034 + `src/shared/lib/db-for-request.ts`.
- **Patrón harness RLS tests**: `src/db/__tests__/db-test-pool.ts` (`inRlsTx`).
