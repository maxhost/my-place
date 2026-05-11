# UX/UI patterns — settings pages

Canonical patterns from the `/settings/hours` redesign (May 2026). Use them when redesigning the rest of the settings pages — library next, then members, groups, tiers. Each pattern earned its place by solving a specific failure mode (overflow at 360px, hydration mismatch, race conditions on bulk ops, persisted side-effects of unconfirmed changes). Rejected approaches are listed in Anti-patterns at the end so future agents don't re-derive the wrong answer.

The goal is mechanical reuse: a future implementer should apply these patterns without re-reading the entire `features/hours` slice.

## Anchor principles

When a new situation isn't covered, fall back to these meta-rules:

1. **Mobile-first.** Validate at 360px viewport. Touch targets ≥ 44px tall. Inputs ≥ 16px font (iOS auto-zooms anything smaller).
2. **Single source of truth in form state.** RHF `useFieldArray` lives only in the form orchestrator; children get callbacks. No double instances. No state mirrored in component-local `useState` for the same data.
3. **The user controls commits.** Single-item edits via explicit UI can autosave. Bulk transforms (copy-to-all, timezone, mode toggle) defer until explicit Save. A click the user didn't make never triggers a write.
4. **Locale respect.** Time/date formatting follows the viewer's locale via `Intl.*`. Canonical values (`HH:MM`, `YYYY-MM-DD`) live in the schema; presentation is downstream.

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

**How.** See `src/features/hours/ui/hours-form.tsx:244-281`.

**Pitfalls.** Don't use `<details>`/`<summary>` to "save space" — settings pages should show everything. Don't use tabs for ≤3 sections.

## Color palette & button styles

**What.** Settings sub-pages use **raw Tailwind neutral classes** (`bg-neutral-900`, `text-neutral-600`, `border-neutral-300`) for all chrome — buttons, borders, dividers, dropdown triggers, inputs, labels. CSS custom properties (`var(--accent)`, `var(--text)`, `var(--bg)`, `var(--muted)`, `var(--border)`) are reserved for the place's brand identity surfaces _outside_ settings (member avatars, category cards in `/library`, the reading view, etc.).

**Why.** Settings is admin chrome — calm, high-contrast, legible regardless of the place palette. If every settings page used `bg-accent` for its primary CTA, the brand color stops meaning "interactive" in the rest of the app and CTAs can become invisible on low-contrast palettes. The hours redesign set the canonical and it now binds the rest of `/settings/*`. The single concession: the `border-b` under each `<h2>` uses `style={{ borderColor: 'var(--border)' }}` — that's the only place where `var(--border)` appears in settings.

**Canonical button styles.**

- **Primary CTA in a sheet footer** — `inline-flex min-h-12 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white`. Black solid bar. Used for "Guardar", "Crear categoría", "Listo". Disabled state: add `disabled:opacity-60`.
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

**When to use.** Every `/settings/*` sub-page after this doc. When in doubt, copy the class strings from `src/features/hours/ui/week-editor-window-sheet.tsx` and `src/features/hours/ui/week-editor-day-row.tsx`.

**When NOT to use.** Outside `/settings/*` — gated zone components (conversations, library reading view, member profile, place home) keep `var(--accent)` / `var(--text)` / `var(--bg)`. That's where brand identity lives.

**Pitfalls.**

- Don't use `bg-accent text-bg` for sheet submit buttons inside settings. It maps to the brand color and breaks the chrome / brand separation.
- Don't replace `border-neutral-300` with `border-border` in settings sheets — the CSS-var version drifts when admins customise the palette and can become invisible.
- Don't use `text-muted` for actionable affordances like 3-dot triggers. `text-neutral-600` is the floor for interactive icons in settings.
- Destructive UI is red (`red-600`). Amber (`amber-50` / `amber-300` / `amber-900`) is reserved for recoverable destructive (archive / hide) and warnings. Never mix.
- The "+ add" affordance is dashed-border bottom-of-list, not a top-right filled button. Top-right filled buttons read as primary CTAs and compete with the sheet's "Guardar".

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

**How.** `<BottomSheet open={...} onOpenChange={...}><BottomSheetContent>...</BottomSheetContent></BottomSheet>`. Structure with `<BottomSheetHeader>` (`<BottomSheetTitle>` is required by Radix for `aria-labelledby`), `<BottomSheetBody>` (scrollable), `<BottomSheetFooter>` (sticky CTAs). See `src/shared/ui/bottom-sheet.tsx` and `src/features/hours/ui/week-editor-window-sheet.tsx`.

### The 3-modes pattern

The same sheet handles `add` / `edit` / `add-new-*` via a discriminated union state:

```ts
type SheetState =
  | { mode: 'closed' }
  | { mode: 'add'; day: DayOfWeek }
  | { mode: 'edit'; day: DayOfWeek; index: number; start: string; end: string }
  | { mode: 'add-new-day'; availableDays: ReadonlyArray<DayOfWeek> }
```

Same form layout, same Guardar/Cancelar; in `edit` mode an inline "Eliminar" → "¿Sí, eliminar?" confirmation appears in the footer. Reusing the same sheet keeps the visual language consistent.

**Pitfalls.**

- `aria-describedby={undefined}` on `<BottomSheetContent>` is intentional when there's no separate description.
- Don't render the inner sheet form unless `open` — otherwise initial-state hooks (`useState`) run with stale defaults.
- The sheet portals to `<body>` — pass state via the `SheetState` discriminated union, not parent context.

## Per-item dropdown menus as the contextual entry point

**What.** Each interactive item in a list (a window chip, a row, a member card) is itself the trigger of a `<DropdownMenu>` whose items are the per-item actions ("Editar", "Eliminar"). The row also carries an overflow menu (`...`) for row-level actions ("Agregar otra ventana", "Copiar a todos los días").

**Why.** Chip-as-trigger eliminates a "select first, then act" two-step. Tapping a window goes straight to "Editar / Eliminar" — no separate icons cluttering the chip and no inline pencil/trash icons (which on mobile would push chips wider than the 360px viewport). The per-row `...` menu keeps the row clean of operations that don't apply to a single chip but to the whole row.

**When to use.** Lists/grids of items where each item has 2-3 primary actions, and the actions are textual ("Editar", "Eliminar", "Cambiar rol").

**When NOT to use.** Single-action items (just use a button labelled with the action). Lots of actions (5+) → side sheet or its own page. Selection-derived bulk ops — the dropdown is per-item, not for selection.

**How.** Use the `<RowActions>` primitive (`src/shared/ui/row-actions.tsx`). It handles BOTH viewports automatically (mobile chip-as-dropdown-trigger, desktop chip + hover icons). See "Adaptive per-row actions (`<RowActions>`)" below.

**Pitfalls.**

- Use `asChild` so Radix sets `aria-haspopup` / `aria-expanded` on the underlying button.
- The `aria-label` must include human-readable identifiers ("Opciones para ventana 09:00 a 17:00 del Lunes") — visible label is just times.
- Use raw `HH:MM` in `aria-label`, not `formatTime()` (see hydration-safety section).

## Adaptive per-row actions (`<RowActions>`)

**What.** Single primitive that adapts the per-row action UX between mobile (chip-as-dropdown-trigger) and desktop (chip + icon buttons inline). One CSS-driven component, no `useMediaQuery`.

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

- Mobile (`< md`): chip is a `<DropdownMenuTrigger asChild>`. Tap opens dropdown with `actions[].label` as text items. Original chip-as-trigger pattern preserved.
- Desktop (`md:`): chip is display-only span; `actions[].icon` rendered as `<button aria-label={label}>` next to the chip. More density, fewer clicks.
- **Overflow** (`actions.length > 3`): both viewports use a kebab `...` button instead. Threshold prevents 4+ icons making chips wider than 360px (mobile) or visually noisy (desktop).

**Why.** Density vs touch-target tradeoff is viewport-dependent — admins on desktop want 1-click access to "Editar"/"Eliminar"; users on mobile want chip-as-trigger because hover doesn't exist and dedicated icons would inflate chip width past 360px.

**When to use.** Per-row actions in lists/grids where each item has 1-3 primary actions and you want optimal UX in both viewports. Replaces the manual chip-as-DropdownMenuTrigger pattern from settings sub-pages.

**When NOT to use.**

- Standalone overflow kebab without a chip (e.g. day-row overflow with "Add another window" / "Copy to all"): use `<DropdownMenu>` directly — `<RowActions>` requires a chip children.
- Single-action items: just use a labelled button.
- Bulk-selection actions (footer toolbar style): `<RowActions>` is per-item.

**How.** See `src/shared/ui/row-actions.tsx` (~150 LOC). Reference usage in `src/features/hours/admin/ui/week-editor-day-row.tsx`.

**Pitfalls.**

- `chipClassName` is applied to BOTH the mobile button and the desktop span. The chip has identical look in both viewports.
- `actions[].destructive` activates `text-red-600` styling on the desktop icon button and the mobile dropdown item. Use it for delete/archive only (per `ux-patterns.md` § "Color palette").
- Touch targets: each desktop icon button is `min-h-11 min-w-11` (44px). Don't override.
- The trigger `<button>` for mobile and the `<span>` for desktop both render in the DOM (CSS hide-show). Avoid stateful `children` to prevent double-mount issues.

## Autosave with soft barrier

**What.** Single-item commits (sheet "Guardar", per-chip "Eliminar") autosave when the form is otherwise clean. Bulk transformations (copy-to-all, timezone, mode toggle) never autosave. If the user does a single-item op while the form already has pending changes, that op also defers — applies locally, shows `toast.info("Cambio aplicado localmente. Tocá «Guardar cambios» para confirmar todos los pendientes.")`, waits for explicit Save.

**Why.** Pure autosave is dangerous: if the user changes the timezone (bulk, no commit yet) and then deletes a window (single-item), an autosave on the delete would persist the timezone change as a side-effect. The user loses control of when each thing commits. The soft barrier rule: "your single-item action commits only if nothing else is pending — otherwise wait for explicit Save."

**When to use.** Forms where some operations are atomic and confirmable in-place (a single sheet submit) and others are bulk transforms the user should review before committing.

**When NOT to use.** Pages with one save operation — submit the whole thing once. Forms with inter-field validations that depend on the whole snapshot.

**How.** The `wasDirty` pre-check pattern: read `methods.formState.isDirty` _before_ mutating, then route via a single `commitOrDefer` helper.

```ts
function handleAddRecurring(w: RecurringWindow) {
  const wasDirty = methods.formState.isDirty
  const next = [...methods.getValues('recurring'), w]
  recurring.append(w)
  commitOrDefer(wasDirty, { recurring: next }, { successMessage: 'Horario agregado.' })
}

function commitOrDefer(wasDirty, snapshotOverride, opts) {
  if (wasDirty) {
    toast.info(DEFER_HINT)
    return
  }
  persist(snapshot(snapshotOverride), opts)
}
```

See `src/features/hours/ui/hours-form.tsx:134-225`.

**Pitfalls.**

- `methods.getValues()` after `recurring.append()` may not reflect the append (RHF mutations are async w.r.t. the next render). Compute `next` from current values + the change and pass it as `snapshotOverride`.
- Read `wasDirty` _before_ mutating — `append/update/remove` flip `isDirty` to true synchronously, so reading after collapses the soft barrier.

## `persist()` helper as the single commit path

**What.** One function inside the form orchestrator validates the payload, calls the Server Action, and on success calls `methods.reset(snapshot)` to mark the new baseline. Both the explicit Save (`onSubmit`) and the autosaves (`commitOrDefer`) go through the same helper.

**Why.** Without it, validation, error mapping, and baseline reset get duplicated and drift. Forgetting `methods.reset(snapshot)` on autosave leaves `formState.isDirty === true` even after a successful save, making the dirty indicator and Save button lie. One helper means one place where "successful save → reset baseline → toast success" lives.

**How.** See `src/features/hours/ui/hours-form.tsx:100-131`. The `snapshot` argument is the source of truth for the payload — never read `methods.getValues()` inside the helper.

**Pitfalls.** `methods.reset(snapshot)` re-baselines `defaultValues`. Without it, the user sees "Cambios sin guardar" forever.

## Dirty indicator + Save button via `formState.isDirty`

**What.** The Save button is `disabled={pending || !formState.isDirty}`. A subtle "• Cambios sin guardar" label appears next to it when `formState.isDirty && !pending`, with `aria-live="polite"`.

**Why.** Disabling when nothing is dirty prevents the user from clicking and getting a no-op (and a useless success toast). The label gives a calm, persistent signal — no flashing, no banner. `aria-live="polite"` lets screen readers announce without interrupting.

**How.** See `src/features/hours/ui/hours-form.tsx:334-351`.

**Pitfalls.** Don't add a separate `useState` mirror — RHF owns this. `methods.reset(snapshot)` after each successful persist is what keeps `isDirty` accurate.

## Toast over inline banner for save feedback

**What.** Use `toast.success`/`toast.error`/`toast.info` (Sonner re-exported from `@/shared/ui/toaster`) for save outcomes. Reserve inline banners (the amber `<div role="alert">`) for client-side validation errors that the user must read next to the field.

**Why.** A user who clicks Save at the bottom of a long form, scrolls up, and gets an inline success banner at the top will never see it. Toasts are visible regardless of scroll. Inline banners stay reserved for "you can't submit because field X is wrong" — the user needs to find the field, so the message belongs near it.

**When to use toast.** Save success, server errors from the action, soft-barrier defer.

**When to use inline banner.** Zod `safeParse` failure on the client before calling the action.

**How.** `import { toast } from '@/shared/ui/toaster'`. The `<Toaster />` is mounted once in `src/app/layout.tsx`. Z-index 60 — above `<Dialog>` and `<BottomSheet>` (50).

**Pitfalls.** Don't `toast.success` _and_ set an inline success banner — pick one. Use the friendly mapper (see below) before passing server errors to toast.

## Single `useFieldArray` per name in the parent

**What.** The form orchestrator (`<HoursForm>`) is the only place that calls `useFieldArray({ control, name: 'recurring' })`. Children receive `fields` and `onAdd`/`onUpdate`/`onRemove`/`onReplace` callbacks.

**Why.** RHF docs are explicit: "If you have multiple `useFieldArray` with the same `name`, only one is effective." Two instances cause silent desyncs — chips that don't update after editing, deletes that vanish from one view but not the other. Centralising also makes the soft-barrier logic possible: only the parent has `formState.isDirty` context to decide commit vs defer.

**How.** Parent invokes `useFieldArray` and passes `fields` (read-only) plus narrow callbacks down. See `src/features/hours/ui/hours-form.tsx:85-86` (canonical instance) and `src/features/hours/ui/week-editor.tsx:60-72` (child API).

**Pitfalls.**

- Don't call `useFieldArray` again in a child for ergonomic access. Pass callbacks.
- Use `field.id` as React key — never `index` (RHF re-generates IDs on reorder, indexes are not stable).

## `onReplace` callback for bulk transforms

**What.** Bulk operations (copy-to-all, copy-to-weekdays, sort) call a single `onReplace(nextArray)` rather than dispatching N `onAdd` + M `onRemove`.

**Why.** N+M sequential callbacks generate N+M autosave requests, introduce race conditions if the DB serialises differently than dispatch order, and produce N+M toasts spamming the user. `onReplace` is one mutation — and the soft barrier ensures it doesn't autosave.

**How.** See `src/features/hours/ui/week-editor.tsx:103-126` (`copyTo` computes `kept + additions` in one pass) and `src/features/hours/ui/hours-form.tsx:200-202` (`handleReplaceRecurring` just calls `recurring.replace(next)` — no autosave).

**Pitfalls.** `recurring.replace(next)` does flip `isDirty` to true (good — the Save button enables) but does NOT autosave. Document this in the handler so future contributors don't "fix" it by adding `commitOrDefer`.

## Locale-aware time formatting + hydration safety

**What.** `formatTime('HH:MM')` returns the locale-formatted version using `Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })`. Visible text uses `<span suppressHydrationWarning>{formatTime(w.start)}</span>`. The `aria-label` uses raw `HH:MM`.

**Why.** Server (Vercel — usually `en-US`) and client (the viewer's browser) can return different strings for the same time: non-breaking spaces, `"a.m."` vs `"a. m."`. React's hydration check fails on attribute mismatch, and `suppressHydrationWarning` only works on element children — not on attributes. So: locale-formatted text in the visible label (with suppress), canonical `HH:MM` in the attribute (deterministic).

The reason to format at all: `<input type="time">` renders according to browser/OS locale and isn't reliably overridable. If the input shows `9:00 AM` and the chip shows `09:00`, the user sees an inconsistency.

**How.** See `src/features/hours/ui/format-time.ts` and `src/features/hours/ui/week-editor-day-row.tsx:53-69`.

**Pitfalls.**

- `suppressHydrationWarning` doesn't propagate from a parent — wrap the specific span.
- Don't use `formatTime()` inside `aria-label` — attribute mismatches can't be suppressed.
- For dates, parse `YYYY-MM-DD` manually (split on `-`) rather than `new Date(date)` — the latter assumes UTC midnight and shifts a day in non-UTC locales. See `formatDateLong` in `src/features/hours/ui/exceptions-editor.tsx:148-170`.

## Always-on toggle pattern with stashed data

**What.** A boolean toggle ("Abierto 24/7") replaces a section's editor with a confirmation pill ("El place está abierto las 24 horas, todos los días."). When the toggle is on, the editors are hidden but their data is preserved in DB so toggling back restores everything.

**Why.** The user might want the convenience of "always open" without losing the schedule they spent time configuring. Naive impl: clear the arrays when `alwaysOpen=true`. Failure mode: user toggles on, then off, and discovers their week vanished. Solution: persist `recurring` + `exceptions` even when `kind === 'always_open'` — they're "stashed". `parseOpeningHours` re-inflates them on next load.

**How.** See `src/features/hours/ui/hours-form.tsx:283-315` (toggle + conditional render) and `src/app/[placeSlug]/settings/hours/page.tsx:71-83` (re-inflation in `hoursToFormDefaults`).

**Pitfalls.** The server action must persist stashed arrays even when they don't apply to the active mode. The schema should validate them only when `kind === 'scheduled'` — otherwise a stashed-but-invalid window blocks toggling on.

## Friendly error messages for stale Server Actions

**What.** The `friendlyMessage(err)` helper detects `Failed to find Server Action` / `Server Action ... not found` and returns a Spanish message instructing the user to refresh.

**Why.** When a deploy hashes a new ID for a Server Action, any open tab with the old ID gets this opaque error on submit. In dev it fires after every HMR of the form; in prod it can hit any user with a tab open during deploy. The default message is technical English — surfacing it directly looks like a bug.

**How.** See `src/features/hours/ui/hours-form.tsx:357-381`.

**Pitfalls.** Don't auto-refresh on this error — the user might have unsaved local form state. Tell them to refresh.

## Touch target minimums

**What.** Interactive elements have `min-h-11` (44px) at minimum, often `min-h-12` (48px) for primary CTAs. Inputs use `text-base` (16px) — anything smaller triggers iOS Safari auto-zoom on focus.

**Why.** Apple HIG and Material both standardise on 44px / 48dp minimum touch targets. iOS Safari zooms inputs <16px on focus, scrolling the page unexpectedly.

**How.** `min-h-11` for chips/buttons in lists, `min-h-12` for the primary CTA in a sheet footer, `min-h-[44px]` on `<input type="time">` / `<input type="date">`. See examples throughout `src/features/hours/ui/week-editor-window-sheet.tsx`.

**Pitfalls.** Don't pad text and forget the height — a 12px-padded button with 14px text is still under 44px. For `<input type="number">`, also set `inputMode="numeric"` to surface the numeric keypad.

---

## Anti-patterns (what NOT to do)

These were rejected in the hours redesign. Don't reintroduce them.

- **Accordions** (`<details>/<summary>`) for sections. Hides controls behind a click; settings is for configuring, not skimming.
- **Tabs** for ≤3 sections. Hides cross-cutting context.
- **A separate "Estado actual" / preview panel above the editor.** Duplicates data the editor already shows; gets out of sync if the editor mutates locally before save. The editor _is_ the WYSIWYG. Communicate "what's saved" via the success toast.
- **Inline forms with a row of horizontal time inputs at 360px.** Causes horizontal scroll. Use `<BottomSheet>`.
- **Cards around every section.** Visual weight, doesn't scale on mobile. Border-b under a serif `<h2>` is enough rhythm.
- **Per-chip pencil/trash icons.** Pushes chips past 360px. Use the chip-as-dropdown-trigger pattern.
- **`window.confirm('¿Eliminar?')`.** Browser-native, ignores theming, doesn't fit the calm aesthetic. Use the inline "Eliminar → ¿Sí, eliminar?" toggle in the sheet footer.
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

When redesigning a settings page (next: `/settings/library`), apply in order:

1. **Standardise page padding** to `<div className="space-y-6 px-3 py-6 md:px-4 md:py-8">`.
2. **Replace the manual header** with `<PageHeader title="..." description="..." />`. Drop "Settings · ${placeName}" / breadcrumbs / back-button noise.
3. **Group controls into `<section aria-labelledby="...">` + `<h2>` (border-b, font-serif text-xl).** No cards, no accordions, no tabs.
4. **Apply the canonical color palette.** All settings chrome uses raw Tailwind neutral classes (`bg-neutral-900`, `text-neutral-600`, `border-neutral-300`, `divide-neutral-200`). CSS custom properties stay outside settings. See "Color palette & button styles".
5. **Identify "row + edit/delete" patterns.** Migrate the row to a `<DropdownMenu>` triggered by the row itself; put `Editar` / `Eliminar` in the menu. Move row-level operations into a per-row `...` overflow menu.
6. **Identify "add/edit" forms.** If they have ≥2 inputs and live on a settings list, migrate to `<BottomSheet>` with the 3-modes pattern.
7. **Identify bulk transforms.** If a single user action changes many array items at once, expose `onReplace(next)` and compute the new array in one pass — never N `onAdd` + M `onRemove`.
8. **Lift `useFieldArray` to the form orchestrator.** Children take `fields` + callbacks. Audit for any duplicate `useFieldArray` with the same `name`.
9. **Apply autosave + soft barrier in the orchestrator.** Single-item commits autosave when `formState.isDirty === false` at the moment of action; if dirty, defer with `toast.info(DEFER_HINT)`. Bulk transforms never autosave. All commits go through one `persist(snapshot, opts)` helper that validates, calls the action, and `methods.reset(snapshot)`.
10. **Wire the dirty indicator + Save button.** `disabled={pending || !formState.isDirty}` on the button; `<span aria-live="polite">• Cambios sin guardar</span>` next to it.
11. **Replace inline save feedback with `toast`.** Reserve inline banners for client-side Zod validation errors only.
12. **Audit `<input type="time">` / `<input type="date">` / `<input type="number">`.** Ensure `text-base` (16px) and `min-h-[44px]`. Wrap visible time/date strings derived via `Intl.*` in `<span suppressHydrationWarning>` and keep `aria-label` raw-canonical.
13. **Add the friendly Server Action error mapper.** Reuse the shape of `friendlyMessage(err)` in `hours-form.tsx`.
14. **Place "+ Add another" affordance below the list.** Dashed-border full-width neutral. Never top-right filled accent.
15. **Validate at 360px.** No horizontal scroll, no clipped CTAs, no chip rows wider than viewport. Validate the bottom sheet footer respects `safe-area-inset-bottom` on iOS.
