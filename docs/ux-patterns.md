# UX/UI patterns — settings pages

Canonical patterns from the `/settings/hours` redesign (May 2026, iter post-feedback May 11). Use them when redesigning the rest of the settings pages — access, editor, members, groups, tiers, library, flags. Each pattern earned its place by solving a specific failure mode (overflow at 360px, hydration mismatch, race conditions on bulk ops, accidental tap-on-scroll, destructive ops without confirm). Rejected approaches are listed in Anti-patterns at the end so future agents don't re-derive the wrong answer.

The goal is mechanical reuse: a future implementer should apply these patterns without re-reading the entire `features/hours` slice. See § "Per-feature application matrix" near the end for a per-page checklist of what to apply where.

## Anchor principles

When a new situation isn't covered, fall back to these meta-rules:

1. **Mobile-first.** Validate at 360px viewport. Touch targets ≥ 44px tall. Inputs ≥ 16px font (iOS auto-zooms anything smaller).
2. **Single source of truth in form state.** RHF `useFieldArray` lives only in the form orchestrator; children get callbacks. No double instances. No state mirrored in component-local `useState` for the same data.
3. **The user controls commits — todo manual.** Cualquier mutación aplica solo localmente; el user persiste con UN tap en "Guardar cambios" page-level. NO hay autosave por gesto. Razón: el modelo previo "soft barrier" (autosave si limpio, defer si dirty) era impredecible — el mismo gesto tenía 2 comportamientos. Ver § "Save model — todo manual".
4. **Acciones destructivas requieren confirmación SIEMPRE.** El primitive `<RowActions>` aplica el confirm dialog automáticamente para cualquier action con `destructive: true`. Forms con destructive standalone usan `<Dialog>` o el patrón inline "Eliminar → ¿Sí, eliminar?".
5. **Acciones fuera del scroll path en mobile.** Botones full-width en el body de cards son propensos a tap accidental durante scroll vertical. Las acciones del card viven en su 3-dots header o como chips pequeños inline. Ver § "Acciones fuera del scroll path".
6. **Locale respect.** Time/date formatting follows the viewer's locale via `Intl.*`. Canonical values (`HH:MM`, `YYYY-MM-DD`) live in the schema; presentation is downstream.

---

## Page padding standard

**What.** Every settings sub-page wraps content in `<div className="space-y-6 px-3 py-6 md:px-4 md:py-8">`. 12px horizontal on mobile, 16px on `md:` and up.

**Why.** A 360px viewport with `p-8` (32px) leaves only ~296px useful — the old hours form (4 inputs in a horizontal grid) overflowed and produced horizontal scroll. Reducing to 12px gains 40px useful width and matches `<TopBar>` (`px-3`), so the gated zone and settings stop looking like two different apps. Full rationale in `docs/decisions/2026-05-03-mobile-first-page-padding.md`.

**When to use.** All `/settings/*` sub-pages.

**When NOT to use.** Gated zone pages (conversations, library list) intentionally have no wrapper padding — their items apply `mx-3` per-component. Don't override.

**How.** See `src/app/[placeSlug]/settings/hours/page.tsx:52`.

**Pitfalls.** Vertical padding is per-page based on density. `space-y-6` is the gap between sections; sections manage their own internal spacing.

## `<PageHeader>` for the title

**What.** Every settings sub-page renders its title via `<PageHeader title="..." description="..." />`. No `<h1>` inline.

**Why.** Before this primitive, each page invented its own header — some had breadcrumbs (`Settings · The Company`), some had a back button, type sizes drifted. Breadcrumbs duplicated context the URL + `SettingsNavFab` already provide. The primitive provides one shape: `font-serif text-2xl md:text-3xl` h1, optional 1-line description, optional `actions` slot for buttons (right on desktop / stacked on mobile).

**When to use.** Settings sub-pages and any page that needs a title + description + optional actions row.

**When NOT to use.** Gated zone pages where the title is implicit in the route. Member detail pages where the avatar/name composition is the visual title.

**How.** `<PageHeader title="Horario" description="..." />` — see `src/app/[placeSlug]/settings/hours/page.tsx:53` and `src/shared/ui/page-header.tsx`.

**Pitfalls.** Don't pass `Settings · ${placeName}` as the title — that's chrome. The component sets `mb-6` itself; don't add a margin from outside.

## Section grouping with semantic headings

**What.** Group related controls in `<section aria-labelledby="<id>">` with `<h2 className="font-serif text-xl pb-2 border-b" style={{ borderColor: 'var(--border)' }}>`. The h2's `id` matches `aria-labelledby`.

**Why.** Communicates structure to assistive tech and to the eye without resorting to cards (visual weight, doesn't scale on mobile), accordions (hides controls behind a click), or tabs (hides cross-cutting context — admins doing bulk hour edits need timezone + recurring + exceptions visible together to validate consistency). The border-b under the h2 is enough visual rhythm at this density.

**When to use.** Any settings page with two or more distinct configuration concerns (timezone vs schedule vs exceptions; member roles vs invitation policy vs etc.).

**When NOT to use.** A page with one concern. One `<PageHeader>` + the controls is enough.

**How.** See `src/features/hours/admin/ui/hours-form.tsx`.

**Pitfalls.** Don't use `<details>`/`<summary>` to "save space" — settings pages should show everything. Don't use tabs for ≤3 sections.

## Color palette & button styles

**What.** Settings sub-pages use **raw Tailwind neutral classes** (`bg-neutral-900`, `text-neutral-600`, `border-neutral-300`) for all chrome — buttons, borders, dividers, dropdown triggers, inputs, labels. CSS custom properties (`var(--accent)`, `var(--text)`, `var(--bg)`, `var(--muted)`, `var(--border)`) are reserved for the place's brand identity surfaces _outside_ settings (member avatars, category cards in `/library`, the reading view, etc.).

**Why.** Settings is admin chrome — calm, high-contrast, legible regardless of the place palette. If every settings page used `bg-accent` for its primary CTA, the brand color stops meaning "interactive" in the rest of the app and CTAs can become invisible on low-contrast palettes. The hours redesign set the canonical and it now binds the rest of `/settings/*`. The single concession: the `border-b` under each `<h2>` uses `style={{ borderColor: 'var(--border)' }}` — that's the only place where `var(--border)` appears in settings.

**Canonical button styles.**

- **Primary CTA in a sheet footer** — `inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white`. Black solid bar. Copy del botón del sheet: **"Listo"** (= aplicar cambio local, queda dirty hasta que el user toque "Guardar cambios" page-level). NUNCA "Guardar" en un sheet — eso es el botón page-level. Para forms standalone (sin parent dirty state, e.g. crear categoría desde page propia), copy = "Crear categoría", "Invitar miembro", etc. Disabled state: add `disabled:opacity-60`.
- **Secondary CTA in a sheet footer (Cancel)** — `inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-300 px-4 text-sm`. Outlined, full-width, neutral.
- **Destructive single action** — `inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 text-sm font-medium text-red-600 hover:bg-red-50` collapsed; the confirmed pair is `[Cancelar (border-neutral-300), Sí, eliminar (border-red-600 bg-red-600 text-white)]`.
- **Recoverable destructive (archive)** — amber semantic: `border border-amber-300 bg-amber-50 text-amber-900`. Distinct from red; signals "reversible, but think twice". Use for soft-delete only.
- **"Add another to the list" trigger** (placed _after_ a list of items) — `inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 px-4 text-sm font-medium text-neutral-600 hover:border-neutral-500`. Prefix with `<span aria-hidden>+</span> Texto`. Used for "+ Añadir horario", "+ Agregar excepción", "+ Nueva categoría". Never use a solid filled accent button for this affordance — it competes with the primary CTAs in sheets and reads as if "Nueva" were a destructive global action.
- **Per-item dropdown trigger** (3-dots) — `inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100`. SVG `h-5 w-5` with `fill="none" stroke="currentColor" strokeWidth="2"`. Don't use `text-muted` (`var(--muted)` resolves too light against `var(--bg)` cream and the affordance disappears).

**Canonical input styles.**

- All single-line inputs: `block w-full min-h-[44px] rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base focus:border-neutral-500 focus:outline-none`. Apply to `<input type="time" | "date" | "text" | "email">`, `<select>`, `<textarea>` (with `min-h-` adjusted).
- Add `tabular-nums` on time inputs and any list of times.
- Label: `<span className="mb-1 block text-sm text-neutral-600">…</span>` directly above the input (no `<label htmlFor>` separation).

**Canonical list / divider styles.**

- Row container: `<ul className="divide-y divide-neutral-200 border-y border-neutral-200">`. No `bg-surface`, no rounded card around the list — the cream page background carries through and dividers are enough rhythm.
- Each row: `<li className="flex min-h-[56px] items-center gap-3 py-2">` (or `py-3` if the row needs more breathing room with multi-line content).

**When to use.** Every `/settings/*` sub-page after this doc. When in doubt, copy the class strings from `src/features/hours/admin/ui/week-editor-window-sheet.tsx` and `src/features/hours/admin/ui/week-editor-day-card.tsx`.

**When NOT to use.** Outside `/settings/*` — gated zone components (conversations, library reading view, member profile, place home) keep `var(--accent)` / `var(--text)` / `var(--bg)`. That's where brand identity lives.

**Pitfalls.**

- Don't use `bg-accent text-bg` for sheet submit buttons inside settings. It maps to the brand color and breaks the chrome / brand separation.
- Don't replace `border-neutral-300` with `border-border` in settings sheets — the CSS-var version drifts when admins customise the palette and can become invisible.
- Don't use `text-muted` for actionable affordances like 3-dot triggers. `text-neutral-600` is the floor for interactive icons in settings.
- Destructive UI is red (`red-600`). Amber (`amber-50` / `amber-300` / `amber-900`) is reserved for recoverable destructive (archive / hide) and warnings. Never mix.
- El "+ add" affordance vive en el header del card (3-dots) cuando es per-card add (e.g. "Agregar ventana al Lunes"). Para listas planas sin cards (e.g. excepciones de hours, invitaciones), un dashed-border bottom-of-list está OK. NUNCA top-right filled accent button — competen con CTAs primarios y leen como global destructive.

## Container queries: cuándo SÍ y cuándo NO

**Estado actual (2026-05-10)**: NO usamos container queries en el codebase. Todos los componentes responsive usan media queries (Tailwind `md:`/`lg:`).

**Por qué:** los componentes que viven en widths "variables" hoy NO tienen layouts variables. Concretamente:

- AppShell aplica `max-w-[420px]` constante en gated zone (donde viven `member-card`, `event-list-item`, `library-item-row`).
- Settings sub-pages aplican `max-w-screen-md` constante (forms y master pane).
- Master-detail (groups) split desktop tiene UN solo `_group-detail-content.tsx` que se renderea idéntico independiente del width del pane.

Bajo estas condiciones, instalar `@tailwindcss/container-queries` + migrar componentes a `@container` agregaría dependencia + complejidad cognitiva sin beneficio. Media queries cubren el 100% de casos reales hoy.

**Cuándo AGREGAR container queries**: si emerge un componente que se renderea en widths SIGNIFICATIVAMENTE distintos según contexto y necesita layouts distintos:

- Mismo `<MemberCard>` en sidebar de 280px (avatar arriba, label abajo) vs feed de 720px (avatar inline, label al lado).
- Mismo `<LibraryItemCard>` en grid de 2 col mobile vs grid de 4 col desktop con misma estructura interna.
- Otro caso similar: el contenido del componente se vería raro/torpe si forzáramos UN solo layout.

En ese momento:

1. `pnpm add -D @tailwindcss/container-queries`
2. Agregar al `tailwind.config.ts` `plugins: [require('@tailwindcss/container-queries')]`
3. En el componente afectado: `<div className="@container">...<div className="@md:flex">...</div></div>`
4. Documentar el caso aquí (qué componente, qué contextos, por qué media queries no alcanzaban).

**No usar container queries para "preparar para el futuro"**: agregar `@container` wrappers ahora "por si acaso" es over-engineering. Prefiere agregar cuando emerja necesidad concreta.

## Master-detail layout (lista + detalle)

**What.** Settings sub-pages with a list of items where each item has its own detail (groups, library categories, members) use a layout-shared list + child page detail pattern. Mobile: stack navigation. Desktop: split view 360px lista + detail pane.

**How.**

```
settings/<feature>/
├── layout.tsx               ← gate + lista cargada inline + <MasterDetailLayout master={lista} detail={children} hasDetail={pathnameHasId}>
├── page.tsx                 ← children placeholder en /settings/<feature>: "Elegí un item"
└── [itemId]/page.tsx        ← children detail en /settings/<feature>/[itemId]: GroupDetailContent / etc
```

Cuando navegás de `/settings/<feature>` a `/settings/<feature>/[itemId]`, **Next 15 reusa el layout** (decisión documentada). La lista server-rendered en el layout NO se re-fetchea — la transición desktop es solo un cambio de detail pane, sin reload visual de la lista.

**Cómo `<MasterDetailLayout>` decide qué pane mostrar (mobile)**: el layout deriva `hasDetail` del header `x-pathname` que setea el middleware (`/^\/settings\/<feature>\/[^/]+/`). Mobile esconde el pane que no aplica. Desktop muestra ambos.

**Why this approach (not alternatives).**

- ❌ **Parallel Routes (`@detail/` slot)**: probado y descartado. Causa duplicación cuando ambos children y slot matchean la misma ruta. Más complejo, menos auditable. Bug fix commit `60c777e`.
- ❌ **page.tsx independiente sin layout shared**: la lista se re-fetchea en cada navegación → page reload visual en desktop al cambiar de detail.
- ❌ **`default.tsx` en raíz**: solo aplica con Parallel Routes. Sin slots, el URL `/settings/<feature>` da 404 sin `page.tsx` real. Bug fix commit `<este>`.

**When to use.** Sub-pages tipo "lista de items administrables, cada uno con detail page propio": groups (✓ implementado), futuro library/members/tiers cuando se rediseñen.

**When NOT to use.** Sub-pages tipo single form (hours, access, editor, flags) — esas usan max-w-screen-md mx-auto centered, sin master pane.

**Pitfalls.**

- El layout debe cargar la lista una vez. Si se mueve a `page.tsx` el patrón se rompe (se re-fetchea en cada nav).
- El back link del detail debe ser `md:hidden` — visible en mobile (donde la lista no se ve), oculto en desktop (donde la lista master ya está visible al lado).
- El gate (auth + perms) puede vivir en el layout (compartido) o en cada page (defensa en profundidad). Settings/groups lo tiene en layout porque el shell padre ya validó admin/owner.

**How.** Reference implementation: `src/app/[placeSlug]/settings/groups/{layout,page,_group-detail-content}.tsx` + `[groupId]/page.tsx`.

## Card-per-item con header + body + switch on/off

**What.** Para listas de items administrables donde cada item tiene **estado on/off** y **acciones contextuales**, usar el patrón canonizado en `week-editor-day-card.tsx`:

```
┌─ <NombreItem> ───── <estado> · ⋮ · [●─] ─┐
│                                            │
│  ( chip-info-1 )  ( chip-info-2 )          │
│                                            │
└────────────────────────────────────────────┘
```

**Estructura:**

- **Container:** `<div className="rounded-md border border-neutral-200">`
- **Header (siempre visible):** `<div className="flex min-h-[56px] items-center gap-2 px-3 ${isOn ? 'border-b border-neutral-200' : ''}">`
  - Nombre del item (`<span className="flex-1 text-base font-medium text-neutral-900">`)
  - Label de estado (`<span className="text-xs text-neutral-500">{isOn ? 'Abierto' : 'Cerrado'}</span>` — copy específico del dominio)
  - Overflow menu 3-dots (solo cuando `isOn` y hay acciones contextuales). Patrón en § "Acciones fuera del scroll path".
  - Switch on/off (`<button role="switch" aria-checked>` con thumb h-5 w-5 dentro de track h-6 w-11)
- **Body (solo cuando ON):** `<div className="flex flex-wrap items-center gap-2 px-3 py-3">`
  - Chips de info (ventanas, tags, configuración expandible)
  - Cada chip envuelto en `<RowActions>` con sus per-item actions

**Comportamiento del switch:**

- **OFF → ON:** abre BottomSheet add con el item como contexto (no muta state directo — el user agrega el primer dato).
- **ON → OFF:** dispara bulk delete vía `onReplace(arrayWithoutThisItem)` — NO autosave, queda dirty para "Guardar cambios". Sin confirm modal — es reversible vía toggle ON.

**When to use.** Listas de items con estado binario (días abierto/cerrado, feature flags on/off, tiers activos/inactivos, library categories visibles/ocultas). El switch comunica visualmente "este item está activo" sin texto extra.

**When NOT to use.**

- Items con >2 estados (e.g. member roles owner/admin/member): usar dropdown selector, no switch.
- Items sin sub-data expandible (e.g. lista plana de invitaciones pendientes): usar `<ul className="divide-y">` con rows simples, sin cards.
- Items que viven en grid (e.g. category cards de library con cover image): usar grid layout, no cards-stacked.

**Why.**

- WYSIWYG total: el user ve qué items están on/off sin tener que tap o expandir.
- Switch de plataforma (iOS Settings) es un control conocido — cero friction de aprendizaje.
- Stashed data: switch OFF preserva el sub-data del item localmente (RHF state) — toggle ON re-inflate sin pérdida.

**How.** Reference implementation: `src/features/hours/admin/ui/week-editor-day-card.tsx` (~210 LOC) + orquestador `src/features/hours/admin/ui/week-editor.tsx` (renderiza UNA card por cada item siempre, no condicional por `presentItems`).

**Pitfalls.**

- Renderear los 7/N items SIEMPRE, no solo los con sub-data. Hidden state confunde — el user no sabe qué le falta configurar.
- Switch icon 5×5 dentro de track 6×11 — el contenedor padre debe tener `min-h-[56px]` para garantizar touch target ≥44px (el switch en sí mide 24×44px).
- `border-b border-neutral-200` en el header SOLO cuando `isOn` — sin body, sin border (visualmente colapsa a una row simple).
- Si el item tiene N>1 sub-data (e.g. múltiples ventanas en un día), usar `flex-wrap` en el body para que chips wrappeen a 2da línea sin overflow.

## Acciones fuera del scroll path

**What.** Las acciones del card NO viven en su body como botones full-width. Viven en:

1. **3-dots overflow del header** del card (`<DropdownMenu>` con items textuales).
2. **Chips de `<RowActions>`** en el body cuando aplican a UN sub-item específico (cada chip lleva sus propios icon buttons inline).

**Por qué.** En mobile, el browser tiene threshold ~10px de movement antes de distinguir scroll de tap. Un dedo apoyado en un botón `min-h-11 w-full` durante swipe vertical puede activarlo accidentalmente. Botones grandes maximizan superficie de error. Mantener el body del card libre de botones full-width hace el scroll 100% safe.

**Reglas:**

- **Body del card:** solo chips de info (con sus propios `<RowActions>`) o display-only content. **Cero buttons full-width.**
- **Acciones que aplican al card entero** (e.g. "Agregar ventana", "Copiar a otros días", "Renombrar grupo"): viven en el menu 3-dots del header del card.
- **Acciones por sub-item** (e.g. editar/eliminar ventana específica): viven en el chip via `<RowActions>` (lápiz + trashcan inline en cualquier viewport).
- **Acción primaria del page-level** (e.g. "Guardar cambios", "Crear place"): puede ser full-width — vive ABAJO de todo el contenido scrolleable, no en medio. El user llega a ese botón después de scroll completo.

**When to use.** Cualquier card en una lista de cards scrolleable de settings. Aplica a hours days, futuro flags, futuro tiers, etc.

**When NOT to use.** Forms standalone (no embebidos en lista) donde el primary CTA está al final natural — ahí el botón sí puede ser full-width porque NO está en scroll path mid-flow.

**How.** El header del card incluye el 3-dots cuando hay acciones del card-level:

```tsx
<div className="flex min-h-[56px] items-center gap-2 px-3 border-b">
  <span className="flex-1 ...">{itemName}</span>
  <span className="text-xs text-neutral-500">{statusLabel}</span>
  {isOn ? <CardOverflowMenu actions={cardActions} /> : null}
  <ItemSwitch isOn={isOn} onToggle={...} />
</div>
```

Reference: `src/features/hours/admin/ui/week-editor-day-card.tsx` § `DayOverflowMenu`.

**Pitfalls.**

- No reintroducir botones full-width "+ Agregar X" o "Copiar a..." en el body del card "para visibilidad". El 3-dots es discoverable y mantiene el body safe.
- El 3-dots solo aparece cuando hay acciones (e.g. cuando el card está ON). En estado OFF, el header tiene solo nombre + estado + switch.
- `<DropdownMenuSeparator>` entre grupos de acciones (e.g. "Agregar X" vs "Copiar a Y") — comunica jerarquía sin overhead visual.

## Confirm dialog automático para destructive actions

**What.** El primitive `<RowActions>` aplica un confirm dialog modal automáticamente cuando una `RowAction` tiene `destructive: true`. El `onSelect` NO se ejecuta directo — se abre el dialog primero. Solo si el user confirma, se invoca.

**Por qué.** Toda acción destructiva requiere confirmación (Anchor principle #4). Centralizar esto en el primitive convierte el flag `destructive: true` en contrato fuerte: imposible olvidar agregar confirm a una destructive nueva.

**API:**

```tsx
{
  icon: <Trash2 ...>,
  label: 'Eliminar',
  onSelect: () => handleDelete(item.id),
  destructive: true,
  // Customización opcional del copy:
  confirmTitle: '¿Eliminar ventana 09:00 → 17:00?',
  confirmDescription: 'Se eliminará del Lunes. Podés agregarla de nuevo después.',
  confirmActionLabel: 'Sí, eliminar',
}
```

**Defaults derivados** (cuando no se override):

- `confirmTitle`: `¿{label}?` (ej. "¿Eliminar?")
- `confirmDescription`: "Esta acción no se puede deshacer."
- `confirmActionLabel`: `Sí, ${label.toLowerCase()}`

**Comportamiento:**

- Click en action destructive → abre Dialog modal.
- Focus default en "Cancelar" (convención HIG — destructive nunca es default).
- ESC, click outside, X = Cancel (nunca Confirm).
- Botón "Sí, ..." es rojo (`bg-red-600 text-white border-red-600`).

**When to use.** Cualquier action destructiva dentro de un `<RowActions>` (eliminar item, eliminar ventana, expulsar member, archivar place). El primitive lo maneja automáticamente.

**When NOT to use.** Destructives standalone que NO viven en `<RowActions>` (e.g. botón "Eliminar place" page-level): usar `<Dialog>` directamente o el patrón inline "Eliminar → ¿Sí, eliminar?" en el footer del sheet.

**How.** Ver `src/shared/ui/row-actions.tsx` § `ConfirmDialog`. Reference customization: `src/features/hours/admin/ui/week-editor-day-card.tsx` (delete chip ventana con título contextual).

**Pitfalls.**

- Custom `confirmTitle` con datos del item ayuda al user (vs default genérico). Hacé el esfuerzo de pasarlo cuando hay contexto útil.
- NO uses `destructive: true` para actions reversibles (e.g. "Archivar" que se puede des-archivar). Para esas, el patrón "amber semantic" — sin confirm forzado, color ámbar en vez de rojo.
- Si el callsite necesita confirmación CON inputs adicionales (e.g. "Escribí el nombre del place para confirmar"), el primitive no cubre ese case — usar `<Dialog>` custom.

## `<BottomSheet>` for add / edit forms

**What.** Forms with multiple inputs (time pickers, day picker, radios) open in a `<BottomSheet>` anchored to the bottom of the viewport — not a centered `<Dialog>`, not inline.

**Why.** Inline forms break flow on mobile — the form pushes content down, scroll jumps, the user loses orientation. Centered `<Dialog>` works on desktop but on mobile lands above thumb-zone — primary CTAs require a thumb stretch. A bottom sheet anchors CTAs in the lower half (thumb-friendly), keeps page state visible behind a backdrop (context preserved), scrolls internally up to `max-h-[85vh]`, and the sticky footer reserves `safe-area-inset-bottom` so the iOS home indicator never covers the primary CTA.

**When to use.**

- Form with ≥2 inputs invoked from a list/row in settings.
- Mobile is the primary case.
- Keeping context behind the backdrop matters (e.g. seeing the rest of the week while editing one window).

**When NOT to use.**

- Confirms / short alerts ("¿Eliminar?") — use `<Dialog>`.
- Forms that take the entire page (e.g. a long wizard) — those are their own route.
- A single-input action like "rename" — a `<DropdownMenuItem>` with an inline prompt is lighter.

**How.** `<BottomSheet open={...} onOpenChange={...}><BottomSheetContent>...</BottomSheetContent></BottomSheet>`. Structure with `<BottomSheetHeader>` (`<BottomSheetTitle>` is required by Radix for `aria-labelledby`), `<BottomSheetBody>` (scrollable), `<BottomSheetFooter>` (sticky CTAs). See `src/shared/ui/bottom-sheet.tsx` and `src/features/hours/admin/ui/week-editor-window-sheet.tsx`.

### The 2-modes pattern (add / edit)

The same sheet handles `add` / `edit` via a discriminated union state:

```ts
type SheetState =
  | { mode: 'closed' }
  | { mode: 'add'; day: DayOfWeek }
  | { mode: 'edit'; day: DayOfWeek; index: number; start: string; end: string }
```

Same form layout, mismo botón **"Listo"** (NO "Guardar" — ese es el page-level); en `edit` mode aparece "Eliminar" → "¿Sí, eliminar?" inline en el footer (o el primitive `<RowActions>` cuando aplica). Reusing the same sheet keeps the visual language consistent.

**Pitfalls.**

- `aria-describedby={undefined}` on `<BottomSheetContent>` is intentional when there's no separate description.
- Don't render the inner sheet form unless `open` — otherwise initial-state hooks (`useState`) run with stale defaults.
- The sheet portals to `<body>` — pass state via the `SheetState` discriminated union, not parent context.
- Si tu sheet necesita un 3er mode (e.g. day picker para add-new-day en hours iter previa), preferí refactorizar el flujo a UN solo entry point en lugar de inflar el discriminated union. La iter actual de hours eliminó `add-new-day` cuando los 7 días pasaron a tener su propio switch.

## Per-row actions (`<RowActions>`) — layout unificado

**What.** Single primitive for per-row actions. **Layout unificado mobile + desktop**: chip display-only + icon buttons al lado en cualquier viewport.

**Iter previa (hasta 2026-05-11):** mobile usaba chip-as-dropdown-trigger (sin icons visibles), desktop chip + icons. Cambiado a layout unificado por feedback UX: los iconos lápiz/trashcan deben ser visibles en ambos viewports para que el user descubra la acción sin un tap extra. Trade-off aceptado: el chip + 2 íconos + gaps ocupan ~250px, con múltiples chips por row hacen `flex-wrap` a 2da línea — aceptable.

```tsx
<RowActions
  triggerLabel="Opciones para ventana 09:00 a 17:00 del Lunes"
  chipClassName="rounded-full border px-3 py-2 text-sm tabular-nums"
  actions={[
    { icon: <Pencil className="h-4 w-4" />, label: 'Editar', onSelect: handleEdit },
    {
      icon: <Trash2 className="h-4 w-4" />,
      label: 'Eliminar',
      onSelect: handleDelete,
      destructive: true,
    },
  ]}
>
  09:00 → 17:00
</RowActions>
```

**Behavior.**

- **1-3 actions (InlineMode)**: chip display-only span + `actions[].icon` rendered as `<button aria-label={label}>` next to the chip. Same layout en ambos viewports.
- **Overflow** (`actions.length > 3`): chip + kebab `...` dropdown. 4+ icons inline pierden claridad y fuerzan wrap denso.
- **Destructive ⇒ confirm dialog automático**: cualquier action con `destructive: true` abre un Dialog modal en lugar de ejecutar `onSelect` directo. Cancelar (focus default) o "Sí, eliminar". Customizable vía `confirmTitle`, `confirmDescription`, `confirmActionLabel`.

**Why.** Descubrimiento de acciones > densidad horizontal. Los iconos visibles inline en mobile permiten 1-tap edit/eliminar sin pasar por dropdown. El trade de width adicional se asume — `flex-wrap` cubre el case de múltiples chips.

**When to use.** Per-row actions in lists/grids where each item has 1-3 primary actions and you want optimal UX in both viewports. Replaces the manual chip-as-DropdownMenuTrigger pattern from settings sub-pages.

**When NOT to use.**

- Standalone overflow kebab without a chip (e.g. day-row overflow with "Add another window" / "Copy to all"): use `<DropdownMenu>` directly — `<RowActions>` requires a chip children.
- Single-action items: just use a labelled button.
- Bulk-selection actions (footer toolbar style): `<RowActions>` is per-item.

**How.** See `src/shared/ui/row-actions.tsx` (~280 LOC con confirm dialog). Reference usage in `src/features/hours/admin/ui/week-editor-day-card.tsx`.

**Pitfalls.**

- `chipClassName` is applied al span del chip. El primitive ya no envuelve el chip en un button — es display-only.
- `actions[].destructive` activates `text-red-600` styling en el icon button + abre el confirm dialog automático. Use it for delete/archive only.
- Touch targets: cada icon button es `min-h-11 min-w-11` (44px). Don't override.
- Customize confirm copy con `confirmTitle`, `confirmDescription`, `confirmActionLabel` cuando el contexto importa (e.g. "¿Eliminar ventana 09:00→17:00?" en lugar del default "¿Eliminar?").
- ESC / click outside del confirm dialog se trata como Cancel — nunca como Confirm.

## Save model — todo manual (consistente)

**What.** Cualquier mutación del form (add/edit/remove ventana, add/edit/remove excepción, toggle día, copyTo, timezone, 24/7) aplica SOLO localmente. RHF marca `formState.isDirty` automáticamente. El user confirma todos los cambios pendientes con UN tap en el botón page-level "Guardar cambios".

**Why.** Iter previa "autosave con soft barrier" (single-item ops autosaveaban si el form estaba limpio, bulk ops requerían Save) era confuso: el mismo gesto (eliminar una ventana) tenía dos comportamientos distintos según el estado dirty del form. Modelo "todo manual" es predecible: el user siempre sabe cuándo se persiste (cuando toca "Guardar cambios").

**When to use.** Forms con múltiples mutaciones discretas donde el user puede querer revisar el resultado antes de commitear (settings, config, schedules).

**When NOT to use.** Forms con UNA sola mutación clara (e.g. crear post, send mensaje) — submit directo es más simple.

**How.** Handlers solo mutan via RHF (`recurring.append`, `recurring.remove`, etc). Sin `commitOrDefer`, sin `snapshot()`, sin toasts por mutation. El indicator visual del botón "Guardar cambios" + label "• Cambios sin guardar" señalan el estado dirty.

```ts
function handleAddRecurring(w: RecurringWindow) {
  recurring.append(w)
  // Eso es todo. RHF marca dirty. El user toca "Guardar cambios" cuando quiere persistir.
}
```

**Sub-form buttons:** botones dentro de BottomSheet/EditPanel (como el de add/edit ventana) dicen "Listo" — NO "Guardar". Diferenciación importante: "Listo" = aplicar cambio local; "Guardar cambios" page-level = persistir todos los pendientes a DB.

See `src/features/hours/admin/ui/hours-form.tsx`.

**Pitfalls.**

- `recurring.append/update/remove/replace` flip `isDirty` synchronously — el botón Save se enciende inmediato.
- `methods.reset(snapshot)` en el `persist()` post-success re-baseliña dirty.
- No reintroducir autosave por chip — anti-pattern documentado abajo.

## `persist()` helper as the single commit path

**What.** One function inside the form orchestrator validates the payload, calls the Server Action, and on success calls `methods.reset(snapshot)` to mark the new baseline. El único caller es `onSubmit` (botón "Guardar cambios" page-level) — no hay autosaves bajo el modelo "todo manual".

**Why.** Centraliza validación + error mapping + baseline reset. Forgetting `methods.reset(snapshot)` después del save deja `formState.isDirty === true` even after a successful save, making the dirty indicator and Save button lie.

**How.** See `src/features/hours/admin/ui/hours-form.tsx`. The `snapshot` argument is the source of truth for the payload — never read `methods.getValues()` inside the helper.

**Pitfalls.** `methods.reset(snapshot)` re-baselines `defaultValues`. Without it, the user sees "Cambios sin guardar" forever.

## Dirty indicator + Save button via `formState.isDirty`

**What.** The Save button is `disabled={pending || !formState.isDirty}`. A subtle "• Cambios sin guardar" label appears next to it when `formState.isDirty && !pending`, with `aria-live="polite"`.

**Why.** Disabling when nothing is dirty prevents the user from clicking and getting a no-op (and a useless success toast). The label gives a calm, persistent signal — no flashing, no banner. `aria-live="polite"` lets screen readers announce without interrupting.

**How.** See `src/features/hours/admin/ui/hours-form.tsx`.

**Pitfalls.** Don't add a separate `useState` mirror — RHF owns this. `methods.reset(snapshot)` after each successful persist is what keeps `isDirty` accurate.

## Toast over inline banner for save feedback

**What.** Use `toast.success`/`toast.error`/`toast.info` (Sonner re-exported from `@/shared/ui/toaster`) for save outcomes. Reserve inline banners (the amber `<div role="alert">`) for client-side validation errors that the user must read next to the field.

**Why.** A user who clicks Save at the bottom of a long form, scrolls up, and gets an inline success banner at the top will never see it. Toasts are visible regardless of scroll. Inline banners stay reserved for "you can't submit because field X is wrong" — the user needs to find the field, so the message belongs near it.

**When to use toast.** Save success, server errors from the action.

**When to use inline banner.** Zod `safeParse` failure on the client before calling the action.

**How.** `import { toast } from '@/shared/ui/toaster'`. The `<Toaster />` is mounted once in `src/app/layout.tsx`. Z-index 60 — above `<Dialog>` and `<BottomSheet>` (50).

**Pitfalls.** Don't `toast.success` _and_ set an inline success banner — pick one. Use the friendly mapper (see below) before passing server errors to toast.

## Single `useFieldArray` per name in the parent

**What.** The form orchestrator (`<HoursForm>`) is the only place that calls `useFieldArray({ control, name: 'recurring' })`. Children receive `fields` and `onAdd`/`onUpdate`/`onRemove`/`onReplace` callbacks.

**Why.** RHF docs are explicit: "If you have multiple `useFieldArray` with the same `name`, only one is effective." Two instances cause silent desyncs — chips that don't update after editing, deletes that vanish from one view but not the other. Centralising también centraliza el commit path por una sola `persist()` (ver § "persist helper").

**How.** Parent invokes `useFieldArray` and passes `fields` (read-only) plus narrow callbacks down. See `src/features/hours/admin/ui/hours-form.tsx` (canonical instance) and `src/features/hours/admin/ui/week-editor.tsx` (child API).

**Pitfalls.**

- Don't call `useFieldArray` again in a child for ergonomic access. Pass callbacks.
- Use `field.id` as React key — never `index` (RHF re-generates IDs on reorder, indexes are not stable).

## `onReplace` callback for bulk transforms

**What.** Bulk operations (copy-to-all, copy-to-weekdays, sort, switch día ON→OFF que borra todas las ventanas) call a single `onReplace(nextArray)` rather than dispatching N `onAdd` + M `onRemove`.

**Why.** N+M sequential callbacks dispatch N+M re-renders + N+M `formState.isDirty` flips. Una sola `replace()` es UNA mutación — el snapshot final es lo que el user va a confirmar con "Guardar cambios".

**How.** See `src/features/hours/admin/ui/week-editor.tsx` (`copyTo` computes `kept + additions` in one pass + `toggleDayOff`) and `src/features/hours/admin/ui/hours-form.tsx` (`handleReplaceRecurring` just calls `recurring.replace(next)`).

**Pitfalls.** `recurring.replace(next)` flips `isDirty` to true — el botón Save se enciende inmediato, esperando confirm explícito.

## Locale-aware time formatting + hydration safety

**What.** `formatTime('HH:MM')` returns the locale-formatted version using `Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })`. Visible text uses `<span suppressHydrationWarning>{formatTime(w.start)}</span>`. The `aria-label` uses raw `HH:MM`.

**Why.** Server (Vercel — usually `en-US`) and client (the viewer's browser) can return different strings for the same time: non-breaking spaces, `"a.m."` vs `"a. m."`. React's hydration check fails on attribute mismatch, and `suppressHydrationWarning` only works on element children — not on attributes. So: locale-formatted text in the visible label (with suppress), canonical `HH:MM` in the attribute (deterministic).

The reason to format at all: `<input type="time">` renders according to browser/OS locale and isn't reliably overridable. If the input shows `9:00 AM` and the chip shows `09:00`, the user sees an inconsistency.

**How.** See `src/features/hours/ui/format-time.ts` and `src/features/hours/admin/ui/week-editor-day-card.tsx`.

**Pitfalls.**

- `suppressHydrationWarning` doesn't propagate from a parent — wrap the specific span.
- Don't use `formatTime()` inside `aria-label` — attribute mismatches can't be suppressed.
- For dates, parse `YYYY-MM-DD` manually (split on `-`) rather than `new Date(date)` — the latter assumes UTC midnight and shifts a day in non-UTC locales. See `formatDateLong` in `src/features/hours/admin/ui/exceptions-editor.tsx`.

## Always-on toggle pattern with stashed data

**What.** A boolean toggle ("Abierto 24/7") replaces a section's editor with a confirmation pill ("El place está abierto las 24 horas, todos los días."). When the toggle is on, the editors are hidden but their data is preserved in DB so toggling back restores everything.

**Why.** The user might want the convenience of "always open" without losing the schedule they spent time configuring. Naive impl: clear the arrays when `alwaysOpen=true`. Failure mode: user toggles on, then off, and discovers their week vanished. Solution: persist `recurring` + `exceptions` even when `kind === 'always_open'` — they're "stashed". `parseOpeningHours` re-inflates them on next load.

**How.** See `src/features/hours/admin/ui/hours-form.tsx` (toggle + conditional render) and `src/app/[placeSlug]/settings/hours/page.tsx` (re-inflation in `hoursToFormDefaults`).

**Pitfalls.** The server action must persist stashed arrays even when they don't apply to the active mode. The schema should validate them only when `kind === 'scheduled'` — otherwise a stashed-but-invalid window blocks toggling on.

## Friendly error messages for stale Server Actions

**What.** The `friendlyMessage(err)` helper detects `Failed to find Server Action` / `Server Action ... not found` and returns a Spanish message instructing the user to refresh.

**Why.** When a deploy hashes a new ID for a Server Action, any open tab with the old ID gets this opaque error on submit. In dev it fires after every HMR of the form; in prod it can hit any user with a tab open during deploy. The default message is technical English — surfacing it directly looks like a bug.

**How.** See `src/features/hours/admin/ui/hours-form.tsx` (`friendlyMessage` helper).

**Pitfalls.** Don't auto-refresh on this error — the user might have unsaved local form state. Tell them to refresh.

## Touch target minimums

**What.** Interactive elements have `min-h-11` (44px) at minimum, often `min-h-12` (48px) for primary CTAs. Inputs use `text-base` (16px) — anything smaller triggers iOS Safari auto-zoom on focus.

**Why.** Apple HIG and Material both standardise on 44px / 48dp minimum touch targets. iOS Safari zooms inputs <16px on focus, scrolling the page unexpectedly.

**How.** `min-h-11` for chips/buttons in lists, `min-h-12` for the primary CTA in a sheet footer, `min-h-[44px]` on `<input type="time">` / `<input type="date">`. See examples throughout `src/features/hours/admin/ui/week-editor-window-sheet.tsx`.

**Pitfalls.** Don't pad text and forget the height — a 12px-padded button with 14px text is still under 44px. For `<input type="number">`, also set `inputMode="numeric"` to surface the numeric keypad.

---

## Anti-patterns (what NOT to do)

These were rejected in the hours redesign. Don't reintroduce them.

- **Accordions** (`<details>/<summary>`) for sections. Hides controls behind a click; settings is for configuring, not skimming.
- **Tabs** for ≤3 sections. Hides cross-cutting context.
- **A separate "Estado actual" / preview panel above the editor.** Duplicates data the editor already shows; gets out of sync if the editor mutates locally before save. The editor _is_ the WYSIWYG. Communicate "what's saved" via the success toast.
- **Inline forms with a row of horizontal time inputs at 360px.** Causes horizontal scroll. Use `<BottomSheet>`.
- **Cards around every section.** Visual weight, doesn't scale on mobile. Border-b under a serif `<h2>` is enough rhythm.
- **`window.confirm('¿Eliminar?')`.** Browser-native, ignores theming, doesn't fit the calm aesthetic. Use the auto confirm dialog del primitive `<RowActions>` (cuando es per-row), o el patrón inline "Eliminar → ¿Sí, eliminar?" en el footer del sheet (cuando es destructive standalone dentro de un form).
- **Botones full-width "+ Agregar X" o similares en el body de cards de scroll.** Tap accidental durante scroll vertical mobile. Las acciones del card viven en su 3-dots header. Ver § "Acciones fuera del scroll path".
- **Autosave por gesto en forms con múltiples concerns.** Cualquier mutación queda dirty; persist explicit con "Guardar cambios" page-level. Un mismo gesto no puede tener 2 comportamientos (autosavear si limpio, defer si dirty) — eso confunde.
- **`<button>` con `onClick={onSelect}` directo cuando la action es destructive.** Usar el primitive `<RowActions>` con `destructive: true` — fuerza confirm dialog automático.
- **Duplicate `useFieldArray` instances for the same `name`.** Silent desyncs.
- **N `onAdd` + M `onRemove` for bulk operations.** Race conditions, autosave spam. Use `onReplace`.
- **Inline success banner at form-top after save.** User scrolled to Save at form-bottom — they will never see it. Use `toast`.
- **`p-8` (or `p-4 md:p-8`) on settings pages.** Overflows at 360px. Standard is `px-3 py-6 md:px-4 md:py-8`.
- **Manually rolled headers per page** (`<h1>` + breadcrumbs + "Settings · ${name}"). Inconsistent + redundant with shell chrome. Use `<PageHeader>`.
- **`new Date('YYYY-MM-DD').toLocaleDateString(...)` for date display.** Treats the string as UTC midnight, shifts a day in negative timezones. Parse the parts manually.
- **`formatTime()` inside `aria-label`.** Hydration mismatch on attributes can't be suppressed. Use raw `HH:MM`.
- **`bg-accent` / `text-bg` for primary CTAs in settings sheets.** Maps to the place's brand color — clashes with the calm chrome and can render invisible on low-contrast palettes. Use `bg-neutral-900 text-white`.
- **`text-muted` for 3-dot dropdown triggers.** `var(--muted)` resolves to a beige-gray that disappears against the cream page bg. Use `text-neutral-600`.
- **Top-right "+ Nueva X" filled accent button.** Competes with sheet primary CTAs and reads as global. Place an "+ Nueva X" dashed-border full-width button _after_ the list instead.
- **`bg-surface` rounded card around a settings row list.** Adds visual weight without information. The cream page background + `divide-y divide-neutral-200 border-y` is the canonical container.

---

## Migration checklist for an existing settings page

When redesigning a settings page, apply in order:

1. **Standardise page padding** to `<div className="space-y-6 px-3 py-6 md:px-4 md:py-8">`. (O `mx-auto max-w-screen-md` para forms simples; usar full-width para master-detail).
2. **Replace the manual header** with `<PageHeader title="..." description="..." />`. Drop "Settings · ${placeName}" / breadcrumbs / back-button noise.
3. **Eliminar paneles "Estado actual" / preview redundantes** (anti-pattern). El editor ES la WYSIWYG.
4. **Group controls into `<section aria-labelledby="...">` + `<h2>` (border-b, font-serif text-xl).** No cards, no accordions, no tabs.
5. **Apply the canonical color palette.** All settings chrome uses raw Tailwind neutral classes (`bg-neutral-900`, `text-neutral-600`, `border-neutral-300`, `divide-neutral-200`). CSS custom properties stay outside settings.
6. **Identify "items con estado on/off + sub-data".** Aplicar el patrón **Card-per-item** (§ "Card-per-item con header + body + switch on/off"): card con border, header (nombre + estado + 3-dots + switch), body (chips de info cuando ON).
7. **Identify "row + edit/delete" patterns.** Migrate cada chip de info al primitive `<RowActions>` con `actions={[edit, delete]}` y `destructive: true` en delete.
8. **Identify "add/edit" forms.** If they have ≥2 inputs and live on a settings list, migrate to `<BottomSheet>` con la 2-modes pattern. Botón del sheet copy = **"Listo"** (NO "Guardar" — eso es page-level).
9. **Identify bulk transforms.** If a single user action changes many array items at once, expose `onReplace(next)` and compute the new array in one pass — never N `onAdd` + M `onRemove`. Switch ON→OFF de un card = bulk delete via `onReplace`.
10. **Lift `useFieldArray` to the form orchestrator.** Children take `fields` + callbacks. Audit for any duplicate `useFieldArray` with the same `name`.
11. **Apply el modelo "todo manual" en el orchestrator.** Cualquier mutación queda local + dirty. UN único path de commit: `persist(snapshot)` invocado por `onSubmit` del botón "Guardar cambios" page-level. Sin autosave, sin `commitOrDefer`, sin toasts por mutation.
12. **Wire the dirty indicator + Save button.** `disabled={pending || !formState.isDirty}` on the button; `<span aria-live="polite">• Cambios sin guardar</span>` next to it.
13. **Replace inline save feedback with `toast`.** Reserve inline banners for client-side Zod validation errors only.
14. **Audit `<input type="time">` / `<input type="date">` / `<input type="number">`.** Ensure `text-base` (16px) and `min-h-[44px]`. Wrap visible time/date strings derived via `Intl.*` in `<span suppressHydrationWarning>` and keep `aria-label` raw-canonical.
15. **Add the friendly Server Action error mapper.** Reuse the shape of `friendlyMessage(err)` in `hours-form.tsx`.
16. **"+ add another" placement:** dentro del 3-dots header del card cuando es per-card add. Dashed-border full-width bottom-of-list cuando es flat list (e.g. excepciones, invitaciones). Nunca top-right filled accent.
17. **Verificá scroll-safe actions:** cero botones full-width en el body de cards (§ "Acciones fuera del scroll path").
18. **Verificá confirm dialog en destructives:** todas las actions con `destructive: true` en `<RowActions>` usan el confirm automático. Para destructives standalone, `<Dialog>` propio.
19. **Validate at 360px.** No horizontal scroll, no clipped CTAs. Validate the bottom sheet footer respects `safe-area-inset-bottom` on iOS.

---

## Per-feature application matrix

Mini-spec por cada `/settings/*` sub-page para guiar el rediseño. Cada uno cita qué del patrón canónico aplica directo + qué necesita extension específica del dominio.

### `/settings/access` — ownership (no invitaciones generales)

**Decisión 2026-05-03 (M.4):** `/settings/access` se enfoca exclusivamente en **ownership**. Member/admin invites viven en `/settings/members` (directorio owner-only). La page combina owners activos + invitaciones pendientes con `asOwner=true` en una sola lista.

**Estado actual:** ya está bastante alineado con el patrón canónico (PageHeader, padding, sections, color palette, BottomSheets, Dialog). Plan de rediseño en `docs/plans/2026-05-12-settings-access-redesign.md`.

**Estructura:**

- `<PageHeader title="Acceso" description="Owners activos y pendientes, transferencia de ownership." />`
- Section "Owners": lista plana combinada de owners activos + pending owner invites con chip de estado (`activo` / `pendiente`). Dashed-border "+ Invitar owner" arriba de la lista. Cada pending invite: row con email + inviter + vence + `<RowActions>` con [Reenviar, Revocar (destructive)].
- Section "Transferir ownership" (solo owners): botón abre `<TransferOwnershipSheet>`.
- ~~Section "Salir del place"~~: **MOVER** a nuevo `/settings/system` (es lifecycle del place, no config de acceso).

**Patrón aplicado:**

| Patrón                               | Aplica                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Page padding                         | ✓                                                                        |
| `<PageHeader>`                       | ✓                                                                        |
| Sections con `aria-labelledby`       | ✓                                                                        |
| Color palette neutrals               | ✓                                                                        |
| `<RowActions>` per pending invite    | A agregar (refactor del `<ResendInvitationButton>` inline)               |
| Confirm dialog destructive (revocar) | A agregar (gap funcional: revoke action no existe en backend)            |
| `<BottomSheet>` para invite/transfer | ✓                                                                        |
| `<Dialog>` para leave confirm        | ✓                                                                        |
| Card-per-item                        | ✗ (lista plana, no items con sub-data)                                   |
| Save model "todo manual"             | ✗ (cada acción es discreta — invitar/revocar/reenviar persisten directo) |

**Files actuales:** `src/app/[placeSlug]/settings/access/page.tsx` + orchestrator `src/features/members/ui/owners-access-panel.tsx`.

### `/settings/system` — ciclo de vida del place (NUEVO)

**Razón de existir:** separar "config del place" (access, hours, editor) de "ciclo de vida del place" (salir, archivar futuro). Click en "Salir del place" no es config — es decisión de abandonar la comunidad. Si owner único intenta salir, hoy está bloqueado en el `<LeavePlaceDialog>` (debe transferir primero — `leave-place-dialog.tsx:67`).

**Estructura propuesta:**

- `<PageHeader title="Sistema" description="Decisiones sobre tu lugar y permanencia." />`
- Section "Salir del place": copy explicativo + botón rojo "Salir de este place" → `<LeavePlaceDialog>` (mantener el componente existente, mover desde access).
- (Futuro) Section "Archivar place": owner-only, soft-delete del place.

**Patrón aplicado:**

| Patrón                                        | Aplica                 |
| --------------------------------------------- | ---------------------- |
| Page padding                                  | ✓                      |
| `<PageHeader>`                                | ✓                      |
| Sections                                      | ✓                      |
| Color palette neutrals + red para destructive | ✓                      |
| `<Dialog>` para leave confirm                 | ✓                      |
| Save model                                    | ✗ (acciones discretas) |

**Posición en el sidebar de settings-shell:** después de las páginas de config. Como "Sistema" — copy a confirmar con stakeholders.

**Files (a crear):** `src/app/[placeSlug]/settings/system/page.tsx`.

### `/settings/editor` — identidad visual del place

**Estructura propuesta:**

- `<PageHeader title="Identidad visual" description="..." />`
- Section "Colores": color pickers (background, accent, text, border, surface, muted). Preview live al lado o debajo.
- Section "Tipografía" si aplica.
- Section "Plugins del editor": lista de plugins (YouTube, Vimeo, Spotify, etc) como cards con switch on/off — **patrón Card-per-item** sin sub-data en body (header simple).
- Botón "Guardar cambios" page-level.

**Patrón aplicado:**

| Patrón                           | Aplica                                        |
| -------------------------------- | --------------------------------------------- |
| Page padding + header + sections | ✓                                             |
| Card-per-item (plugin toggles)   | ✓ — header simple sin body                    |
| Color pickers                    | Inputs especiales (extension)                 |
| Save model "todo manual"         | ✓                                             |
| `<RowActions>`                   | ✗ (no hay per-item actions más que el switch) |

**Extension específica:** color pickers — input type=color o picker custom. Considerar preview en tiempo real (sin save).

**Files actuales:** `src/app/[placeSlug]/settings/editor/page.tsx`.

### `/settings/members` — la compleja

Ver § "Settings/members — extension del patrón" abajo (sección dedicada por la complejidad).

### `/settings/groups` — ya rediseñada

**Patrón aplicado (referencia):** Master-detail layout (§ "Master-detail layout (lista + detalle)"). No requiere rediseño — ya canoniza el patrón. Si emerge UX feedback similar a hours (acciones full-width en el detail), aplicar las mismas reglas (acciones fuera del scroll path).

**Files:** `src/app/[placeSlug]/settings/groups/{layout,page,_group-detail-content,[groupId]/page}.tsx`.

### `/settings/tiers` — lista de tiers

**Estructura propuesta:**

Decidir entre 2 enfoques según count típico:

- **N≤8 tiers:** Card-per-item (igual a hours days). Cada tier = card con header (nombre + count members + 3-dots + switch on/off "activo"). Body cuando expandido: lista de members con ese tier (chips con `<RowActions>` para "Quitar").
- **N>8 tiers:** master-detail (igual a groups). Lista compacta + detail page por tier.

**Patrón aplicado:**

| Patrón                           | Aplica                           |
| -------------------------------- | -------------------------------- |
| Page padding + header + sections | ✓                                |
| Card-per-item (si N≤8)           | ✓                                |
| Master-detail (si N>8)           | ✓                                |
| `<RowActions>` per member chip   | ✓                                |
| Confirm dialog destructive       | ✓ (eliminar tier, quitar member) |
| Save model "todo manual"         | ✓                                |

**Extension específica:** orden de tiers (drag handle? botones up/down?). Si se permite reordenar, `onReplace(reorderedArray)` mantiene el patrón bulk.

**Files actuales:** `src/app/[placeSlug]/settings/tiers/page.tsx`.

### `/settings/library` — categorías + items + permisos

**Estructura propuesta:** Master-detail layout (igual a groups).

- Master pane: lista de categorías como cards con switch on/off (visible/oculta) + count items.
- Detail pane (`/settings/library/[categoryId]`): título de categoría + tabs internas o sections para [Items, Contributors, Permisos]. Permisos = "quien puede leer esta categoría" (groups, tiers, users).

**Patrón aplicado:**

| Patrón                                | Aplica |
| ------------------------------------- | ------ |
| Master-detail layout                  | ✓      |
| Card-per-item en master pane          | ✓      |
| `<RowActions>` per item / contributor | ✓      |
| Confirm dialog destructive            | ✓      |
| Save model "todo manual"              | ✓      |

**Extension específica:** sub-tabs/sections en detail pane (Items vs Contributors vs Permisos) — no usar tabs si las 3 caben en sections con border-b. Si no, considerar segmented control (no tabs hidden).

**Files actuales:** `src/app/[placeSlug]/settings/library/page.tsx`.

### `/settings/flags` — feature flags por place

**Estructura propuesta:** lista de cards on/off (igual a hours days, sin sub-data en body).

- Cada flag = card con header (nombre humano del flag + descripción corta + switch on/off). Body vacío — los flags no tienen sub-data.
- Sin sections — todos los flags juntos.
- Botón "Guardar cambios" page-level (puede ser solo "Guardar" si no hay sub-forms).

**Patrón aplicado:**

| Patrón                                 | Aplica          |
| -------------------------------------- | --------------- |
| Card-per-item (header simple sin body) | ✓               |
| Save model "todo manual"               | ✓               |
| Color palette neutrals                 | ✓               |
| `<RowActions>`                         | ✗ (solo switch) |

**Extension específica:** mostrar quién/cuándo activó cada flag (audit trail) si aplica. Tooltip con descripción larga del flag.

**Files actuales:** `src/app/[placeSlug]/settings/flags/page.tsx`.

---

## Settings/members — extension del patrón

La página más compleja del set. Hoy mezcla 5 concerns en 1 page (lista, invitar, pending, transfer, leave) + sub-page detail por userId con N sub-sections.

### Análisis del estado actual

`src/app/[placeSlug]/settings/members/page.tsx` (122 LOC):

- Section "Lista": `members.map(...)` con role chips (owner/admin/miembro). Sin per-row actions, sin search, sin filter.
- Section "Invitar": `<InviteMemberForm>` (form inline).
- Section "Invitaciones pendientes": `<PendingInvitationsList>` (component externo).
- Section "Transferir ownership" (si owner).
- Section "Salir del place".

Sub-page `[userId]/page.tsx` (148 LOC) tiene:

- Header con avatar + name + roles
- Section "Grupos": asignar/quitar member de groups
- Section "Tiers": asignar/quitar tiers
- Section "Bloqueo": block / unblock
- Section "Expulsar": expel member

Search bar + filters ya implementados (`member-search-bar.tsx`, `member-filters.tsx`).

### Propuesta de rediseño

**Layout: Master-detail** (igual a groups + library). Razones:

- Members tiene detail page rica (groups, tiers, block, expel) que merece pane propio en desktop.
- Search/filter en master pane reduce ruido.
- Master pane reusa la lista — sub-page navigation no recarga.

**Master pane** (`/settings/members`):

- `<PageHeader title="Miembros" description="N miembros activos." actions={<button>Invitar</button>} />`
- Sticky search bar + filter chips (role, group, tier).
- `<ul divide-y>` de rows planas (no cards) — 150 items pueden ser mucho para cards individuales con border. Cada row:
  - Avatar + displayName + handle + role chips
  - `<RowActions>` con [Ver detalle (link → `[userId]`), Cambiar rol, Expulsar (destructive)]
- Botón "Invitar miembro" en `<PageHeader>` actions slot — abre BottomSheet con form invitar (email + checkbox admin).

**Detail pane** (`/settings/members/[userId]`):

- Header con avatar grande + name + roles + back link (md:hidden).
- Sub-sections con `<h2>` border-b: Grupos, Tiers, Bloqueo, Expulsar.
- Cada sub-section usa el patrón canónico — `<RowActions>` para chips de groups/tiers, `<Dialog>` para expel/block.

**Sub-pages separadas (no en página de members):**

- "Invitaciones pendientes" → mover a `/settings/access` (eso ya existe — tiene más sentido ahí, "access" es el concept paraguas).
- "Transferir ownership" → mover a `/settings/access` también, o a su propia sub-page si crece.
- "Salir del place" → mover al `/settings/profile` (cuando exista) o al `/settings` root como acción global del user. NO debería estar en una página de admin de members — no es admin action.

### Patrón aplicado + extensions

| Patrón canónico                    | Aplica directo |
| ---------------------------------- | -------------- |
| Master-detail layout               | ✓              |
| `<PageHeader>` con actions slot    | ✓              |
| `<RowActions>` per member row      | ✓              |
| Confirm dialog destructive (expel) | ✓              |
| `<BottomSheet>` para invitar       | ✓              |
| Color palette neutrals             | ✓              |

**Extensions específicas del dominio:**

1. **Sticky search bar** en master pane. `<MemberSearchBar>` ya existe — verificar que sea sticky en mobile y desktop, y que no compita con `<PageHeader>`.
2. **Filter chips** (role, group, tier). `<MemberFilters>` ya existe — verificar accesibilidad y que se rendericen below la search bar, sin esconder.
3. **Counts derivados:** mostrar "5 de 150 miembros" cuando hay filtros activos — ayuda al user a saber que está filtrando.
4. **Cambiar rol como action en `<RowActions>`** — pero "rol" tiene 3 valores (owner/admin/miembro), no es destructive ni 1-tap. Considerar:
   - Opción A: `<RowActions>` con sub-action "Cambiar rol" → abre BottomSheet con radio selector.
   - Opción B: Si el role chip mismo es tappeable (tap "miembro" → BottomSheet "Cambiar rol"), no necesita estar en `<RowActions>`. Más descubrible.
5. **Bulk actions opcional:** si emerge necesidad ("seleccionar N members para asignar tier X"), agregar selección con checkboxes + footer toolbar de bulk actions. **NO incluir en V1** — sumar cuando emerja caso real.
6. **Virtualización con 150 items:** probablemente NO necesaria — 150 rows con `divide-y` es performante. Solo considerar si se rompe scroll en mobile (mediar con DevTools antes de optimizar).
7. **Avatares:** comp `<Avatar>` shared (verificar que existe). En el master pane pueden ser pequeños (h-8 w-8); en detail pane grandes (h-16 w-16).

### Sesiones recomendadas para rediseñar members

Por size + complejidad del feature, dividir en sesiones:

1. **Sesión 1 — extracciones de páginas:** mover "Invitaciones pendientes" + "Transferir" a `/settings/access`; mover "Salir del place" a `/settings/profile` (o root). Members queda solo con Lista + Invitar.
2. **Sesión 2 — master-detail base:** layout.tsx con master pane + detail children (igual a groups).
3. **Sesión 3 — master pane + RowActions:** integrar search/filter existentes + RowActions per row.
4. **Sesión 4 — detail pane:** rediseñar sub-sections (Grupos, Tiers, Block, Expel) aplicando el patrón.
5. **Sesión 5 — invitar BottomSheet:** mover form invitar de inline a BottomSheet desde el actions slot del header.

Cada sesión: typecheck + tests + lint + commit + push antes de pasar a la siguiente.
