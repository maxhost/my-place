# ADR-0042 — Extraer slice `member-profile/` desde `members/` (capability-named)

**Fecha**: 2026-05-25
**Estado**: Adoptada
**Contexto inmediato**: Feature E (members slice V1) — sesión S10.8 (refactor slice diet, 3ª de la sequence S10.6-S10.9 que escinde el slice `members/` en capabilities cohesivas). Continuación de ADR-0040 (rename `place-ownership-actions/`) y ADR-0041 (extract `invitations/`).

## Contexto

Tras S10.7 (extract `invitations/`, ADR-0041), `members/` quedó en **2237 LOC** — 49% sobre el cap heurístico ≤1500 (CLAUDE.md §"Límites de tamaño"). La proyección S10.9-S12 (page + i18n) sólo iba a sumar más, no a aliviar.

El análisis de cohesión de lo que quedó en `members/` detectó **2 capabilities ortogonales**:

1. **Membership core**: `Member`, `MemberRole`, `loadMembers`, `removeMemberAction`, `<MembersList />`, `<MemberRowActionsMenu />` — el slot `membership` (filas activas en el place, roster + gestión).
2. **Member profile**: `updateMyHeadlineAction`, `<HeadlineEditor />`, `HeadlineError`, `updateMyHeadlineSchema` — el perfil contextual del miembro en este place (self-edit only, ADR-0036 §3).

Las dos capabilities tienen consumers + scope distintos en el page S11:
- Membership core ⇒ tab "Miembros activos" + acciones administrativas owner→target.
- Member profile ⇒ sección "Tu perfil en este place" + ruta de auto-edición (V1 montada donde el usuario tappea su propio avatar, decisión spec §"UI screens" S10).

Además, las superficies de mutación están en lados opuestos del modelo de permisos:
- `removeMemberAction` requiere `caller is_owner == true && target != caller`.
- `updateMyHeadlineAction` requiere `caller is_member && target == caller` (DEFINER NO acepta `p_target_user_id`).

Esa **asimetría owner→target vs caller==target** es señal de que son dos capabilities distintas montadas accidentalmente en el mismo slice por compartir el modelo de datos `membership` — no por compartir capability.

S10.8 ejecuta la **tercera extracción**: member-profile. Es split independiente (1 DEFINER consumida exclusiva, 0 cross-imports actuales fuera de `members/` mismo) y de tamaño moderado (~458 LOC en file-moves + ~30 LOC en split-edits).

S10.9 cerrará el slice diet refactorizando `member-row-actions-menu` a page-level con render-prop (no es extracción — es restructuring del cómo se monta).

El nombre canónico **`member-profile/`** sigue la regla establecida en ADR-0040: capability-named (mapea **qué hace el slice**: gestiona el perfil contextual del miembro), no consumer-relationship-named ni schema-named (no `member-headline/`, que sería data-shape-named y se vuelve incoherente cuando V1.1+ agregue avatar).

## Decisión

Extraer las 5 unidades del flujo member-profile/headline a `src/features/member-profile/`. División por categoría:

**`git mv` puro** (5 files, history preservada per-file):
- `actions/update-my-headline.ts` — Server Action wrapper sobre `app.update_my_headline`.
- `actions/_lib/map-headline-error.ts` — map puro DEFINER→tag.
- `actions/_lib/__tests__/map-headline-error.test.ts` — tests puros del map.
- `ui/headline-editor.tsx` — Client Component editor inline.
- `ui/__tests__/headline-editor.test.tsx` — RTL tests del editor.

**Split-edit** (3 files contienen contenido member-profile + contenido restante):
- `members/types.ts` ⇒ extraer `HeadlineError` a nuevo `member-profile/types.ts`.
- `members/actions/_lib/schemas.ts` ⇒ extraer `updateMyHeadlineSchema` + `UpdateMyHeadlineInput` a nuevo `member-profile/actions/_lib/schemas.ts`.
- `members/actions/_lib/__tests__/schemas.test.ts` ⇒ extraer el describe block correspondiente a nuevo test file en member-profile/.

**Edit barrel** (1 file): `members/public.ts` — remover 4 re-exports member-profile (action + 2 types + Input + 1 UI + Labels).

**Crear** (1 file): `member-profile/public.ts` (barrel del nuevo slice).

**Cross-slice imports actualizados**: NINGUNO. Verificación previa: 0 consumers externos de los símbolos extraídos (todo era intra-`members/`, y `members/ui/{members-list,member-row-actions-menu}` no consumían `<HeadlineEditor />` ni `HeadlineError` — el editor se monta standalone). El primer cross-slice consumer real será el page S11 (importará desde `@/features/member-profile/public`).

## Alternativas rechazadas

### Status quo (mantener todo en `members/`)

**Rechazada porque**: el slice estaba en 2237 LOC (49% sobre cap) y la proyección S11+ iba a sumar más. CLAUDE.md §"Límites de tamaño" obliga a dividir. Además, la asimetría de permisos (owner→target vs caller==target) no es accidental — son capabilities ortogonales que compartían slice por coincidencia de tabla DB. Mantenerlas juntas mezclaba dos modelos de autorización en una sola superficie pública.

### Extraer `member-profile/` PERO incluir también `<MembersList />` (toda la UI del miembro)

**Rechazada porque**: `<MembersList />` muestra el roster de TODOS los miembros del place (capability membership/listado), no el perfil propio del caller. Mezclar listado-de-otros con edit-propio recrea la confusión que esta extracción busca resolver — la UI debe seguir el corte de capability, no el corte de "todo lo que muestra info de miembros".

### `member-headline/` (data-shape-named, no capability-named)

**Rechazada porque**: idéntica anti-pattern que ADR-0040 corrigió en `members-ownership/` → `place-ownership-actions/`. Mapea el campo (`headline`) en lugar de la capability (`perfil contextual`). V1.1+ agregará avatar contextual + posiblemente otros campos de perfil-en-place — `member-headline/` quedaría como nombre con scope vencido el día que se agregue cualquier campo nuevo. `member-profile/` cubre toda la capability "perfil del miembro en este place" sin tener que renombrar.

### Subfolder `members/profile/*` sin barrel propio

**Rechazada porque**:
1. Viola el paradigma vertical-slice (regla ESLint ADR-0039 valida boundaries por `public.ts`, no por subfolder).
2. No descomprime LOC del slice padre — el cap se mide por feature, no por carpeta.
3. Hace ambigua la ownership: una PR que edita `members/profile/*` ¿es scope members o scope profile?
4. La asimetría de permisos sigue invisible al lector — el slice padre `members/` exporta dos capabilities con modelos de autorización opuestos sin pista estructural.

## Consecuencias

### Adoptadas

- **Going-forward**: cualquier consumer del flujo member-profile importa desde `@/features/member-profile/public`. El page S11 ensamblará `<MembersList />` (slice `members/`) + `<HeadlineEditor />` (slice `member-profile/`) + `<PendingInvitationsTab />` (slice `invitations/`) en la misma vista `/settings/members`.
- **ADR-0028 §"Política a futuro" cumplida**: el slice satisface los 3 criterios para promoción a slice propio:
  1. Cap LOC heurístico: extracción mantiene `member-profile/` bajo 1500 (589 LOC) y baja `members/` ~25%.
  2. ADR/spec/migration propias: migration 0017 (`app.update_my_headline` + columna `headline` + CHECK constraint) es la SoT exclusiva + cubierta por spec §CU1 + ADR-0036 (bio contextual self-only).
  3. Consumers cross-slice futuros: el page S11 es el primero; reserva V1.1+ (avatar contextual + perfil-en-place expandido) garantiza más consumers downstream.
- **Members slice diet progresa**: 2237 → 1678 LOC. Aún sobre cap por 178 LOC; S10.9 (refactor `member-row-actions-menu` a page-level con render-prop) cierra el gap restante (el componente actual = 295 LOC + su test = 258 LOC; relocate/restructure libera ~200-300 LOC del slice).

### Forward-compat

- **S10.9** refactoriza `member-row-actions-menu` — NO es extracción (no hay capability autónoma para esa función), es restructuring a page-level con render-prop. ADR-0043 documentará el patrón.
- **Page S11** importará de los 4 slices: `members/`, `invitations/`, `place-ownership-actions/`, `member-profile/`. Cada uno con su barrel `public.ts` — sin deep-imports.
- **V1.1+ avatar contextual**: cuando se implemente, vive en este slice (`member-profile/`). El nombre cubre la capability completa — no requiere otra extracción.
- **Doc-comments anchor**: `members/types.ts`, `members/public.ts`, `members/actions/_lib/schemas.ts` + tests tienen pointers actualizados a `member-profile/` — grep por `member-profile/` recupera todos los anchors.

### No-impacto

- **Tests**: el split fue puramente nominal/estructural. Suite 103/103 archivos verde post-extracción (1 file extra vs S10.7 = nuevo `member-profile/actions/_lib/__tests__/schemas.test.ts`; total tests 930/930 sin cambio).
- **Build**: el rename no requiere migration de runtime ni de DB.
- **History per-file**: `git mv` preservó blame/history línea-por-línea de los 5 files movidos (todos detectados como rename por git, similarity ≥50%). Los 4 files split-edit (types + schemas + tests + public.ts del nuevo) son creates desde la perspectiva git porque la similitud post-split cae bajo el threshold default.

### Excepción inmutabilidad ADR

- **ADRs 0040 y 0041** referencian `members/` en su estado pre-S10.8 — **NO se editan** (regla inmutabilidad). Coherente con momento histórico: cuando se escribieron, este split aún no existía.

## Verificación

Post-split, los siguientes comandos deben pasar verdes:

- `pnpm lint` — clean (regla ADR-0039 valida 0 deep-imports cross-slice; los cross-slice futuros en S11 irán a `/public`).
- `pnpm typecheck` — clean (paths absolutos `@/features/member-profile/public` resuelven al nuevo barrel; paths relativos intra-slice intactos post-`git mv` porque la estructura de directorios se preservó).
- `pnpm test` — clean: 103/103 files · 930/930 tests verde.
- `git status` — confirma R (rename) en 5 files + M en 4 split-edit + creates en 4 new files (types.ts + schemas.ts + schemas.test.ts + public.ts del nuevo slice).
- `find src/features/member-profile -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total ≤1500.
- `find src/features/members -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total < 2237 (cap aún excedido pendiente S10.9; verificación de progreso).

## Referencias

- ADR-0028 (Custom Domain slice promotion) — política de promoción a slice propio (cap LOC + ADR/spec propia + consumers futuros)
- ADR-0036 (member bio contextual) — origen de la decisión "headline self-only, sin placeholder pasivo"
- ADR-0039 (eslint slice boundaries enforcement) — regla que valida cross-slice imports via `/public`
- ADR-0040 (rename place-ownership-actions) — establece convención capability-named
- ADR-0041 (extract invitations slice) — primer split capability del slice padre, mismo playbook
- ADR-0010 (errores discriminables) — política anti-info-leak que el map `_lib/` honra
- `docs/features/members/spec.md` §CU1 — caso de uso V1 (auto-edición de headline)
- `docs/features/members/plan-sesiones.md` §S10 + §Decisiones operacionales — write-back canónico
- `src/db/migrations/0017_member_headline.sql` — migration SoT del slot
- `src/features/member-profile/public.ts` — barrel canónico del slice
