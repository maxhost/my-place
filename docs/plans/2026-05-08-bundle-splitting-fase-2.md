# Plan — Bundle Splitting Fase 2

**Fecha:** 2026-05-08
**Predecesor:** Fase 1 (commits `bb2d369..e69ef18`, perf-1 → perf-4)
**ADR base:** `docs/decisions/2026-05-08-sub-slice-cross-public.md`
**Estado:** Plan vigente — pendiente de ejecución por sub-fase.

## Context

Fase 1 ya cerrada. Lo que dejó hecho:

- **Split de barrels lite + sub-slice publics** en `rich-text/`, `discussions/`, `events/`, `members/`. Cada slice expone:
  - `public.ts` (lite, client-safe, sin Composers ni server-only).
  - `<sub>/public.ts` o `<sub>/public.server.ts` (heavy, sub-slice dedicado).
- **LazyCommentComposer + ThreadPresenceLazy + CommentRealtimeAppender** vía `React.lazy + requestIdleCallback`. Patrón Reddit: input plano eager, editor real lazy on-tap. Documentado contra `next/dynamic` (gotcha clave).
- Boundary rule extendida: `<feature>/<sub>/public(.server)` cross-slice permitido, un solo nivel de anidación. `tests/boundaries.test.ts` lo enforcea.
- Resultado medido: lectura `233-238 kB`, creación `325-333 kB`. Baseline framework `103 kB` shared.

**Por qué Fase 2.** El First Load remanente está dominado por 4 chunks que viajan a casi todas las pages:

| Chunk  | gzip  | Contenido                                      | Diagnóstico Fase 2                                                                                                                                                                                          |
| ------ | ----- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7970` | 35 kB | Zod core + schemas serializados                | `discussions/public.ts`, `members/public.ts`, `events/public.ts` re-exportan los Zod input schemas desde el barrel **lite**. Cualquier Client Component que use el barrel arrastra Zod entero al cliente.   |
| `6600` | 33 kB | `next/image` + `lucide-react`                  | `optimizePackageImports` hace tree-shake nominal pero el shell mete 7 íconos en Client Components que viajan eager.                                                                                         |
| `560`  | 17 kB | Floating UI (Radix Popover/Dropdown internals) | Usado por `shared/ui/dropdown-menu.tsx` + `dialog.tsx` + `bottom-sheet.tsx` + `emoji-picker-popover.tsx`. Algunos consumers del Dropdown son simples menus admin sin necesidad real de focus trap + portal. |
| `6697` | 17 kB | Settings forms residuales                      | Verificar si todavía contamina pages no-settings o si los 17 kB Δ están en otro chunk.                                                                                                                      |

Fase 2 ataca estos 4 puntos sin tocar Fase 1.

## Scope cerrado

### Entra

1. Sacar Zod del bundle eager en lectura (split schemas/runtime de Zod del barrel lite).
2. Eliminar `lucide-react` del shell eager (icon strategy).
3. Auditar Radix consumers y replazar dropdowns que no requieren su API por HTML plano.
4. Verificar y cerrar el chunk `6697` (settings forms o el 17 kB Δ remanente).
5. Auditar Client Components del shell: `DwellTracker`, `ThreadHeaderBar` (es Server, OK), `BackButton`, `ReactionBar(POST)` inicial. Lazy-ear lo que tenga sentido.
6. Documentar Fase 3 contingente (Edge runtime + Neon HTTP driver) como sección separada — NO se ejecuta en Fase 2.

### Fuera

- Migración Edge runtime / driver Neon (Fase 3 contingente).
- Reescritura de `shared/ui/dialog.tsx` (Radix Dialog se queda — focus trap + ESC + portal son no-negociables para la UX cozytech).
- Touch a `composers/public`, `rich-text/composers/public`, `discussions/public.server`, `events/public.server`, `members/public.server` — Fase 1 los dejó en su forma final.
- Cambios a la regla de boundaries: la regla del ADR `2026-05-08-sub-slice-cross-public.md` queda firme.
- Eliminar dependencias completas (Radix root, lucide root) — sólo se splittea/lazyfica el uso.

## Decisiones cerradas

### D1 — Sacar Zod runtime del barrel lite via split `public.ts` + `public.schemas.ts`

**Rationale.** Hoy `discussions/public.ts` re-exporta `createCommentInputSchema`, `createPostInputSchema`, etc. (11 schemas Zod). `members/public.ts` re-exporta 8 schemas Zod. `events/public.ts` re-exporta 4 schemas Zod. Webpack, ante un Client Component que importa **un type** desde estos barrels, traza el grafo entero por convención `'use client'`. Resultado: Zod (35 kB gzip) entra a cada page family de lectura.

**Solución.** Tercer archivo público por slice:

- `<slice>/public.ts` (lite — types, helpers puros, Server Actions, UI Client-safe sin schemas Zod). **Ya existe.**
- `<slice>/public.server.ts` (server-only — queries Prisma). **Ya existe.**
- `<slice>/public.schemas.ts` (**nuevo**) — exclusivamente Zod input schemas + `Input` types derivados. Importado por: Server Actions del propio slice (que ya no van por barrel sino por path interno) y por las 5 UI files identificadas que necesitan constants/schema (ej: `inviteMemberSchema` en `members/invitations/ui/invite-form.tsx`).

**Dos sub-decisiones.**

1.1. **Boundaries**. La regla del ADR `2026-05-08-sub-slice-cross-public.md` permite `public`, `public.server`, `<sub>/public(.server)`. Extendemos con `public.schemas` (siblings del barrel raíz, no nuevo sub-slice). Update mínimo en `tests/boundaries.test.ts` (1 alternativa adicional al match) + nota en el ADR.

1.2. **Constants** que no requieren Zod (ej: `EXPEL_MEMBER_REASON_MAX_LENGTH`, `POST_TITLE_MAX_LENGTH`). Hoy viven en `schemas.ts`/`domain/invariants.ts`. Consolidar en `domain/invariants.ts` (already lo hace `discussions`) y exponer desde el barrel lite. `schemas.ts` queda 100% Zod runtime.

**Por qué no `optimizePackageImports` para Zod.** Zod no es un package; está en `node_modules`, sí, pero las que arrastran a Zod son nuestras `schemas.ts` files importadas por barrels. `optimizePackageImports` es para libs externas con shape estable (lucide-react, sonner). Aplicarlo a nuestros slices fue descartado en el ADR de Fase 1 — sigue siendo descartado.

**Por qué no fronteras dinámicas (`React.lazy(() => import('./schemas'))`) para los schemas client-side.** Ningún Client Component re-valida con Zod (no hay `zodResolver` excepto `hours/schemas.ts`). Los schemas Zod en pages NO se ejecutan en cliente — se serializan via Server Actions (Next inyecta wrapper). El uso client-side real es marginal (5 files). Sacar Zod del barrel basta.

### D2 — Sacar lucide-react del shell eager: estrategia "tres tiers"

**Rationale.** `optimizePackageImports: ['lucide-react']` ya está activo. Funciona en imports nominales (`import { Settings } from 'lucide-react'`) pero el shell tiene 7 íconos eager en pages de lectura: `Settings`, `Search`, `ChevronDown`, `Sparkles`, `Check`, `MapPin`, `ChevronLeft`. Cada ícono lucide pesa ~0.5 kB tree-shaked, pero el chunk ICON+IMG `6600` reportado en 33 kB sugiere que `next/image` (que es la mitad del chunk) y lucide comparten chunk con co-arrastrado del shell.

**Tres tiers**:

- **Tier A — íconos del shell crítico (eager, FCP-blocking)**: `Settings`, `ChevronDown`, `Sparkles`, `ChevronLeft`. Reemplazar por **inline SVG** dentro de `shared/ui/icons/` (4 archivos ≤30 LOC c/u, exports nombrados, props {size, className}). Sin dependencia externa. ~2.5 kB total inline en el bundle del shell, pero saca el grafo de lucide del eager path.
- **Tier B — íconos de surfaces secundarios**: `Search` (search trigger), `Check` (community-row + rsvp-button), `MapPin` (event-metadata-header). Quedan en `lucide-react` pero los **components que los usan** se convierten a Server Components donde sea posible (search-trigger es Client por handler, mapPin no — ya es server). Donde sea Client, mismo inline-SVG approach del Tier A.
- **Tier C — íconos de admin/forms**: kebab/admin menus, hours editor. Quedan en `lucide-react`. Vienen sólo a pages de admin. No bloquean FCP de lectura.

Resultado esperado: lucide-react sale del chunk del shell crítico (~3-5 kB). El chunk `6600` baja a `next/image` core (~18 kB) que no es removible.

**Por qué no `lucide-static`**: agrega otra dep (15 kB), no resuelve mejor que inline SVG, y rompe el patrón "un componente por ícono" que usamos hoy.

**Por qué no SVG sprite**: complica el build (necesita un loader o inyección manual en `<head>`), y para 4 íconos no compensa.

### D3 — Auditoría Radix: dropdowns admin a HTML plano, Dialog/Popover/EmojiPicker se quedan

**Rationale.** Floating UI (chunk `560`, 17 kB gzip) es transitive de Radix Popover/Dropdown/Dialog. Sale a cualquier page con un dropdown menu — incluso threads que sólo lo necesitan para el kebab del admin (>90% del tráfico es no-admin).

**Decisión clasificatoria** (un componente por categoría):

| Componente                                                        | Ubicación                                 | Decisión                                                                                                                                                                                                                                                                                          | Rationale                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/ui/dropdown-menu.tsx` (Radix Dropdown)                    | shell crítico                             | **Mantener Radix** pero **lazy load via React.lazy** desde un wrapper `dropdown-menu-lazy.tsx` cuando el viewer es admin del thread. Non-admins NO traen Radix Dropdown al chunk eager.                                                                                                           | Focus trap + portal + keyboard nav + Escape: imprescindibles. Reescribir es alto riesgo a11y. Patrón Reddit replicado: kebab eager es un `<button>` plano; al click, dispara lazy del Radix. |
| `shared/ui/dialog.tsx` (Radix Dialog)                             | flag-modal, library admin, members modals | **Mantener Radix sin lazy**                                                                                                                                                                                                                                                                       | Modales son admin/forms — viajan sólo a pages que los usan. Lazy aporta poco si la page es la razón del Dialog.                                                                              |
| `shared/ui/bottom-sheet.tsx` (Radix Dialog)                       | settings/composer flows                   | **Mantener Radix sin lazy**                                                                                                                                                                                                                                                                       | Mismo argumento.                                                                                                                                                                             |
| `shared/ui/emoji-picker/emoji-picker-popover.tsx` (Radix Popover) | reactions de comments                     | **Mantener Radix** pero **gateado detrás de feature**: el ReactionBar del POST inicial no monta el picker — sólo los 6 emojis fijos. El picker (`+` para emoji custom) ya es un Popover separado. **Verificar** que sólo viaja a pages que usan ReactionBar custom (no es el caso del POST root). | El Popover sólo aparece si el viewer abre el "+". El uso por defecto del ReactionBar no lo monta.                                                                                            |

Sub-decisión: el lazy de `DropdownMenu` se hace con un componente wrapper `<AdminMenu>` en `shared/ui/` que recibe `{ trigger, items }` y arma el JSX Radix internamente. Los call-sites (`PostAdminMenu`, `CommentAdminMenu`, `ItemAdminMenu`, `EventActionsMenu`) pasan a renderizar un `<button>` no-Radix que activa el lazy en el primer click. Patrón idéntico a `<CommentComposerLazy>`.

### D4 — Verificar chunk `6697` (settings forms) — rama A o rama B según diagnóstico

**Rationale.** Reportado en 17 kB con duda sobre si todavía contamina pages no-settings. Hipótesis a verificar antes de decidir:

- **A.** Si el chunk sigue viajando a pages de lectura → es porque algún `public.ts` re-exporta indirectamente un Form admin (ej: `members/public.ts` re-exporta algo que toca formularios). **Acción**: localizar el re-export ofensor y splitear al sub-slice correspondiente (`members/access/public`, etc.). Sub-fase F4 lo cubre.
- **B.** Si el chunk YA es exclusivo de pages de settings → los 17 kB Δ entre 216 esperado y 233 reportado vienen de otro lugar. Hipótesis subordinada: `framer-motion` (declarado en `package.json` aunque no encontré uso explícito; verificar transitive vía sonner u otro), o `@react-email/render` arrastrado por algún path no obvio, o `pg`/Prisma client peek vía un re-export. **Acción**: bundle analyzer report + `webpack-bundle-analyzer` chunk attribution + remediar uno por uno. Sub-fase F4 lo cubre.

Rama A es más probable (~70%) según el patrón observado en perf-4. El plan ejecuta el diagnóstico primero y la remediación después; la sub-fase no se cierra hasta que el chunk reportado por Next esté al ≤3 kB de overhead técnico-de-shell.

### D5 — Auditoría de Client Components del shell con criterio "lazy-able post-FCP"

**Rationale.** Tres candidatos según el pedido + dos más que aparecen en el audit:

- `DwellTracker`: Client puro (`useEffect` para visibility tracking), 109 LOC, sin deps externas. **Lazy via React.lazy + idle**, mismo patrón que `ThreadPresenceLazy`. El first paint del thread no necesita el dwell tracker — recién a 5s de visibilidad continua marca el read. Arrancar a tracking 100-200ms tarde no afecta el threshold (5s).
- `ThreadHeaderBar`: ya es Server Component (sin `'use client'`). **No requiere acción**.
- `ReactionBar(POST)` (inicial): Client (optimistic state), 156 LOC, sin deps externas. **NO lazy** — la barra es interactiva inmediato (tap a un emoji), parte del LCP visual del thread. Lazy rompe expectativa UX. **Decisión: queda eager**.
- **Nuevo candidato `BackButton` (shared/ui/back-button.tsx)**: Client (history.length check), pero usado en headerbar eager. Sólo trae `ChevronLeft`. **Migrar a Server con un mini Client wrapper** que monta el listener `popstate`. ~5 LOC menos en eager.
- **Nuevo candidato `community-switcher.tsx` + `community-row.tsx`**: Client, dropdown del logo. **Lazy via React.lazy on-tap del logo** — patrón Reddit replicado. El topbar ya pinta el nombre del place server-side; el dropdown sólo se monta al click. Saca el bundle del community switcher (incluye `ChevronDown` + `hashToIndex` + `placeUrl`) del shell eager.

### D6 — Fase 3 contingente (Edge runtime) — documentada, no se ejecuta

Migrar a Edge runtime requiere reemplazar `@prisma/adapter-pg` (no soportado en Edge) por `@neondatabase/serverless` HTTP driver. Costo estimado:

- **Beneficio bruto**: First Load JS estable (~10 kB menos por cold start eliminado), TTFB 30-50ms menos en regiones lejanas a us-east-2 (Edge corre en POPs).
- **Costo de migración**:
  - Cambiar provider Postgres (Supabase → Neon) o usar Neon como pooler frente a Supabase Postgres (latencia agregada).
  - Reescribir `src/db/client.ts` (singleton actual asume Pool node-postgres).
  - Romper compat con tests RLS que usan `DIRECT_URL` (session mode pooler — dudosa compat con Neon HTTP).
  - Reescribir cron handlers (`/api/cron/erasure`, `/api/cron/erasure-audit`) — Edge runtime tiene timeout 25s sin `maxDuration`.
- **Riesgo**: cada feature flag de Supabase (Auth, Storage, Realtime, Branches CI) está acoplada al stack Supabase. Migrar Postgres a Neon mantiene Auth/Storage/Realtime en Supabase pero divide ownership.
- **Decisión**: NO en Fase 2. Re-evaluar tras Fase 2 si First Load remanente justifica el riesgo. Documentar como Sub-fase F-Edge contingente con criterio de activación: "First Load promedio del usuario logueado >180 kB después de Fase 2 sostenido por dos semanas".

## Sub-fases

| Sub-id | Tema                                                                      | Sesiones                                                     | Deliverable verificable                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | Split `public.schemas.ts` por slice (D1)                                  | 2 sesiones (1 backend split + tests, 1 ajustar consumers UI) | Diff de 4 barrels lite (`discussions`, `members`, `events`, `library` si aplica) sin re-exports Zod. `tests/boundaries.test.ts` actualizado. ANALYZE muestra Zod fuera del chunk shared del shell. Reporte: First Load lectura ≤218 kB. |
| **F2** | Inline SVG iconos shell crítico (D2 Tier A)                               | 1 sesión                                                     | 4 archivos en `shared/ui/icons/` (`settings.tsx`, `chevron-down.tsx`, `sparkles.tsx`, `chevron-left.tsx`). Migrar 4 import sites en shell. ANALYZE: chunk `6600` baja ≤22 kB.                                                           |
| **F3** | Lazy `DropdownMenu` admin (D3)                                            | 2 sesiones (1 wrapper + lazy infra, 1 migrar 4 admin menus)  | `shared/ui/admin-menu-lazy.tsx`. `PostAdminMenu`, `CommentAdminMenu`, `ItemAdminMenu`, `EventActionsMenu` migrados. ANALYZE: chunk `560` desaparece de pages no-admin.                                                                  |
| **F4** | Diagnóstico chunk `6697` + remediación (D4)                               | 1 sesión diagnóstico + 1-2 sesiones remediación según rama   | Reporte ANALYZE con árbol de attribution del chunk. Si rama A: split del re-export ofensor (mismo patrón D1). Si rama B: identificar lib y plan focalizado. Cierra cuando ningún page family de lectura monta `6697`.                   |
| **F5** | Lazy `DwellTracker` + `BackButton` server + `CommunitySwitcher` lazy (D5) | 1 sesión                                                     | 3 wrappers/refactors. ANALYZE: shell crítico ≤8 kB sin community switcher; dwell-tracker en chunk separado.                                                                                                                             |
| **F6** | Cierre + ADR + medición consolidada                                       | 1 sesión                                                     | ADR `docs/decisions/2026-05-08-bundle-fase-2.md` con resumen, antes/después por sub-fase, reportes ANALYZE checkpointed en `docs/perf/`. CLAUDE.md gotcha actualizado si surgió alguno nuevo.                                           |

**Total estimado: 8-10 sesiones**, paralelizables como se indica abajo.

## Patrón de paralelización

Las sub-fases F1, F2 y F5 son **independientes** entre sí (cada una toca archivos disjuntos). F3 toca `shared/ui/dropdown-menu.tsx` + 4 features pero no colisiona con F1/F2/F5. F4 puede correr en paralelo a F1-F3 hasta el reporte de diagnóstico; la remediación depende del veredicto rama A vs B.

Recomendación: **dos tracks paralelos**:

- Track A (semana 1): F1 (más alta ROI, ~17 kB Zod) + F2 (mecánico, riesgo bajo).
- Track B (semana 1): F4 diagnóstico + F5 (audit+lazy de shell).
- Track C (semana 2, secuencial post-Track A): F3 (depende de patrón validado en F1) + F4 remediación + F6 cierre.

No paralelizar F1 con F4 si el diagnóstico de F4 sospecha del mismo barrel — esperar diagnóstico antes de splitear más.

## Critical files

Mapa de archivos modificados por sub-fase (path absoluto cuando ayuda; relativo desde `/Users/maxi/claude-workspace/place/` cuando son del repo).

### F1 — Split `public.schemas.ts`

- `src/features/discussions/public.ts` — eliminar re-export del bloque `schemas`.
- **Nuevo** `src/features/discussions/public.schemas.ts` — re-export de los 11 schemas + `Input` types desde `./schemas`.
- `src/features/members/public.ts` — eliminar re-export Zod.
- **Nuevo** `src/features/members/public.schemas.ts`.
- `src/features/events/public.ts` — eliminar re-export Zod.
- **Nuevo** `src/features/events/public.schemas.ts`.
- `src/features/library/public.ts` — verificar y aplicar mismo patrón si re-exporta schemas.
- `src/features/members/moderation/ui/expel-member-dialog.tsx`, `block-member-dialog.tsx` — cambiar import de `@/features/members/public` a `@/features/members/public.schemas` para constants Zod-derived. Alternativa: mover `EXPEL_MEMBER_REASON_MAX_LENGTH` a `members/domain/invariants.ts` y mantener el barrel lite. **Preferir esta segunda opción** (constants no son Zod).
- `src/features/members/invitations/ui/invite-form.tsx`, `invite-owner-sheet.tsx` — import de `inviteMemberSchema` desde `members/public.schemas` (este SÍ es Zod runtime usado en el form para validación cliente — chequear si efectivamente se usa o sólo se importa como type).
- `tests/boundaries.test.ts` — agregar `public.schemas` a la lista de entries válidas cross-slice (alongside `public`, `public.server`).
- ADR `docs/decisions/2026-05-08-sub-slice-cross-public.md` — addendum al final con la subregla `public.schemas`.

### F2 — Inline SVG icons

- **Nuevo** `src/shared/ui/icons/settings.tsx`, `chevron-down.tsx`, `sparkles.tsx`, `chevron-left.tsx`. Cada uno ≤30 LOC, props `{ size?: number; className?: string; "aria-hidden"?: boolean }`.
- `src/features/shell/ui/settings-trigger.tsx` — swap import.
- `src/features/shell/ui/community-switcher.tsx` — swap import (también afectado por F5).
- `src/features/shell/ui/zone-fab-client.tsx` — swap import.
- `src/shared/ui/back-button.tsx` — swap import (también afectado por F5).

### F3 — Lazy DropdownMenu admin

- **Nuevo** `src/shared/ui/admin-menu-lazy.tsx` — wrapper `<AdminMenu trigger items />` que internamente lazy-importa el `DropdownMenu` Radix.
- `src/shared/ui/dropdown-menu.tsx` — sin cambios estructurales (sigue siendo el módulo Radix-pesado, pero ahora detrás del lazy).
- `src/features/discussions/ui/post-admin-menu.tsx` — refactor para usar `<AdminMenu>`.
- `src/features/discussions/ui/comment-admin-menu.tsx` — refactor.
- `src/features/library/ui/item-admin-menu.tsx` — refactor.
- `src/features/events/ui/event-actions-menu.tsx` — refactor.
- `src/features/discussions/moderation/ui/post-admin-menu.tsx` — refactor (sub-slice variant del posts admin menu).

### F4 — Diagnóstico chunk `6697`

Sin archivos modificados en la fase de diagnóstico. Sólo:

- Output de `ANALYZE=true pnpm build` checkpointed.
- Inspección manual del `.next/analyze/client.html`.

Si rama A → archivos del slice ofensor (a definir post-diagnóstico).
Si rama B → posiblemente `package.json` (eliminar dep no usada) o split adicional del barrel del slice ofensor.

### F5 — Audit shell client components

- **Nuevo** `src/features/discussions/ui/dwell-tracker-lazy.tsx` — wrapper `React.lazy + idle` análogo a `thread-presence-lazy.tsx`.
- `src/features/discussions/public.ts` — re-exportar `DwellTrackerLazy as DwellTracker` (mantener API estable para call-sites; eliminar re-export viejo).
- `src/features/discussions/presence/public.ts` — sub-slice consistency.
- `src/shared/ui/back-button.tsx` — convertir a Server Component con un mini Client child para `history.length` (~30 LOC mover).
- **Nuevo** `src/features/shell/ui/community-switcher-lazy.tsx` — wrapper React.lazy sobre `community-switcher.tsx`. El logo+nombre+chevron eager es markup plano; el dropdown se monta al primer click.
- `src/features/shell/ui/top-bar.tsx` (o donde se compone el switcher) — swap a la versión lazy.

### F6 — Cierre

- **Nuevo** `docs/decisions/2026-05-08-bundle-fase-2.md` (ADR).
- **Nuevo** `docs/perf/2026-05-08-fase-2-before-after.md` (reportes ANALYZE).
- `CLAUDE.md` — sección Gotchas: actualizar con cualquier descubrimiento (probable: "Zod schemas en barrels lite contaminan client bundle — usar `public.schemas.ts` para runtime Zod").

## Helpers / patterns reusados

- **Patrón Reddit lazy** (`React.lazy + requestIdleCallback` con fallback `setTimeout(100)`): ya implementado en `thread-presence-lazy.tsx` y `comment-thread-live.tsx`. F3 (`AdminMenu`) y F5 (`DwellTrackerLazy`, `CommunitySwitcherLazy`) lo replican literalmente. Copy-paste structural OK.
- **Split barrel lite + sub-slice public**: precedente en ADR `2026-05-08-sub-slice-cross-public.md` y `2026-04-21-flags-subslice-split.md`. F1 extiende la regla con `public.schemas` (siblings, no nuevo sub-slice — más simple).
- **Constants en `domain/invariants.ts`**: `discussions/` ya separa constants (POST_TITLE_MAX_LENGTH) de schemas (Zod). F1 propaga el patrón a `members/` y `events/`.
- **Server Action import directo desde sub-path**: pattern usado por `comment-composer-form.tsx` (`import { createCommentAction } from '../server/actions/comments'`). F1 mueve los imports server-side de schemas también a paths internos del slice (no por barrel) para no contaminar más.

## Riesgos + mitigaciones

| #   | Riesgo                                                                                                                                                                 | Probabilidad | Impacto                       | Mitigación                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Cambiar `discussions/public.ts` rompe imports en pages que esperan `createCommentInputSchema` exportado                                                                | Media        | Build fail                    | Audit estático con `grep -rn "createCommentInputSchema" src/` antes del split. Migrar consumers a `public.schemas` en el mismo PR.                                                            |
| R2  | `tests/boundaries.test.ts` rechaza `public.schemas` y debe actualizarse                                                                                                | Alta         | Test fail                     | Update incluido como deliverable F1.                                                                                                                                                          |
| R3  | Inline SVG con dimensiones inconsistentes versus lucide → layout shift                                                                                                 | Baja         | UX: shift de 1-2px en topbar  | Copiar viewBox y stroke-width exactos de lucide. Test visual playwright snapshot del shell.                                                                                                   |
| R4  | Lazy del DropdownMenu admin agrega 100-150ms de latencia al primer click admin                                                                                         | Media        | UX admin más lenta            | Aceptable: kebab admin es uso esporádico. Mostrar `<button>` con animación de loading durante el lazy load.                                                                                   |
| R5  | F4 diagnóstico revela que el chunk `6697` no tiene causa simple → bloquea Fase 2                                                                                       | Baja         | Sub-fase abierta indefinida   | Time-box: si tras 1 sesión de diagnóstico no hay causa clara, **escalar como sub-fase Fase 2.5** y cerrar Fase 2 con las otras 5 sub-fases ganadoras. Documentar el chunk como deuda técnica. |
| R6  | `DwellTracker` lazy no arma a tiempo y un usuario que pasa <5s en el thread no marca read                                                                              | Baja         | Métrica readers desbalanceada | El threshold de DwellTracker es 5s; el lazy arma en ~100-200ms post-FCP. La ventana de pérdida es 100-200ms / 5000ms ≈ 4%. Aceptable.                                                         |
| R7  | Lazy `CommunitySwitcher` cambia el orden DOM y rompe e2e tests del topbar                                                                                              | Media        | E2E fail                      | Mantener el `<button>` trigger eager con el mismo `data-testid`. El lazy sólo afecta el dropdown content.                                                                                     |
| R8  | `optimizePackageImports` deja de incluir `lucide-react` (porque dejamos de usarlo en shell), pero lucide sigue en chunks de admin → degradación marginal de tree-shake | Baja         | <1 kB                         | Mantener `lucide-react` en `optimizePackageImports` aunque baje el uso.                                                                                                                       |
| R9  | F5 reduce comm-switcher pero el `<TopBar>` server-side necesita data del switcher para SSR del nombre del place                                                        | Baja         | Re-render mismatch            | Ya hoy el server pinta el nombre via prop; el dropdown es sólo abrir/cerrar/list. Lazy del dropdown no toca SSR del nombre.                                                                   |
| R10 | Migrar Zod re-exports a `public.schemas` rompe el bundle de Server Actions (Next traza el grafo de la action)                                                          | Media        | Action fail en runtime        | Server Actions importan schemas via path interno (`../schemas`) — ya es el patrón actual. F1 NO toca actions.                                                                                 |

## Verificación

### Por sub-fase

**F1 — Zod split**:

- `pnpm typecheck && pnpm lint && pnpm test --run`: verde (incluye `tests/boundaries.test.ts`).
- `ANALYZE=true pnpm build` y abrir `.next/analyze/client.html`: el chunk de Zod (`7970` o equivalente post-rename) NO aparece en el chunk eager de pages `/conversations`, `/events`, `/library`, `/m/[handle]`. Sí debe seguir apareciendo en pages de admin/forms.
- `pnpm perf` apuntando a `/conversations` warm: First Load JS reportado por Next ≤218 kB (Δ-15 a -18 kB).
- E2E `tests/e2e/flows/discussions-create-read.spec.ts`: verde.

**F2 — Inline SVG**:

- `pnpm typecheck && pnpm test --run`: verde.
- `ANALYZE=true pnpm build`: chunk de iconos del shell ≤3 kB (sólo los 4 inline). `lucide-react` no aparece en el chunk eager del topbar.
- Smoke visual manual: settings trigger, chevron, sparkles, back button — pixel-perfect vs antes.

**F3 — Lazy AdminMenu**:

- `pnpm typecheck && pnpm test --run`: verde.
- `ANALYZE=true pnpm build`: chunk Floating UI (`560`) ausente del eager de pages no-admin.
- Smoke manual: thread page como non-admin → no kebab visible. Thread page como admin → kebab inicial es `<button>` plano; primer click muestra spinner; ~150ms después aparece el dropdown completo. Segundo click instant.
- E2E `tests/e2e/admin/post-moderation.spec.ts` (o equivalente): verde.

**F4 — Chunk 6697**:

- `ANALYZE=true pnpm build`: chunk identificado y remediado. Validar que no aparece en pages de lectura.
- Reporte de diagnóstico checkpointed en `docs/perf/2026-05-08-chunk-6697-attribution.md`.

**F5 — Shell audit**:

- `pnpm typecheck && pnpm test --run`: verde (incluye tests existentes de DwellTracker, CommunitySwitcher).
- `ANALYZE=true pnpm build`: chunk del shell crítico (sin community switcher dropdown) ≤8 kB; dwell-tracker en chunk separado lazy.
- Smoke manual: topbar pinta nombre del place inmediato; click al logo → ~100ms después aparece dropdown. Thread page → DwellTracker arma silencioso post-FCP; tras 5s de visibilidad continua, marca read (verificable en network tab).

**F6 — Cierre**:

- ADR redactado y commiteado.
- Checkpoints de `ANALYZE` archivados.
- Numeral final: First Load lectura ≤195 kB esperado (Δ-40 kB vs Fase 1).

### Final consolidada

Métricas target post-Fase 2:

| Métrica                                                         | Pre-Fase 2           | Target post-Fase 2 | Stretch       |
| --------------------------------------------------------------- | -------------------- | ------------------ | ------------- |
| First Load JS lectura (`/conversations`, `/events`, `/library`) | 233-238 kB           | ≤195 kB            | ≤180 kB       |
| First Load JS creación (`/conversations/new`, `/events/new`)    | 325-333 kB           | ≤300 kB            | ≤280 kB       |
| Real transferSize lectura (gzip on the wire)                    | 290-295 kB           | ≤245 kB            | ≤225 kB       |
| TTFB warm thread page                                           | (Sesión 5 pendiente) | sin regresión      | -20ms         |
| LCP percibido (skeleton → first content)                        | ~150-300ms           | sin regresión      | sin regresión |
| Lighthouse Performance score                                    | (a medir)            | ≥90                | ≥95           |

Verificación final via `scripts/perf/measure-perf-remote.ts` apuntado a 5 URLs canónicas + `ANALYZE=true pnpm build` con chunks comparados pre/post via diff manual de `.next/analyze/`.

## Salvaguardas anti-regresión

Sección dedicada porque Fase 1 es frágil — un re-export mal puesto en `public.ts` puede arrastrar Lexical entero de vuelta.

### S1 — `tests/boundaries.test.ts` cubre la nueva regla `public.schemas`

Después de F1, el test acepta `public.schemas` como entry cross-slice válido. **Pero** queremos también detectar el anti-patrón "re-exportar Zod desde el barrel lite". Agregar un test adicional estático que rechace, en cada archivo `public.ts` (no `public.schemas.ts` ni `public.server.ts`), cualquier re-export que matchee `import.*from.*schemas$` o `import.*from.*schemas\.ts$` excepto los explicitamente whitelistados (probablemente cero después de F1).

### S2 — Test estático "no `next/dynamic` en components que cargan editor/realtime"

Asegurar que si alguien futuro reintroduce `next/dynamic` para el composer o thread-presence, el test falla. Heurística: en `src/features/discussions/ui/*.tsx` y `src/features/rich-text/composers/ui/*.tsx`, prohibir `from 'next/dynamic'` excepto en files cuya línea 1-2 declara explícitamente `// next/dynamic permitido — ver ADR XXX`. Un test grep simple lo cubre.

### S3 — CI check de tamaño de bundle

Agregar a `pnpm ci` (o como step paralelo en GH Actions) un check del First Load JS reportado por Next build:

- Lectura ≤200 kB (margen 5 kB sobre target 195).
- Creación ≤310 kB (margen 10 kB sobre target 300).
- Build falla si supera. Criterio: el output de `pnpm build` se parsea con un script (~30 LOC en `scripts/perf/check-bundle-budget.ts`) y compara contra un JSON de budgets versionado.

Esto es **defensa profunda**: ESLint + boundaries + budgets. Cualquier regresión bloquea el merge.

### S4 — Smoke E2E de cada lazy

Después de F3 y F5, agregar specs E2E que validan:

- Thread page como admin: kebab clickeable → dropdown aparece tras spinner. (cubre F3)
- DwellTracker arma post-FCP: navegar al thread, esperar 5s, verificar que `markPostReadAction` se disparó. (cubre F5 dwell-tracker)
- Community switcher: click al logo, dropdown aparece tras spinner, click a otro place, navegación cross-subdomain. (cubre F5 community switcher)

### S5 — Rollback triggers explícitos

Cada sub-fase tiene un criterio claro:

- **F1**: si tras el split, `pnpm build` reporta First Load >225 kB en pages de lectura → revert + investigar (sospecha: Server Action que se trazó client por accidente).
- **F2**: si los íconos inline tienen layout shift visible (>2px) → revert los 4 archivos, re-evaluar viewBox.
- **F3**: si el primer click admin tarda >300ms → ajustar `<AdminMenu>` para preload del chunk en hover (no en click) — patrón intermedio.
- **F4**: si el chunk no tiene causa identificable tras 1 sesión → ABRIR como Fase 2.5 separada, no bloquear Fase 2.
- **F5 dwell-tracker**: si la métrica de readers cae >5% después de deploy → revert + mantener eager.
- **F5 community switcher**: si el dropdown se siente lento (>200ms al primer click) → preload-on-hover (intermedio entre eager y on-click).

### S6 — Gotcha CLAUDE.md actualizado

Después de F1, agregar gotcha: "**Re-exportar `from './schemas'` desde un barrel `public.ts` arrastra Zod (35 kB gzip) al chunk eager de cualquier Client Component que importe del barrel** — Zod no es marcable como side-effect-free porque sus schemas registran refinements. Usar `<slice>/public.schemas.ts` para schemas Zod runtime; mantener `public.ts` lite con sólo types, helpers puros, Server Actions, y UI."

## Alineación con CLAUDE.md y architecture.md

Checklist explícito:

- [x] **LOC caps respetados**:
  - F1: nuevos archivos `public.schemas.ts` ≤80 LOC c/u (sólo re-exports).
  - F2: 4 íconos inline ≤30 LOC c/u.
  - F3: `admin-menu-lazy.tsx` ≤80 LOC; refactor de 5 admin menus mantiene ≤300 LOC c/u.
  - F5: `dwell-tracker-lazy.tsx` ≤90 LOC; `community-switcher-lazy.tsx` ≤80 LOC.
- [x] **Vertical slices respetados**: ningún slice nuevo. F1 extiende barrels existentes con sibling `public.schemas`. F2 mete iconos en `shared/ui/icons/` (shared, no feature). F3 mete `admin-menu-lazy` en `shared/ui/` (shared). F5 mantiene Lazy wrappers dentro del slice del componente real (`discussions/ui/`, `shell/ui/`).
- [x] **Boundary rule honrada**: F1 sólo extiende la regla del ADR `2026-05-08-sub-slice-cross-public.md` con `public.schemas` (siblings). F3 y F5 son intra-slice (no cruzan).
- [x] **`shared/` no importa de `features/`**: F2 (icons) y F3 (admin-menu-lazy) viven en `shared/`, NO importan features. F5 community-switcher-lazy vive en `shell/`, importa places via `@/features/places/public` (ya el caso).
- [x] **Server Components por default, Client donde hace falta**: F5 reduce Client surface (BackButton → Server, CommunitySwitcher dropdown → lazy). Alineado con principio.
- [x] **Tipos estrictos, no `any`**: todos los nuevos archivos respetan strict mode.
- [x] **Validación con Zod para input externo**: NO se modifica el contrato de validación; sólo se redistribuye dónde viven los schemas. Server Actions siguen validando con Zod (path interno al slice).
- [x] **Tailwind sólo layout/spacing**: F2 íconos heredan `currentColor` de tailwind, sin colores hardcoded.
- [x] **Spec-first**: cada sub-fase produce ADR cuando cambia el paradigma (F1 → addendum al ADR `2026-05-08-sub-slice-cross-public`; F6 → ADR consolidado de Fase 2).
- [x] **Cozytech**: F3 lazy del admin menu tiene "Cargando…" mínimo, sin shimmer. F5 community switcher idem. Nada parpadea.
- [x] **Una sesión = una cosa**: 6 sub-fases × 1-2 sesiones cada una. Ninguna sesión mezcla backend con frontend.
- [x] **Verificación auto**: cada sub-fase corre `pnpm typecheck && pnpm lint && pnpm test && ANALYZE=true pnpm build` antes de cerrarse.
- [x] **Documentar decisiones**: ADR final F6.

## Próximo paso

Ejecutar **F1 — Split `public.schemas.ts`** como primera sesión. Es la más alta ROI (Zod 35 kB es el chunk más pesado del shell remanente), establece el patrón replicable, y desbloquea la confianza de que el split de barrels es el camino correcto para Fase 2 entera.
