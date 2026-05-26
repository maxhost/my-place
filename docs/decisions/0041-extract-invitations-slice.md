# ADR-0041 — Extraer slice `invitations/` desde `members/` (capability-named)

**Fecha**: 2026-05-25
**Estado**: Adoptada
**Contexto inmediato**: Feature E (members slice V1) — sesión S10.7 (refactor slice diet, 2ª de la sequence S10.6-S10.9 que escinde el slice `members/` en capabilities cohesivas). Primer split sustancial post-rename ADR-0040.

## Contexto

Tras S10.6 (rename `members-ownership/` → `place-ownership-actions/`), el slice `members/` aún acumulaba **3765 LOC** — 2.5× el cap heurístico ≤1500 (CLAUDE.md §"Límites de tamaño"). El cap es heurístico pero su violación obliga a "dividir antes de continuar". La proyección S10-S12 (page + i18n) sólo iba a empujar más LOC al slice, no a aliviarlos.

El análisis de cohesión del contenido detectó **3 capabilities autónomas** dentro de `members/`:

1. **Membership core**: `Member`, `MemberRole`, `loadMembers`, `removeMemberAction`, `<MembersList />`, `<MemberRowActionsMenu />` — el slot `membership` (filas activas en el place).
2. **Invitations**: `PendingInvitation`, `createInvitationAction`, `revokeInvitationAction`, `loadPendingInvitations`, `<InviteMemberModal />`, `<PendingInvitationsTab />` — el slot `invitation` (migrations 0018-0019), flujo asincrónico owner→invitee.
3. **Member profile/headline**: `updateMyHeadlineAction`, `<HeadlineEditor />`, `HeadlineError` — auto-edición de bio contextual self-only (ADR-0036).

Las 3 capabilities tienen consumers distintos en el page S11:
- Membership core ⇒ tab "Miembros activos".
- Invitations ⇒ tab "Pendientes" + modal trigger.
- Profile/headline ⇒ probable sección "Tu perfil en este place".

S10.7 ejecuta la **primera extracción**: invitations. Es el split más independiente (slot DB exclusivo, 2 DEFINER consumidas que NO toca el resto del slice, 0 cross-imports actuales fuera de `members/` mismo) y el más voluminoso (~1366 LOC de file-moves antes de extracción de tipos/schemas). S10.8 hará lo mismo con member-profile/headline (M); S10.9 refactoriza el `member-row-actions-menu` a page-level con render-prop (M, no extracción).

El nombre canónico **`invitations/`** sigue la regla establecida en ADR-0040: capability-named (mapea **qué hace el slice**), no consumer-relationship-named. El slot DB `invitation` es la SoT física; el slice es su superficie de aplicación.

## Decisión

Extraer las 12 unidades del flujo invitations a `src/features/invitations/`. División por categoría:

**`git mv` puro** (12 files, history preservada per-file):
- `actions/{create,revoke}-invitation.ts` — 2 Server Actions wrappers.
- `actions/_lib/{map-invite-error,map-revoke-error}.ts` — 2 maps puros.
- `actions/_lib/__tests__/{map-invite-error,map-revoke-error}.test.ts` — 2 test puros.
- `queries/load-pending-invitations.ts` — 1 query foundation.
- `queries/__tests__/load-pending-invitations.test.ts` — RLS integration test.
- `ui/{invite-member-modal,pending-invitations-tab}.tsx` — 2 Client Components.
- `ui/__tests__/{invite-member-modal,pending-invitations-tab}.test.tsx` — 2 RTL tests.

**Split-edit** (3 files contienen contenido invitations + contenido restante):
- `members/types.ts` ⇒ extraer `PendingInvitation`, `InviteError`, `RevokeInviteError` a nuevo `invitations/types.ts`.
- `members/actions/_lib/schemas.ts` ⇒ extraer `createInvitationSchema` + `revokeInvitationSchema` (+ Input types) a nuevo `invitations/actions/_lib/schemas.ts`.
- `members/actions/_lib/__tests__/schemas.test.ts` ⇒ extraer los 2 `describe` correspondientes a nuevo test file en invitations/.

**Edit barrel** (1 file): `members/public.ts` — remover 5 re-exports invitations.

**Crear** (1 file): `invitations/public.ts` (barrel del nuevo slice).

**Cross-slice imports actualizados**: NINGUNO. Verificación previa: 0 consumers externos de los símbolos extraídos (todo era intra-`members/`). El primer cross-slice consumer real será el page S11 (page nuevo, va a importar desde `@/features/invitations/public` desde el día uno).

**Cleanup post-extract**: tras el move el slice quedó en 1615 LOC (sobre cap por 115). Trim de doc-headers redundantes (history S6/S7 que perdió contexto post-extract, framing general duplicado del slice padre) bajó a **1497 LOC** — bajo cap. El trim es semánticamente neutro: ningún canon-decision queda no-documentado, sólo se eliminó verbosity redundante.

## Alternativas rechazadas

### Status quo (mantener todo en `members/`)

**Rechazada porque**: el slice estaba en 3765 LOC (2.5× cap) y la proyección S10-S12 iba a sumar más. CLAUDE.md §"Límites de tamaño" obliga a dividir; mantener era violación directa del principio. El argumento "todo es members" colapsa cuando hay 3 capabilities con consumers distintos en el page S11 — tener 3 features en 1 slice rompe la lectura del paradigma vertical (architecture.md §17-25).

### Subfolder `members/invitations/*` sin barrel propio

**Rechazada porque**: 
1. Viola el paradigma (vertical-slice = barrel `public.ts` propio; subfolder no tiene boundaries enforceables por la regla ESLint ADR-0039).
2. No descomprime LOC del slice padre — el cap se mide por feature, no por carpeta.
3. Hace ambigua la ownership de bugs/changes: una PR que edita `members/invitations/*` ¿es scope members o scope invitations?
4. El "single-team owns members" se mantiene aunque sean 2 slices — ownership es organizational, no estructural.

### `members-invitations/` (consumer-relationship-named)

**Rechazada porque**: idéntica anti-pattern que ADR-0040 corrigió en `members-ownership/` → `place-ownership-actions/`. Mapea relación con `members/` en lugar de capability propia. El slice debe poder existir aunque desaparezca `members/` (e.g. invitations consumibles en futuro por nav-place badge "N pendientes" o por una landing dedicada de onboarding). El nombre canónico debe ser capability-only.

### `invitation/` (singular) o `place-invitations/` (con prefijo)

**Rechazada porque**:
- `invitation/` singular rompe convención del codebase (los slices son plural por capability — `members`, `places`, `custom-domain`).
- `place-invitations/` agrega prefijo innecesario: las invitations sólo existen en contexto de un place (no hay sistema de invitations cross-place). El prefijo `place-` que usamos en `place-ownership-actions/` desambigua de "user ownership" o "account ownership"; acá no hay confusión porque "invitations" sin contexto ya es claro en este dominio.

## Consecuencias

### Adoptadas

- **Going-forward**: cualquier consumer del flujo invitations importa desde `@/features/invitations/public`. El page S11 ensamblará `<MembersList />` (slice `members/`) + `<PendingInvitationsTab />` + `<InviteMemberModal />` (slice `invitations/`) en la misma vista.
- **ADR-0028 § "Política a futuro" cumplida**: el slice satisface los 3 criterios para promoción a slice propio:
  1. Cap LOC heurístico: extracción mantiene `invitations/` bajo 1500 y baja `members/` ~37%.
  2. ADR/spec/migration propias: las migrations 0018-0019 (DEFINERs `create_invitation` + `revoke_invitation`) son la SoT exclusiva del slot + cubiertas por specs en `docs/features/members/spec.md` §CU2/§CU3.
  3. Consumers cross-slice futuros: el page S11 es el primero; nav-place badge "N pendientes" (V1.1+) es plausible 2º consumer.
- **Members slice diet progresa**: 3765 → 2237 LOC. Aún sobre cap por 737 LOC; S10.8 (extract member-profile/headline ~458 LOC) + S10.9 (refactor member-row-actions-menu a page-level) deberían cerrar el gap.

### Forward-compat

- **S10.8** (extract member-profile/headline) heredará el patrón capability-named establecido en S10.5/S10.6/S10.7. ADR-0042 documentará la 3ª extracción.
- **Page S11** importará de los 3 slices: `members/`, `invitations/`, `place-ownership-actions/` (y eventualmente `member-profile/` post-S10.8). Cada uno con su barrel `public.ts` — sin deep-imports.
- **Doc-comments anchor**: `members/types.ts`, `members/public.ts`, `members/actions/_lib/schemas.ts` tienen pointers actualizados a `invitations/` — grep por `invitations/` recupera todos los anchors.

### No-impacto

- **Tests**: el split fue puramente nominal/estructural. Suite 102/102 archivos verde post-extracción (1 file extra vs S10.6 = nuevo `invitations/actions/_lib/__tests__/schemas.test.ts`; total tests 930/930 sin cambio).
- **Build**: el rename no requiere migration de runtime ni de DB.
- **History per-file**: `git mv` preserva blame/history línea-por-línea de los 12 files movidos. Los 4 files split-edit (3 originales + tests) son creates desde la perspectiva git porque la similitud post-split cae bajo el threshold default 50%.

### Excepción inmutabilidad ADR

- **ADR-0040** menciona `members-ownership/` en su nombre original y trace de la decisión — **NO se edita** (regla inmutabilidad). Coherente con momento histórico: cuando 0040 se escribió, este split aún no existía.

## Verificación

Post-split, los siguientes comandos deben pasar verdes:

- `pnpm lint` — clean (regla ADR-0039 valida 0 deep-imports cross-slice; los cross-slice futuros en S11 irán a `/public`).
- `pnpm typecheck` — clean (paths absolutos `@/features/invitations/public` resuelven al nuevo barrel; paths relativos intra-slice intactos post-`git mv`).
- `pnpm test` — clean: 102/102 files · 930/930 tests verde.
- `git status` — confirma R (rename) en 12 files + M en 3 split-edit + creates en 4 new files (types.ts + 2 schemas + public.ts del nuevo slice).
- `find src/features/invitations -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total ≤1500.
- `find src/features/members -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total < 3765 (cap aún excedido pendiente S10.8/S10.9; verificación de progreso).

## Referencias

- ADR-0028 (Custom Domain slice promotion) — política de promoción a slice propio (cap LOC + ADR/spec propia + consumers futuros)
- ADR-0039 (eslint slice boundaries enforcement) — regla que valida cross-slice imports via `/public`
- ADR-0040 (rename place-ownership-actions) — establece convención capability-named
- ADR-0010 (errores discriminables) — política anti-info-leak que los maps `_lib/` honran
- `docs/features/members/spec.md` §CU2/§CU3 — casos de uso V1 (capability-based link, revoke)
- `docs/features/members/plan-sesiones.md` §S10 + §Decisiones operacionales — write-back canónico
- `src/db/migrations/0018_app_create_invitation.sql` + `0019_app_revoke_invitation.sql` — DEFINERs SoT del slot
- `src/features/invitations/public.ts` — barrel canónico del slice
