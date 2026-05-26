# ADR-0043 — Mover `<MemberRowActionsMenu />` a page-level co-located + render-prop en `<MembersList />`

**Fecha**: 2026-05-25
**Estado**: Adoptada
**Contexto inmediato**: Feature E (members slice V1) — sesión S10.9 (cierre del slice diet S10.5-S10.9). Continuación de ADR-0040 (rename `place-ownership-actions/`), ADR-0041 (extract `invitations/`) y ADR-0042 (extract `member-profile/`). Esta ADR cierra el ciclo: a diferencia de las 3 anteriores, NO es una extracción de slice.

## Contexto

Post S10.8 (ADR-0042), el slice `members/` quedó en **1678 LOC** — todavía 178 sobre el cap heurístico ≤1500 (CLAUDE.md §"Límites de tamaño"). El análisis de qué quedaba en el slice mostró que el ofender principal era `member-row-actions-menu.tsx` (295 LOC) + su test (258 LOC) = **553 LOC** del slice gastados en un único componente.

El cohesión-audit detectó algo más sutil que la asimetría de capabilities de S10.7/S10.8: este componente **ya importaba 3 wrappers cross-slice** desde `@/features/place-ownership-actions/public` (elevate + revoke + transfer) además de los 1 propios de `members/` (remove). Cuatro acciones — tres de otro slice — ensambladas en un único menú per-fila.

Eso no es una capability autónoma — es **composición**. El menú no representa un "qué hace" coherente del slice `members/`; representa "el lugar donde el page S11 ensambla las acciones disponibles sobre un member row". Su único consumer es el page; su sola razón para existir es darle al page un lugar para coordinar las 4 actions.

Esta característica — componente que cruza ≥2 slices vía sus barrels `/public`, único consumer es un page concreto, sin DEFINER ni spec propia — califica como **page-level glue code**, no como UI de slice.

S10.9 ejecuta el refactor que cierra el slice diet:
- `<MemberRowActionsMenu />` se mueve a page-level co-located: `src/app/(app)/place/[placeSlug]/settings/members/_components/member-row-actions-menu.tsx` (convención Next.js `_*` = directorio privado, no-route).
- `<MembersList />` deja de componer el menú internamente; adopta el patrón render-prop: el page inyecta `renderRowActions={(member) => <MemberRowActionsMenu member={member} ... />}`.

Resultado LOC: `members/` 1678 → 1074 (-604, **426 LOC bajo cap**).

## Decisión

### Movimiento y refactor

**`git mv` puro** (2 files, history preservada per-file):
- `src/features/members/ui/member-row-actions-menu.tsx` → `src/app/(app)/place/[placeSlug]/settings/members/_components/member-row-actions-menu.tsx`.
- `src/features/members/ui/__tests__/member-row-actions-menu.test.tsx` → `src/app/(app)/place/[placeSlug]/settings/members/_components/__tests__/member-row-actions-menu.test.tsx`.

**Update imports** en el menu file movido y su test: paths relativos (`../actions/remove-member`, `../types`, `../../types`) → barrel absoluto `@/features/members/public`. El import a `@/features/place-ownership-actions/public` ya era absoluto, queda intacto.

**Refactor `<MembersList />`** — drop de 5 props (`actions`, `callerCtx`, `placeId`, `placeSlug`, `menuLabels`) y de 4 types re-exportados. Nueva signature:

```typescript
function MembersList({
  members,
  labels,
  renderRowActions,
}: {
  members: Member[];
  labels: MembersListLabels;
  renderRowActions?: (member: Member) => ReactNode;
});
```

**Update tests `<MembersList />`** — drop de mocks/types removidos; agrega 2 tests nuevos para validar el render-prop (slot ausente cuando no se inyecta, slot invocado por cada member con el shape correcto cuando sí).

**Update barrel `members/public.ts`** — remueve 4 re-exports del menú (`MemberRowActionsMenu`, `MemberRowActionsMenuActions`, `MemberRowActionsMenuCallerContext`, `MemberRowActionsMenuLabels`) + `MembersListActions` + `MembersListCallerContext`. Header doc actualiza el inventario del slice + apunta al componente page-level co-located.

### Convención inaugurada: `app/.../_components/` para page-level glue

Esta sesión inaugura una convención nueva del repo: **componentes que ensamblan ≥2 slices, con un único page-consumer y sin capability/DEFINER/spec propia, viven en `app/.../<ruta>/_components/`** (o `app/.../<ruta>/_components/__tests__/` para sus tests).

El prefijo `_` es convención Next.js para directorios privados (no-route — el router los ignora como segmentos). Su semántica: "código compartido por esta ruta y nada más".

Cuándo aplicar:
- Componente importa de ≥2 barrels `@/features/*/public`.
- Tiene exactamente 1 consumer (el page hermano).
- No representa una capability autónoma (no aplica el criterio ADR-0028 §"Política a futuro").

Cuándo NO aplicar:
- Componente reutilizable por múltiples páginas → `shared/ui/` (regla: shared/ NO importa de features/).
- Componente con capability autónoma y consumers cross-slice → slice propio con `/public` (proceso ADR-0040/0041/0042).
- Componente que sólo importa de 1 slice → vive en ese slice.

## Alternativas rechazadas

### Status quo (mantener `<MemberRowActionsMenu />` en `members/`)

**Rechazada porque**: el slice quedaba 178 LOC sobre el cap heurístico. CLAUDE.md §"Límites de tamaño" obliga a dividir. Más importante: la asimetría conceptual no es accidental — el menú ensambla 4 actions de 2 slices y su único razón de existir es el page S11. Mantenerlo dentro de `members/` mantenía un componente "huérfano de capability" forzado a vivir en un slice por coincidencia histórica (S10 lo creó ahí cuando todavía no había split).

### Nuevo slice `member-row-actions/`

**Rechazada porque**: violaría ADR-0028 §"Política a futuro" — el slice no satisfaría 2 de los 3 criterios para promoción a slice propio:
1. ❌ Sin ADR/spec/migration propia (el componente es 100% composición de actions de otros slices — no tiene DEFINER ni schema propio).
2. ❌ Consumers cross-slice futuros: el único consumer plausible es el page S11; reserva V1.1+ no contempla otro consumer.
3. ✓ Cap LOC heurístico (cumpliría — ~310 LOC).

Crear un slice "wrapping composition glue" diluiría el criterio de slice extraction establecido en ADR-0028/0040/0041/0042 — quedaría como precedente para cualquier compose-only component en el futuro, fragmentando el paradigma.

### Mantener el menú en `members/` + refactor sólo de la signature (`<MembersList renderRowActions>`)

**Rechazada porque**: no descomprime LOC del slice — el componente sigue ahí, sigue contando para el cap. El gap de 178 LOC seguiría vigente, contradiciendo el objetivo principal de S10.9 (cerrar el slice diet). Además, el refactor de signature sin mover el archivo deja al componente con la misma "no-pertenencia conceptual" que esta ADR intenta corregir.

### Inline en el page S11 (sin file separado)

**Rechazada porque**: el componente tiene 295 LOC de lógica de UI + state hooks + 4 error maps + JSX condicional matrix-driven. Inlinearlo en `page.tsx` violaría la regla "pages en `app/` son THIN y delegan" (architecture.md §"Estructura de directorios"). Además, perderíamos la capacidad de testear el menú aislado — actualmente cubierto por 7 tests RTL (matriz role × role + happy path).

## Consecuencias

### Adoptadas

- **Going-forward**: el page S11 (`src/app/(app)/place/[placeSlug]/settings/members/page.tsx`, pendiente sesión S11) importará el menú desde el path relativo `./_components/member-row-actions-menu` + las primitives desde `@/features/members/public`, `@/features/place-ownership-actions/public`, `@/features/invitations/public`, `@/features/member-profile/public`.
- **Members slice diet cerrado**: 3765 → 2237 → 1678 → **1074 LOC** (-2691 cumulativo, **-71% vs estado pre-slice-diet**). Cap heurístico ≤1500 satisfecho con 426 LOC de margen.
- **Convención `app/.../_components/` documentada** — futuro page-level glue code tiene un home establecido sin tener que recrear el debate.
- **`<MembersList />` adopta render-prop puro** — la lista queda como capa presentacional reutilizable. Si V1.1+ requiere otra vista (ej. lista read-only para no-owners), el componente ya lo soporta con `renderRowActions` ausente.

### Forward-compat

- **Page S11**: importa de los 4 slices + el menu page-level. Estructura del `app/` dir crece con sub-carpetas `_components/` cuando sea coherente con esta convención.
- **Test del menú movido**: sigue verde post-mv (rename detectado por git al 100% similarity; sólo cambió el import a barrel absoluto).
- **Otros componentes que ensamblen ≥2 slices**: candidatos naturales para esta convención. No hay extracción retroactiva — sólo aplica forward-going.

### No-impacto

- **Tests**: 932/932 verde post-refactor (+2 tests vs baseline previo 930 — los 2 nuevos del render-prop). Test del menú movido pasa sin cambios funcionales (sólo update de import path).
- **Build**: el move + refactor no requieren migration de runtime ni de DB.
- **History per-file**: `git mv` preservó blame/history línea-por-línea de ambos files movidos (rename detection 100% similarity).
- **ESLint slice boundaries** (ADR-0039): clean. El menú vive en `app/`, no en `features/`; sus imports cross-slice (a `members/public` y `place-ownership-actions/public`) usan los barrels canónicos.

### Excepción inmutabilidad ADR

- **ADRs 0040, 0041, 0042** referencian `members/ui/{members-list,member-row-actions-menu}` como cross-slice consumer de `place-ownership-actions/` en su estado pre-S10.9 — **NO se editan** (regla inmutabilidad). Coherente con momento histórico: cuando se escribieron, el menú aún vivía en `members/`.

## Verificación

Post-refactor, los siguientes comandos deben pasar verdes:

- `pnpm typecheck` — clean (paths absolutos `@/features/members/public` resuelven al barrel; el path relativo `./_components/member-row-actions-menu` del page S11 futuro resolverá al nuevo home).
- `pnpm lint` — clean (regla ADR-0039 valida cross-slice imports via `/public`; el menú en `app/` ya no es código de slice por lo que las reglas de slice boundaries no aplican a sus internals — sólo a sus imports cross-slice, que usan barrels).
- `pnpm test` — clean: 103/103 files · 932/932 tests verde (+2 vs baseline post-S10.8 por los 2 nuevos render-prop tests de `<MembersList />`).
- `git status` — confirma R (rename) en 2 files + M en 3 (members-list.tsx + su test + public.ts).
- `find src/features/members -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total ≤ 1500 (esperado 1074, **426 bajo cap**).
- `find "src/app/(app)/place/[placeSlug]/settings/members/_components" -type f \( -name "*.ts" -o -name "*.tsx" \) | xargs wc -l` total 567 (menu + test).

## Referencias

- ADR-0028 (Custom Domain slice promotion) — política de promoción a slice propio (cap LOC + ADR/spec propia + consumers futuros); criterio que esta ADR explícitamente NO satisface ⇒ no es slice.
- ADR-0036 (member bio contextual) — origen de la decisión "headline self-only"; orthogonal pero contextualiza por qué el menú coordina actions destructivas mientras profile vive en otro slice.
- ADR-0039 (eslint slice boundaries enforcement) — regla que valida cross-slice imports via `/public`; el menú movido los respeta.
- ADR-0040 (rename place-ownership-actions) — establece convención capability-named para slices; esta ADR establece la convención complementaria para componentes que NO califican como slice.
- ADR-0041 (extract invitations slice) — primer split capability del slice padre.
- ADR-0042 (extract member-profile slice) — segundo split capability + tercer movimiento del slice diet.
- `docs/features/members/spec.md` §"UI screens" S10 — caso de uso del menú (matriz role × role).
- `docs/features/members/plan-sesiones.md` §S10 — write-back con LOC delta final del slice diet.
- `docs/architecture.md` §"Estructura de directorios" — "app/ delgado, delega a features"; esta ADR refina: páginas pueden tener `_components/` para glue code que ensambla múltiples slices.
- `src/app/(app)/place/[placeSlug]/settings/members/_components/member-row-actions-menu.tsx` — file movido (canónico).
- `src/features/members/ui/members-list.tsx` — refactor a render-prop (signature reducida).
- `src/features/members/public.ts` — barrel actualizado (sin re-exports del menú).
