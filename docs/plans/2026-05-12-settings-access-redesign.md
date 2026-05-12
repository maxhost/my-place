# Plan — Rediseño `/settings/access` + creación `/settings/system`

**Fecha:** 2026-05-12
**Base canónica:** `docs/ux-patterns.md` (post commit `32c4480`)
**Decisión histórica:** `/settings/access` es solo ownership (M.4, 2026-05-03)

## Context

El page `/settings/access` ya está 80% alineado con el patrón canónico extraído del rediseño hours (PageHeader, padding, sections, color palette, BottomSheets, Dialog). Solo faltan 4 piezas, una de ellas con gap funcional real:

1. **Falta `<RowActions>` per pending invite** — hoy `<ResendInvitationButton>` es un component custom inline en cada row, no usa el primitive canónico.
2. **Falta acción "Revocar invitación"** — gap funcional: una invitación owner pendiente solo se puede dejar vencer. Si el owner se equivocó con el email, no tiene forma de cancelarla. Backend `revokeInvitation` no existe.
3. **Sección "Salir del place" semánticamente fuera de lugar** — vive en access pero "salir" no es config de acceso, es lifecycle del place. Decisión: mover a nuevo `/settings/system`.
4. **`formatDate` hardcodea `'es-AR'`** — viola anchor principle #6 (locale respect del viewer).

## Outcome esperado

Después de las 2 sesiones:

- `/settings/access`: lista de owners + pending invites usa `<RowActions>` canónico con [Reenviar, Revocar]. Confirm dialog automático al revocar. Sin sección "Salir del place".
- `/settings/system`: nueva ruta con sección "Salir del place" (component existente movido). Settings-shell sidebar incluye entry "Sistema".
- Backend: `revokeInvitationAction` con permisos owner-only para owner invites, tests cubriendo happy + edge cases.
- Doc: mini-spec de access en `ux-patterns.md` actualizada (ya hecho en commit anterior).

## Pre-requisito: estado actual confirmado

- ✓ `revokeInvitationAction` NO existe — `grep -rln 'revokeInvitation\|cancelInvitation\|deleteInvitation' src/features/members` retorna 0.
- ✓ `<LeavePlaceDialog>` ya valida "único owner sin transfer previo" (`leave-place-dialog.tsx:67`) — no hay riesgo de owner único saliendo y dejando place sin owner.
- ✓ `Place.archivedAt` existe en schema (futuro archivado, NO en scope de este plan).
- ✓ `settings-shell/domain/sections.tsx` ya estructura el sidebar — sumar entry "Sistema" ahí.

## Sesiones

Total: **2 sesiones independientes y deployables solas**.

---

### Sesión 1 — Backend revoke + decisión doc `/settings/system`

**Goal:** crear el backend para revocar invitaciones owner + documentar la decisión arquitectónica de `/settings/system`. Sin tocar UI todavía. Permite shipear backend solo si la UI se demora.

**Files:**

- **NEW `src/features/members/invitations/server/actions/revoke.ts`** (~70 LOC):
  - `revokeInvitationAction({ placeSlug, invitationId })`
  - Auth: `requireAuthUserId(reason)`
  - Authorization: el actor debe ser owner del place (porque solo afectamos owner invites). Si es admin no-owner, error `AUTHORIZATION` con mensaje claro.
  - Domain validation:
    - `findInvitationByToken` o equivalente by id — debe existir, debe estar pending (no acceptedAt), debe pertenecer al place.
    - Si la invitación ya fue aceptada o ya está revocada, error `CONFLICT`.
  - Mutation: `prisma.invitation.delete({ where: { id } })` — o agregar `revokedAt` field si querés audit trail. **Decisión:** delete por ahora (no hay caso de uso para historial post-revoke; mismo enfoque que la canela "cancelInvitationByInviter" si existe).
  - Log: `logger.info({ event: 'invitationRevoked', placeId, invitationId, actorId }, 'invitation revoked')`.
  - `revalidatePath(`/${placeSlug}/settings/access`)`.
- **NEW `src/features/members/invitations/__tests__/revoke.test.ts`** (~120 LOC):
  - Happy path: owner revoca su propia invitación owner pendiente → ok + invitation deleted en DB.
  - Auth: anonymous → throws `AUTHORIZATION`.
  - Authorization: admin no-owner → throws `AUTHORIZATION`.
  - Authorization: owner del place A intenta revocar invitación del place B → throws `NOT_FOUND` (no leak existencia).
  - Domain: invitation ya aceptada → throws `CONFLICT`.
  - Domain: invitation no existe → throws `NOT_FOUND`.
  - Revalidate path llamado correctamente.
- **MODIFIED `src/features/members/invitations/server/actions/index.ts`**: export `revokeInvitationAction`.
- **MODIFIED `src/features/members/invitations/public.ts`**: export `revokeInvitationAction` (si el barrel exporta otros actions; verificar consistencia).
- **NEW `docs/decisions/2026-05-12-settings-system-for-lifecycle.md`** (~100 LOC):
  - Contexto: "Salir del place" hoy vive en `/settings/access`, pero salir no es config de acceso — es lifecycle.
  - Decisión: crear `/settings/system` para decisiones de lifecycle (salir, archivar futuro).
  - Alternativas consideradas: (a) dejar en access (descartada: viola separation of concerns), (b) crear `/settings/profile` para acciones del user (descartada: salir afecta al place, no es solo profile), (c) "danger zone" en cada page (descartada: salir es global, no por feature).
  - Implicaciones: sumar entry "Sistema" al sidebar (`settings-shell/domain/sections.tsx`). Copy del item: "Sistema" o alternativas a definir.
  - Behavior del place sin owner: el `<LeavePlaceDialog>` actual bloquea "único owner sin transfer". NO se modela "place inactivo" en este plan — gap futuro si emerge necesidad.

**No tocar en esta sesión:**

- UI de `/settings/access` (sigue funcionando con `<ResendInvitationButton>` actual).
- `/settings/system` page (sesión 2).
- Sidebar de settings-shell (sesión 2).
- Component `<LeavePlaceDialog>` (sesión 2 lo mueve).

**Verificación:**

- `pnpm typecheck` — verde.
- `pnpm vitest run src/features/members/invitations/__tests__/revoke.test.ts` — verde.
- `pnpm vitest run` (suite completa) — verde.
- `pnpm lint` — clean.
- Smoke manual (post-deploy si se decide pushear sesión 1 sola): no aplica — la action no se invoca desde UI todavía.

**LOC delta:** +290 (action 70 + tests 120 + decisión doc 100).

**Riesgo deploy:** **cero** — código nuevo sin callsites, ADR es solo doc. Se puede pushear sin esperar sesión 2.

**Commit final:** `feat(invitations): revokeInvitationAction owner-only + ADR settings/system`

---

### Sesión 2 — UI: RowActions + mover Salir + `/settings/system` route

**Goal:** refactor `owners-access-panel.tsx` para usar `<RowActions>` canónico con la nueva action revoke. Crear `/settings/system/page.tsx`. Mover sección "Salir del place" desde access. Actualizar sidebar.

**Files:**

- **MODIFIED `src/features/members/ui/owners-access-panel.tsx`** (~242 LOC actuales → ~200 LOC):
  - Reemplazar el `<ResendInvitationButton invitationId={inv.id} />` inline por `<RowActions>` con dos actions:
    - `Reenviar` (icon: Mail/RefreshCw) — wrapper alrededor del action existente que usa `<ResendInvitationButton>`. Mantener el component si tiene state propio (pending/done UI), o inline el call al action.
    - `Revocar` (icon: Trash2, `destructive: true`) — invoca `revokeInvitationAction` de sesión 1. Custom `confirmTitle: '¿Revocar invitación a {email}?'`, `confirmDescription: 'El link enviado dejará de funcionar. El receptor no podrá usarlo.'`, `confirmActionLabel: 'Sí, revocar'`.
  - El chip de estado "pendiente" / "activo" sigue como `<span>` display-only (no es action trigger — `<RowActions>` lo aplica al chip de info CONTEXTUAL, en este caso el chip de estado es contenido del row, no info clickeable).
  - **QUITAR** el `<section aria-labelledby="access-leave-heading">` y el `<LeavePlaceDialog>` portal — se mueve a `/settings/system`.
  - Quitar prop `appUrl` de `OwnersAccessPanel` si solo lo usaba el leave dialog.
  - Fix locale: cambiar `new Intl.DateTimeFormat('es-AR', ...)` por `new Intl.DateTimeFormat(undefined, ...)`. Wrap visible text en `<span suppressHydrationWarning>` si aplica.
- **NEW `src/app/[placeSlug]/settings/system/page.tsx`** (~80 LOC):
  - Server Component. Carga `loadPlaceBySlug`, `getCurrentAuthUser`, `findMemberPermissions` (para validar quién puede ver leave button — todos pueden, pero el dialog interno ya valida "único owner").
  - Renderea `<PageHeader title="Sistema" description="Decisiones sobre tu lugar y permanencia." />`.
  - Section "Salir del place" con copy + botón → `<LeaveSystemPanel placeSlug appUrl />` (client component).
- **NEW `src/features/members/ui/leave-system-panel.tsx`** (~60 LOC, opcional — alternativa: mover la sección leave inline en system/page.tsx si es Client + page tiene 'use client' al wrap):
  - Client Component que mantiene state del `<LeavePlaceDialog>`.
  - Renderea botón rojo "Salir de este place" + monta el dialog.
- **MODIFIED `src/features/members/profile/public.ts`** o equivalent: verificar que `<LeavePlaceDialog>` se siga exportando público.
- **MODIFIED `src/app/[placeSlug]/settings/access/page.tsx`**:
  - Quitar `appUrl` de los props de `<OwnersAccessPanel>` (si se quita de ahí).
  - Quitar `clientEnv` import si no se usa más.
- **MODIFIED `src/features/settings-shell/domain/sections.tsx`**:
  - Sumar entry `{ href: '/settings/system', label: 'Sistema', icon: <SettingsIcon/> }` al final del array de sections. Cuál grupo: "Comunidad" o un nuevo "Lugar" — decisión menor, default a "Comunidad" inicialmente.
  - Verificar que `isOwner` no oculte el item (todos los miembros pueden ver — leave dialog valida adentro).
- **NEW `src/app/[placeSlug]/settings/system/loading.tsx`** (~30 LOC): skeleton consistente con otros loading.tsx.
- **MODIFIED `docs/pre-launch-checklist.md`** (opcional): si la migración de "Salir" rompe algún bookmark o link interno, anotar el redirect requerido.

**No tocar en esta sesión:**

- Backend (terminado en sesión 1).
- `<LeavePlaceDialog>` interno (solo se mueve el callsite).
- Otras settings pages.

**Verificación:**

- `pnpm typecheck` — verde.
- `pnpm vitest run` — verde. Tests existentes del owners-access-panel (si existen) actualizados.
- `pnpm lint` — clean.
- Smoke manual mobile + desktop:
  - `/settings/access`: lista de owners + pending. Tap "..." en un pending invite → menu con Reenviar + Revocar. Revocar → confirm dialog → confirmar → invitación desaparece.
  - `/settings/system`: nueva entry en sidebar visible. Page renderea con sección "Salir". Botón rojo abre `<LeavePlaceDialog>` igual que antes.
  - 360px viewport: cero horizontal scroll en ambas pages.
- Verificación de regresión: las otras sub-pages settings siguen funcionando (typecheck garantiza imports; smoke manual del sidebar para confirmar que el nuevo entry no rompe layout).

**LOC delta:** −60 net (~ -100 borrados en access-panel + +200 en nuevas pages/components).

**Riesgo deploy:** **medio** — toca UI compartida (owners-access-panel) + crea nueva ruta + modifica sidebar. Riesgos:

- Breaking el chip layout en mobile cuando se reemplaza `<ResendInvitationButton>` por `<RowActions>` (la row gana 1 button extra → puede overflow).
- Sidebar entry mal puesta (Comunidad vs nuevo group) puede confundir.
- Mover `<LeavePlaceDialog>` y olvidar pasar `appUrl` rompe el redirect post-leave.

Mitigación: tests existentes + smoke manual exhaustivo + revisión por code-reviewer antes de merge.

**Commit final:** `feat(settings): RowActions en access + /settings/system para leave`

---

## Resumen total

| Sesión                   | LOC delta | Files                                          | Riesgo |
| ------------------------ | --------- | ---------------------------------------------- | ------ |
| 1 — Backend revoke + ADR | +290      | 4 (action + tests + 2 barrel + ADR)            | Cero   |
| 2 — UI + system route    | -60 net   | ~7 (panel + page + sidebar + opcional helpers) | Medio  |
| **Total**                | **+230**  | **~11**                                        | —      |

## Cumplimiento CLAUDE.md

- ✅ **Mobile-first.** Validar 360px en sesión 2 smoke manual.
- ✅ **TDD obligatorio en core.** Sesión 1 tiene tests del action ANTES de implementar.
- ✅ **Sin libertad para decisiones arquitectónicas.** ADR de `/settings/system` documentado en sesión 1.
- ✅ **Triple review antes de ejecutar.** Este plan pasa por revisión con docs/architecture.md + CLAUDE.md + ux-patterns.md.
- ✅ **Sesiones cortas y focalizadas.** 2 sesiones independientes. Sesión 1 puede shipear sola (cero riesgo). Sesión 2 espera autorización.
- ✅ **Un prompt = una responsabilidad.** Cada sesión toca ≤5 archivos primarios (sesión 1: 4; sesión 2: ~7 pero todos UI).
- ✅ **Idioma.** Comentarios + docs en español, código en inglés.
- ✅ **Tipos estrictos.** Sin `any` ni `@ts-ignore`.
- ✅ **Validación Zod** para input del action.
- ✅ **No tocar mismos archivos entre sesiones.** Sesión 1: solo backend + ADR. Sesión 2: solo UI + página nueva. Cero overlap.

## Reglas de trabajo agente (note del user)

- ✅ Commit local antes de empezar cambios — hecho (commit `32c4480` previo).
- ✅ No revertir cambios previos — el plan EXPANDE (agrega revoke + system) sin revertir nada de access/hours.
- ✅ Robusto para producción — ADR documenta decisiones; tests cubren auth + authz + domain.
- ✅ Si usan agentes, no tocar mismos archivos — ver tabla de overlap arriba (cero).

## Open questions (para el user)

1. **Copy del sidebar entry**: "Sistema" suena tech. Alternativas: "Lugar", "Mi rol", "Permanencia". Decisión en sesión 2 cuando se toque el sidebar.
2. **Grupo del sidebar**: "Comunidad" o nuevo grupo "Lugar"? Decisión menor.
3. **Push tras sesión 1**: sesión 1 es zero-risk (código backend sin callsites). ¿Push tras sesión 1 o esperar sesión 2 completa para 1 sola release?
4. **¿Revoke = delete o soft-delete con `revokedAt`?**: el plan propone delete (simpler, menos schema change). Alternativa: agregar `revokedAt DateTime?` a `Invitation` para audit trail. Hoy NO hay caso de uso para "ver invitaciones revocadas históricamente" — delete está OK. Si emerge esa necesidad, agregar el field después con migration.
