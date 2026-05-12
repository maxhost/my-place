# `/settings/system` como página separada para concerns de lifecycle del place

**Fecha:** 2026-05-12
**Estado:** Aceptada
**Origen:** Iteración del rediseño `/settings/access` (plan `docs/plans/2026-05-12-settings-access-redesign.md`). Decisión del owner para separar config de acceso de decisiones de ciclo de vida del place.

## Contexto

Hoy `/settings/access` agrupa 3 secciones (post rediseño M.4 de 2026-05-03):

1. **Owners** — lista combinada de owners activos + invitaciones owner pendientes. Acciones: invitar owner.
2. **Transferir ownership** — botón que abre `<TransferOwnershipSheet>` (owner-only).
3. **Salir del place** — botón rojo destructive que abre `<LeavePlaceDialog>` (cualquier miembro).

Las 3 cohabitan bajo el mismo `<PageHeader title="Acceso" description="Owners activos y pendientes, transferencia de ownership y salida del place." />`. Funcionalmente coherente, pero **semánticamente disociado**:

- "Owners" + "Transferir ownership" son **config del acceso administrativo** — qué identidades tienen poder sobre el place.
- "Salir del place" es una **decisión de ciclo de vida** — el user deja de pertenecer a la comunidad. No es config; es una acción que termina la relación del user con el place.

El disconnect se hace evidente para el caso del owner que clickea "Salir": no está cambiando config, está abandonando su comunidad. Si fuera owner único sin transfer previo, el `<LeavePlaceDialog>` lo bloquea hoy (`leave-place-dialog.tsx:67`), pero la semántica del flow sigue siendo "abandonar".

## Decisión

Crear una nueva sub-page `/settings/system` para concerns de ciclo de vida del place. La página `/settings/access` queda exclusivamente para config de acceso (owners + transfer).

**Scope inicial de `/settings/system`** (sesión 2 del plan referenciado):

- Sección "Salir del place" — copy explicativo + botón rojo "Salir de este place" que abre `<LeavePlaceDialog>` (el component existente, solo se mueve de un parent al otro — sin cambios al component en sí).

**Scope futuro (no en este plan):**

- Sección "Archivar place" — owner-only, soft-delete del place (`Place.archivedAt`).
- Posiblemente: ver detalle de eventos de lifecycle (último owner activo, fecha de creación, etc).

## Alternativas consideradas

### A. Dejar "Salir" en `/settings/access`

Descartada. Mezcla 2 concerns en la misma page. El user que entra a `/settings/access` espera ver/editar quién tiene acceso, no que aparezca un botón rojo prominente que termina su relación con el place. Aumenta el riesgo de click accidental (aunque hoy esté protegido por confirm dialog).

### B. Crear `/settings/profile` para acciones del user

Descartada. "Salir del place" tiene efectos sobre el place (puede dejar al place sin owner si la validation lo permitiera en el futuro), no es solo profile del user. Además, `profile` sugiere campos como avatar, displayName, preferencias — superficie distinta. `system` captura mejor "decisiones sobre tu relación con el place".

### C. "Danger zone" inline en cada page relevante

Descartada. "Salir" es global del user respecto al place, no específico a una feature. Replicarlo en hours, library, etc, sería confuso. La ubicación natural es una page dedicada a lifecycle.

### D. Mover sólo a `/settings` root (sin sub-page nueva)

Descartada. `/settings` root es el hub de navegación (futuramente, dashboard). Sumar acciones destructivas ahí compite con la navegación primaria. Mejor sub-page dedicada.

## Implicaciones

### 1. Settings-shell sidebar

Sumar entry `{ href: '/settings/system', label: 'Sistema', icon: <SettingsIcon/> }` al final del array de sections en `src/features/settings-shell/domain/sections.tsx`. Cuál grupo: "Comunidad" o nuevo grupo "Lugar" — decisión menor a confirmar en implementación.

**Visibilidad:** todos los miembros del place (incluso member regular sin admin/owner). Razón: cualquier miembro puede salir del place. El `<LeavePlaceDialog>` interno valida "único owner sin transfer previo" — ese hard gate cubre el caso edge.

### 2. Page existente `/settings/access`

- Quitar la sección "Salir del place" del `<OwnersAccessPanel>`.
- Quitar el `<LeavePlaceDialog>` portal y el `appUrl` prop si solo se usaba para ese dialog.
- Actualizar copy del `<PageHeader>` para no mencionar "salida del place": `description="Owners activos y pendientes, transferencia de ownership."`.

### 3. Component `<LeavePlaceDialog>`

NO se modifica. Solo se mueve el callsite desde `<OwnersAccessPanel>` a un nuevo `<LeaveSystemPanel>` (o equivalente) dentro de `/settings/system/page.tsx`. El component sigue viviendo en `src/features/members/profile/ui/leave-place-dialog.tsx` y sigue exportándose desde `members/profile/public.ts`.

### 4. Behavior del place sin owner

NO se modela en esta decisión. El `<LeavePlaceDialog>` actual bloquea "único owner sin transfer previo" como hard gate (validado en client + server). Por lo tanto, el escenario "place sin owner" no ocurre en el flow normal.

**Gap futuro (no incluido):** si emerge necesidad de modelar "place inactivo" (sin owner por circunstancias edge — owner falleció, owner expulsado externamente, etc), agregar un campo `Place.inactiveSince DateTime?` y una migration aparte. Por ahora, NO se prevé ese caso.

### 5. Migración del bookmark del user

Quien tenía un bookmark a `/<slug>.place.community/settings/access` esperando ver "Salir" verá que no está ahí. Mitigación:

- Sumar nota en `pre-launch-checklist.md` si la migración ocurre cerca de launch público.
- Considerar redirect server-side `/settings/access#salir` → `/settings/system` si emerge feedback. Probablemente innecesario dado que el sidebar lleva al user al lugar correcto.

## Trade-offs

**Costo:** una sub-page más en `/settings/*` (ya hay 8: access, editor, hours, members, groups, tiers, library, flags) — sube a 9. El sidebar de settings-shell gana un item.

**Beneficio:** separación clara de concerns. El user que entra a `/settings/system` está conscientemente buscando decisiones de lifecycle, no encuentra "Salir" por accidente mientras edita owners.

## Verificación post-implementación (sesión 2)

- `/settings/access` ya NO contiene la sección "Salir del place" ni el `<LeavePlaceDialog>` portal.
- `/settings/system` aparece en el sidebar de settings-shell para todos los miembros.
- Tap en "Sistema" del sidebar → nueva page con `<PageHeader title="Sistema" ...>` + sección "Salir del place".
- Tap en "Salir de este place" → mismo `<LeavePlaceDialog>` que antes, comportamiento idéntico.
- Owner único sin transfer sigue bloqueado por el dialog (regresión: probar manualmente).
- 360px viewport: page nueva no rompe layout mobile.

## Referencias

- Plan completo: `docs/plans/2026-05-12-settings-access-redesign.md`.
- Decisión M.4 (renombre /members → /access): nota en `src/features/members/ui/owners-access-panel.tsx` línea 21-24.
- Patrón canónico de settings sub-page: `docs/ux-patterns.md` § "Per-feature application matrix" → `/settings/system`.
